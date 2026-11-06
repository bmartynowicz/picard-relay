import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRequest, checkHistory, executionProfile, runUnattended, REPOSITORY, DISPATCH_WORKFLOW } from '../unattended.mjs';
import { workerSha256, jobSha256, makeReceipt } from '../src/execution-protocol.mjs';
import { createExecutionRegistry } from '../src/execution-profile.mjs';
import { openMcp } from '../src/mcp-client.mjs';
import { CLOCK } from './helpers.mjs';
import { ciJob } from './execution-helpers.mjs';
import { REPOSITORY_CHECKS } from '../src/repository-checks.mjs';
const sha = 'c'.repeat(40);
function fixture() {
  const request = { schemaVersion: 1, enabled: true, approvedAt: CLOCK, validUntil: CLOCK + 60_000,
    workerRef: 'compute-worker-v2', workerCommit: sha, workerSha256: workerSha256(), job: ciJob('unattended-one') };
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_ACTOR: 'bmartynowicz',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '101',
    GITHUB_HEAD_REF: 'compute-request/unattended-one', PICARD_COMPUTE_GITHUB_TOKEN: 'ephemeral-fixture-not-a-secret' };
  const event = { repository: { full_name: REPOSITORY, private: false }, pull_request: {
    user: { login: 'bmartynowicz' }, head: { sha, ref: env.GITHUB_HEAD_REF, repo: { full_name: REPOSITORY } } } };
  const current = { id: 101, run_attempt: 1, display_title: 'picard-dispatch/'+env.GITHUB_HEAD_REF,
    head_branch: env.GITHUB_HEAD_REF, head_sha: sha, path: DISPATCH_WORKFLOW, event: 'pull_request' };
  return { request, env, event, history: { total_count: 1, workflow_runs: [current] } };
}
function harness(t, changes = {}) {
  const f = fixture(), directory = mkdtempSync(join(tmpdir(), 'picard-native-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [], opened = [], logs = []; let waits = 0;
  const receipt = makeReceipt(f.request.job, workerSha256(), 'completed', { sourceSha: sha, scope: 'full-repository-v1',
    checks: REPOSITORY_CHECKS.map(c => ({ id: c.id, exitCode: 0 })) });
  const completed = { id: f.request.job.id, state: 'completed', result: receipt };
  const open = async options => {
    opened.push(options);
    if (options.profile) {
      const profile = JSON.parse(readFileSync(options.profile));
      assert.equal(profile.approvedJobs.length, 1); assert.equal(profile.providers[0].resource.capacity.cpuMs, 360_000);
      assert.equal(profile.providers[0].tokenEnv, 'PICARD_COMPUTE_GITHUB_TOKEN');
      assert.equal(JSON.stringify(profile).includes(f.env.PICARD_COMPUTE_GITHUB_TOKEN), false);
    } else assert.equal(options.env.PICARD_COMPUTE_GITHUB_TOKEN, undefined);
    return { close: async () => { calls.push('close'); }, call: async name => {
      calls.push(name);
      if (changes.call) { const override = await changes.call(name, completed); if (override) return override; }
      if (name === 'compute_refresh_resources') return { resources: [{ ready: true }] };
      if (name === 'compute_plan') return { resourceId: 'github-ci' };
      if (name === 'compute_submit') return { state: 'reserved' };
      if (name === 'compute_run') return { state: 'pending' };
      if (['compute_collect', 'compute_get'].includes(name)) return completed;
      throw Error('unexpected_mcp_call');
    } };
  };
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    const data = url.includes('compute-broker-tests.yml') ? f.history : { workflow_runs: [{ id: 202,
      display_title: `picard-compute/${f.request.job.id}/${jobSha256(f.request.job)}`, head_sha: sha,
      event: 'workflow_dispatch', path: '.github/workflows/compute-worker.yml', run_attempt: 1, conclusion: changes.conclusion ?? 'success' }] };
    return new Response(JSON.stringify(changes.response ? changes.response(data, url) : data));
  };
  return { ...f, directory, calls, opened, logs, completed, waits: () => waits,
    options: { env: f.env, event: f.event, temporaryRoot: directory, now: () => CLOCK, open, fetchImpl,
      wait: async () => { waits++; }, log: value => logs.push(value) } };
}
test('unattended requests bind owner, same public repo, exact branch/input and finite approval', () => {
  const f = fixture(); assert.equal(validateRequest(f.request, f.env, f.event, CLOCK).job.id, 'unattended-one');
  for (const change of [v => v.request.enabled = false, v => v.request.validUntil = CLOCK,
    v => v.request.validUntil = CLOCK + 86_400_001, v => v.request.approvedAt = CLOCK + 1,
    v => v.request.workerSha256 = '0'.repeat(64), v => v.request.command = 'nope',
    v => v.request.job.needs.cpuMs = 360001, v => v.request.job.timeoutMs = 29999, v => v.env.GITHUB_RUN_ATTEMPT = '2',
    v => v.env.GITHUB_ACTOR = 'another-user', v => v.env.GITHUB_EVENT_NAME = 'pull_request_target',
    v => v.event.pull_request.head.repo.full_name = 'fork/repo', v => v.event.repository.private = true,
    v => v.env.GITHUB_HEAD_REF = 'main', v => v.event.pull_request.user.login = 'another-user']) {
    const invalid = fixture(); change(invalid); assert.throws(() => validateRequest(invalid.request, invalid.env, invalid.event, CLOCK));
  }
});
test('history rejects previous/duplicate/rerun/truncated/wrong-commit attempts before opening MCP', () => {
  for (const change of [d => { d.total_count = 21; }, d => { d.workflow_runs = []; },
    d => { d.total_count = 2; d.workflow_runs.push({ ...d.workflow_runs[0], id: 100 }); },
    d => d.workflow_runs[0].run_attempt = 2, d => d.workflow_runs[0].head_sha = 'd'.repeat(40),
    d => d.workflow_runs[0].path = '.github/workflows/other.yml']) {
    const f = fixture(); change(f.history); assert.throws(() => checkHistory(f.history, f.request, f.env, f.event));
  }
});
test('profile is finite, private, credential-free and accepted by the actual registry', () => {
  const f = fixture(), profile = executionProfile(f.request);
  const registry = createExecutionRegistry(profile, { now: () => CLOCK });
  assert.equal(registry.authorize(f.request.job, 'github-ci', CLOCK), true);
  assert.equal(registry.authorize(ciJob('different'), 'github-ci', CLOCK), false);
  assert.equal(registry.authorize(f.request.job, 'github-ci', CLOCK + 60000), false);
});
test('native harness calls compute_run once, collects, and recovers after restart without token', async t => {
  const h = harness(t); const summary = await runUnattended(h.request, h.options);
  assert.equal(summary.browserUsed, false); assert.equal(summary.transport, 'unattended-mcp-github-rest-api');
  assert.equal(summary.workerRunId, 202); assert.equal(summary.savedRecoveryAfterRestart, true);
  assert.equal(h.calls.filter(n => n === 'compute_run').length, 1); assert.equal(h.opened.length, 2);
  assert.equal(h.logs[0].maximumDispatches, 1); assert.equal(h.logs[1].marker, 'PICARD_UNATTENDED_RESULT_V1');
});
test('final handoff accepts realistic worker listings above 128 KiB, with a separate 512 KiB cap', async t => {
  const response = bytes => (data, url) => url.includes('compute-worker.yml') ? { ...data, repositoryMetadata: 'x'.repeat(bytes) } : data;
  const h = harness(t, { response: response(229_152) });
  assert.equal((await runUnattended(h.request, h.options)).savedRecoveryAfterRestart, true);
  assert.equal(h.calls.filter(n => n === 'compute_run').length, 1);
  const excessive = harness(t, { response: response(524_288) });
  await assert.rejects(runUnattended(excessive.request, excessive.options), /too_large/);
  assert.equal(excessive.calls.filter(n => n === 'compute_run').length, 1);
  assert.equal(excessive.logs.length, 1);
});
test('uncertain outcomes perform only bounded collection and never another dispatch', async t => {
  const h = harness(t, { call: name => name === 'compute_collect' ? { state: 'uncertain' } : null });
  await assert.rejects(runUnattended(h.request, h.options), /no_retry/);
  assert.equal(h.calls.filter(n => n === 'compute_run').length, 1);
  assert.equal(h.calls.filter(n => n === 'compute_collect').length, 120); assert.equal(h.waits(), 120);
  assert.equal(h.opened.length, 1); assert.equal(h.logs.length, 1);
});
test('known failed suites retain a validated result and restart recovery without another invocation', async t => {
  const h = harness(t, { conclusion: 'failure', call: (name, completed) => {
    if (!['compute_collect', 'compute_get'].includes(name)) return null;
    const result = structuredClone(completed.result.result); result.checks[0].exitCode = 1;
    return { ...completed, state: 'failed', result: makeReceipt(fixture().request.job, workerSha256(), 'failed', result, 'project_checks_failed') };
  } });
  const summary = await runUnattended(h.request, h.options);
  assert.equal(summary.receipt.state, 'failed'); assert.equal(summary.savedRecoveryAfterRestart, true);
  assert.equal(h.calls.filter(n => n === 'compute_run').length, 1);
});
test('invalid receipts, restart mismatch and missing authority fail without re-dispatch', async t => {
  const h = harness(t, { call: (name, completed) => name === 'compute_collect' ? { ...completed,
    result: { ...completed.result, workerSha256: '0'.repeat(64) } } : null });
  await assert.rejects(runUnattended(h.request, h.options), /no_retry/);
  assert.equal(h.calls.filter(n => n === 'compute_run').length, 1);
  const noToken = harness(t); delete noToken.env.PICARD_COMPUTE_GITHUB_TOKEN;
  await assert.rejects(runUnattended(noToken.request, noToken.options), /credential_required/); assert.equal(noToken.opened.length, 0);
});
test('history/network failure never opens a session or leaks credential into errors', async t => {
  const h = harness(t); h.options.fetchImpl = async () => new Response('denied', { status: 403 });
  await assert.rejects(runUnattended(h.request, h.options), /^Error: dispatch_history_unavailable$/); assert.equal(h.opened.length, 0);
  h.options.fetchImpl = async () => new Response('x'.repeat(131073));
  await assert.rejects(runUnattended(h.request, h.options), /too_large/); assert.equal(h.opened.length, 0);
});
test('new MCP client exchanges real stdio messages and reads state after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-client-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'ledger.sqlite'); let client = await openMcp({ database });
  try { const row = await client.call('compute_submit', ciJob()); assert.equal(row.state, 'blocked');
    await assert.rejects(client.call('unknown_tool'), /mcp_operation_failed/); } finally { await client.close(); }
  client = await openMcp({ database }); try { assert.equal((await client.call('compute_get', { id: 'ci-one' })).state, 'blocked'); }
  finally { await client.close(); }
});
test('privileged workflow remains owner-only, opt-in, standard-runner and scoped to Actions write', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/compute-broker-tests.yml', import.meta.url), 'utf8');
  for (const guard of ["github.actor == 'bmartynowicz'", "github.event.pull_request.user.login == 'bmartynowicz'",
    'github.event.pull_request.head.repo.full_name == github.repository', "startsWith(github.head_ref, 'compute-request/')",
    'github.event.repository.private == false', 'github.run_attempt == 1', 'needs: offline', 'actions: write', 'contents: read', 'cancel-in-progress: false']) assert.ok(workflow.includes(guard));
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|upload-artifact|actions\/cache|secrets\./);
});
