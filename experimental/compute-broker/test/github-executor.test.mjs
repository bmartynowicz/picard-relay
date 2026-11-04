import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubExecutor, freeWorkflowSha256, EXECUTION_REPOSITORY, EXECUTION_WORKFLOW } from '../src/github-executor.mjs';
import { readFileSync } from 'node:fs';
import { makeReceipt, jobSha256, PreflightDenied } from '../src/execution-protocol.mjs';
import { RESULT_MARKER, runProjectChecks } from '../src/github-job.mjs';
import { CLOCK } from './helpers.mjs';
import { ciJob, HASH, SOURCE, provider } from './execution-helpers.mjs';
const TOKEN = 'test-token-never-a-secret';
const json = value => new Response(JSON.stringify(value), { status: 200 });
function setup(overrides = {}) {
  const calls = [], p = provider(true), job = ciJob();
  const run = () => ({ id: 11, display_title: `picard-compute/${job.id}/${jobSha256(job)}`,
    head_sha: SOURCE, event: 'workflow_dispatch', path: EXECUTION_WORKFLOW, status: 'completed', conclusion: 'success', run_attempt: 1 });
  const jobs = () => ({ jobs: [{ id: 22, run_id: 11, run_attempt: 1, name: 'fixed-project-checks', labels: ['ubuntu-latest', 'X64'] }] });
  const output = () => `${RESULT_MARKER}${Buffer.from(JSON.stringify(makeReceipt(job, HASH(), 'completed', { sourceSha: SOURCE, value: 3 }))).toString('base64')}`;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (overrides.handle) { const response = await overrides.handle(String(url), options); if (response) return response; }
    if (options.method === 'POST') return new Response(null, { status: 204 });
    if (String(url).endsWith(`/repos/${EXECUTION_REPOSITORY}`)) return json({ full_name: EXECUTION_REPOSITORY, private: false, archived: false, ...overrides.repository });
    if (String(url).includes('/git/ref/')) return json({ object: { type: 'commit', sha: overrides.tagSha ?? SOURCE } });
    if (String(url).includes('/contents/')) return json({ type: 'file', path: EXECUTION_WORKFLOW, encoding: 'base64',
      content: Buffer.from(overrides.workflow ?? readFileSync(new URL('../../../.github/workflows/compute-worker.yml', import.meta.url))).toString('base64') });
    if (String(url).includes('/runs?')) return json({ workflow_runs: overrides.runs ?? [run()] });
    if (String(url).includes('/jobs?')) return json(overrides.jobs ?? jobs());
    if (String(url).endsWith('/logs')) return new Response(overrides.output ?? output());
    throw Error('unexpected_request');
  };
  const adapter = createGitHubExecutor(p, { fetchImpl, now: () => CLOCK, token: () => TOKEN });
  return { p, job, adapter, calls, run, jobs, output, fetchImpl };
}
test('GitHub fixed standard workflow dispatch is one POST with exact source, job and worker hashes', async () => {
  const s = setup(); const receipt = await s.adapter.execute(s.job, { mayDispatch: () => true }); assert.equal(receipt.state, 'accepted');
  assert.equal(s.calls.length, 4); assert.equal(s.calls.filter(c => c.options.method === 'POST').length, 1);
  const body = JSON.parse(s.calls.at(-1).options.body); assert.equal(body.ref, 'compute-worker-v1');
  assert.equal(body.inputs.source_sha, SOURCE); assert.equal(body.inputs.worker_sha256, HASH());
  assert.deepEqual(JSON.parse(Buffer.from(body.inputs.job_json_b64, 'base64')), s.job);
  assert.equal(body.inputs.job_sha256, jobSha256(s.job)); assert.equal(freeWorkflowSha256().length, 64);
});
test('pinned protected branch enrollment needs no Contents write scope and cannot switch namespaces silently', async () => {
  const s = setup(), p = { ...s.p, refKind: 'branch' };
  const branch = createGitHubExecutor(p, { fetchImpl: s.fetchImpl, now: () => CLOCK, token: () => TOKEN });
  assert.notEqual(branch.context.scopeSha256, s.adapter.context.scopeSha256);
  await branch.execute(s.job, { mayDispatch: () => true });
  assert.ok(s.calls.some(c => c.url.endsWith('/git/ref/heads/compute-worker-v1')));
  assert.equal(s.calls.some(c => c.url.includes('/git/ref/tags/')), false);
  assert.throws(() => createGitHubExecutor({ ...p, refKind: 'arbitrary' }), /invalid_github_execution_profile/);
});
test('private project, changed tag, paid/stale cost and changed workflow deny before dispatch', async () => {
  for (const config of [{ repository: { private: true } }, { repository: { archived: true } },
    { tagSha: 'd'.repeat(40) }, { workflow: 'runs-on: expensive-runner' }]) {
    const s = setup(config); await assert.rejects(s.adapter.execute(s.job, { mayDispatch: () => true }), PreflightDenied);
    assert.equal(s.calls.some(c => c.options.method === 'POST'), false);
  }
  for (const change of [p => p.resource.cost.kind = 'trial', p => p.resource.cost.verifiedAt = CLOCK - 86_400_001,
    p => p.workerSha256 = '0'.repeat(64)]) {
    const s = setup(), p = structuredClone(s.p); change(p);
    const a = createGitHubExecutor(p, { fetchImpl: s.fetchImpl, now: () => CLOCK, token: () => TOKEN });
    await assert.rejects(a.execute(s.job, { mayDispatch: () => true }), PreflightDenied); assert.equal(s.calls.length, 0);
  }
});
test('dispatch transport loss sends once without retry and aborted preflight never dispatches later', async () => {
  const s = setup({ handle: (url, options) => { if (options.method === 'POST') throw Error('lost'); } });
  await assert.rejects(s.adapter.execute(s.job, { mayDispatch: () => true }), /lost/); assert.equal(s.calls.filter(c => c.options.method === 'POST').length, 1);
  const controller = new AbortController();
  const cancelled = setup({ handle: () => { controller.abort(); } });
  await assert.rejects(cancelled.adapter.execute(cancelled.job, { signal: controller.signal, mayDispatch: () => true }), PreflightDenied);
  assert.equal(cancelled.calls.some(c => c.options.method === 'POST'), false);
  const expired = setup(); await assert.rejects(expired.adapter.execute(expired.job, { mayDispatch: () => false }), PreflightDenied);
  assert.equal(expired.calls.some(c => c.options.method === 'POST'), false);
});
test('collection matches exact run identity and reads bounded result without dispatch', async () => {
  const s = setup(); assert.equal((await s.adapter.lookup(s.job)).state, 'completed');
  assert.ok(s.calls.every(c => c.options.method === 'GET')); assert.equal(s.calls.length, 3);
  for (const runs of [[], [s.run(), s.run()], [{ ...s.run(), head_sha: 'd'.repeat(40) }]]) {
    const other = setup({ runs }); assert.equal((await other.adapter.lookup(other.job)).state, 'uncertain');
    assert.equal(other.calls.length, 1);
  }
  const queued = setup({ runs: [{ ...s.run(), status: 'queued', conclusion: null }] });
  assert.equal((await queued.adapter.lookup(queued.job)).state, 'accepted');
});
test('collection rejects different runner, duplicate markers and contradictory outcomes', async () => {
  const good = setup();
  for (const overrides of [{ jobs: { jobs: [{ ...good.jobs().jobs[0], labels: ['self-hosted', 'ubuntu-latest'] }] } },
    { output: `${good.output()}\n${good.output()}` }, { output: 'untrusted text' },
    { runs: [{ ...good.run(), conclusion: 'cancelled' }] }, { runs: [{ ...good.run(), run_attempt: 2 }] }]) {
    const s = setup(overrides); await assert.rejects(s.adapter.lookup(s.job));
    assert.ok(s.calls.every(c => c.options.method === 'GET'));
  }
});
test('log redirects never receive GitHub credentials and arbitrary destinations are rejected', async () => {
  const base = setup(); const redirected = setup({ handle: (url) => url.endsWith('/logs')
    ? new Response(null, { status: 302, headers: { location: 'https://example.blob.core.windows.net/temporary' } })
    : url.includes('/temporary') ? new Response(base.output()) : null });
  assert.equal((await redirected.adapter.lookup(redirected.job)).state, 'completed');
  assert.equal(redirected.calls.at(-1).options.headers, undefined);
  for (const location of ['http://169.254.169.254/private', 'https://api.github.com.evil.invalid/log', 'https://user@example.blob.core.windows.net/log']) {
    const s = setup({ handle: url => url.endsWith('/logs') ? new Response(null, { status: 302, headers: { location } }) : null });
    await assert.rejects(s.adapter.lookup(s.job), /location_rejected/); assert.equal(s.calls.length, 3);
  }
});
test('fixed CI checks pin source, strip credentials, capture child output and run both suites only on success', async () => {
  const calls = []; const job = ciJob();
  const run = async (command, args, options) => { calls.push({ command, args, options });
    return { code: 0, stdout: calls.length === 1 ? `${SOURCE}\n` : `safe log ${RESULT_MARKER}child text`, stderr: '' }; };
  const receipt = await runProjectChecks(job, { directory: '/fixed/source', sourceHash: HASH(), run });
  assert.equal(receipt.state, 'completed'); assert.equal(calls.length, 3);
  assert.deepEqual(Object.keys(calls[1].options.env).sort(), ['CI', 'LANG', 'PATH', 'TMPDIR']);
  assert.equal(calls[1].args.includes('--test-concurrency=1'), true); assert.equal(calls[2].args.includes('--jitless'), true);
  assert.equal(receipt.result.sourceSha, SOURCE);
  await assert.rejects(runProjectChecks(job, { directory: '/fixed/source', sourceHash: HASH(), run: async () => ({ code: 0, stdout: 'wrong' }) }), /revision_mismatch/);
  let n = 0; const failed = await runProjectChecks(job, { directory: '/fixed/source', sourceHash: HASH(), run: async () => ({ code: ++n === 1 ? 0 : 1, stdout: n === 1 ? SOURCE : 'failed' }) });
  assert.equal(failed.state, 'failed'); assert.equal(n, 2); assert.equal(failed.result.jitlessExitCode, null);
});
