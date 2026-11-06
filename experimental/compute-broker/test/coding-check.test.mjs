import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCheck, readResult, collectCheck, recoverCheck, workerHistoryPath, githubGet } from '../coding-check.mjs';
import { makeReceipt, jobSha256 } from '../src/execution-protocol.mjs';
import { CLOCK } from './helpers.mjs';
import { REPOSITORY_CHECKS } from '../src/repository-checks.mjs';

const sourceSha = 'a'.repeat(40), headSha = 'c'.repeat(40);
function fixture() {
  const request = prepareCheck(sourceSha, 'coding-check-one', CLOCK);
  const intent = { marker: 'PICARD_UNATTENDED_INTENT_V1', jobId: request.job.id, inputHash: jobSha256(request.job), workflowRunId: 101, maximumDispatches: 1 };
  const summary = { schemaVersion: 1, marker: 'PICARD_UNATTENDED_RESULT_V1', jobId: request.job.id,
    coordinatorRunId: 101, workerRunId: 202, workerRunUrl: 'https://github.com/bmartynowicz/picard-relay/actions/runs/202',
    transport: 'unattended-mcp-github-rest-api', credential: 'ephemeral-GITHUB_TOKEN', browserUsed: false,
    savedRecoveryAfterRestart: true, receipt: makeReceipt(request.job, request.workerSha256, 'completed',
      { sourceSha, scope: 'full-repository-v1', checks: REPOSITORY_CHECKS.map(c => ({ id: c.id, exitCode: 0 })) }) };
  const logs = () => [intent, summary].map(r => `2026-11-04T00:00:00.0000000Z ${JSON.stringify(r)}`).join('\n');
  const coordinator = { id: 101, head_sha: headSha, head_branch: 'compute-request/coding-check-one', event: 'pull_request',
    path: '.github/workflows/compute-broker-tests.yml', run_attempt: 1, actor: { login: 'bmartynowicz' },
    repository: { full_name: 'bmartynowicz/picard-relay', private: false }, status: 'completed', conclusion: 'success' };
  const worker = { ...structuredClone(coordinator), id: 202, head_sha: request.workerCommit, head_branch: request.workerRef,
    event: 'workflow_dispatch', path: '.github/workflows/compute-worker.yml', actor: { login: 'github-actions[bot]' },
    display_title: `picard-compute/${request.job.id}/${jobSha256(request.job)}` };
  const jobs = (runId, names) => ({ total_count: names.length, jobs: names.map((name, n) => ({ name, id: runId + n + 1000,
    run_id: runId, run_attempt: 1, status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'] })) });
  const data = {
    '/actions/runs/101': coordinator, '/actions/runs/202': worker,
    '/actions/runs/101/jobs?per_page=10': jobs(101, ['offline', 'unattended-dispatch']),
    '/actions/runs/202/jobs?per_page=10': jobs(202, ['fixed-project-checks']),
    '/actions/runs/101/artifacts?per_page=10': { total_count: 0, artifacts: [] },
    '/actions/runs/202/artifacts?per_page=10': { total_count: 0, artifacts: [] },
  };
  const calls = [], get = async (path, raw) => { calls.push(path);
    if (path === '/actions/jobs/1102/logs') { assert.equal(raw, true); return logs(); }
    assert.ok(Object.hasOwn(data, path), 'unexpected API operation'); return data[path]; };
  return { request, intent, summary, logs, coordinator, worker, data, calls, get };
}
test('prepare binds a public source SHA and fixed worker to a two-hour one-job envelope', () => {
  const f = fixture(); assert.equal(f.request.job.input.text, sourceSha);
  assert.equal(f.request.validUntil - f.request.approvedAt, 7_200_000);
  assert.equal(f.request.job.needs.cpuMs, 360_000);
  for (const args of [['main', 'one'], [sourceSha, '../escape'], [sourceSha, 'UPPER'], [sourceSha, 'one', NaN]])
    assert.throws(() => prepareCheck(...args));
});
test('result parsing verifies exact receipt and inline artifact from timestamped coordinator logs', () => {
  const f = fixture(); assert.deepEqual(readResult(f.logs(), f.request, 101), f.summary);
  // Reading an old result never creates or renews a request.
  assert.equal(readResult(f.logs(), f.request, 101).savedRecoveryAfterRestart, true);
});
test('missing, duplicate, stopped or out-of-order records cannot report success', () => {
  const f = fixture();
  for (const logs of ['', JSON.stringify(f.summary), f.logs()+'\n'+JSON.stringify(f.summary),
    f.logs()+'\n'+JSON.stringify({ marker: 'PICARD_UNATTENDED_STOP_V1' }),
    [f.summary, f.intent].map(r => JSON.stringify(r)).join('\n'), '{invalid', 'x'.repeat(262145)])
    assert.throws(() => readResult(logs, f.request, 101));
});
test('wrong source, run, input, worker, artifact, failure or recovery cannot report success', () => {
  for (const mutate of [f => f.intent.inputHash = '0'.repeat(64), f => f.intent.maximumDispatches = 2,
    f => f.summary.coordinatorRunId = 102, f => f.summary.workerRunUrl = 'https://example.com/202',
    f => f.summary.receipt.result.sourceSha = 'd'.repeat(40), f => f.summary.receipt.result.normalExitCode = 1,
    f => f.summary.receipt.workerSha256 = '0'.repeat(64), f => f.summary.receipt.state = 'failed',
    f => f.summary.receipt.artifacts[0].sha256 = '0'.repeat(64), f => f.summary.receipt.artifacts = [],
    f => f.summary.savedRecoveryAfterRestart = false, f => f.summary.browserUsed = true]) {
    const f = fixture(); mutate(f); assert.throws(() => readResult(f.logs(), f.request, 101));
  }
});
test('collection verifies both real run identities, standard runners and zero uploads using seven reads', async () => {
  const f = fixture(), result = await collectCheck(f.request, headSha, 101, { get: f.get });
  assert.equal(result.state, 'passed'); assert.equal(result.sourceSha, sourceSha); assert.equal(f.calls.length, 7);
  assert.equal(result.uploadedArtifacts, 0); assert.equal(result.automaticRetries, 0);
});
test('pending collection returns after one read; coordinator cancellation stops with no worker lookup', async () => {
  const f = fixture(); f.coordinator.status = 'in_progress';
  assert.equal((await collectCheck(f.request, headSha, 101, { get: f.get })).state, 'pending'); assert.equal(f.calls.length, 1);
  f.coordinator.status = 'completed'; f.coordinator.conclusion = 'cancelled';
  await assert.rejects(collectCheck(f.request, headSha, 101, { get: f.get }), /did_not_pass/); assert.equal(f.calls.length, 2);
});
test('known repository test failures are retrieved with each group result and never mislabeled passed', async () => {
  const f = fixture(), result = structuredClone(f.summary.receipt.result); result.checks[2].exitCode = 1;
  f.summary.receipt = makeReceipt(f.request.job, f.request.workerSha256, 'failed', result, 'project_checks_failed');
  f.coordinator.conclusion = 'failure'; f.worker.conclusion = 'failure';
  f.data['/actions/runs/101/jobs?per_page=10'].jobs[1].conclusion = 'failure';
  f.data['/actions/runs/202/jobs?per_page=10'].jobs[0].conclusion = 'failure';
  const collected = await collectCheck(f.request, headSha, 101, { get: f.get });
  assert.equal(collected.state, 'failed'); assert.equal(collected.checks[2].id, 'runtime');
  assert.equal(collected.checks[2].exitCode, 1); assert.equal(f.calls.length, 7);
});
test('the legacy worker v1 result remains readable after installing repository worker v2', () => {
  const f = fixture(); Object.assign(f.request, { workerRef: 'compute-worker-v1',
    workerCommit: 'b928ef2a10c7792a9c709f38a8065373d76160b4',
    workerSha256: 'ae31a4c71dbf5a79a751832199e6dd8b77af4a82bb02426890486b1619d00439' });
  f.summary.receipt = makeReceipt(f.request.job, f.request.workerSha256, 'completed', { sourceSha, normalExitCode: 0, jitlessExitCode: 0 });
  assert.equal(readResult(f.logs(), f.request, 101).receipt.state, 'completed');
});
test('collection denies reruns, different commits, private repos, unexpected runners/jobs and uploads', async () => {
  for (const mutate of [f => f.coordinator.run_attempt = 2, f => f.coordinator.head_sha = sourceSha,
    f => f.coordinator.repository.private = true, f => f.coordinator.actor.login = 'other',
    f => f.worker.head_sha = sourceSha, f => f.worker.head_branch = 'main', f => f.worker.actor.login = 'other',
    f => f.data['/actions/runs/202/jobs?per_page=10'].jobs[0].labels = ['self-hosted'],
    f => f.data['/actions/runs/101/jobs?per_page=10'].total_count = 3,
    f => f.data['/actions/runs/202/artifacts?per_page=10'].total_count = 1]) {
    const f = fixture(); mutate(f); await assert.rejects(collectCheck(f.request, headSha, 101, { get: f.get }));
  }
});
test('invalid collection inputs and non-allowlisted GitHub paths stop before any network call', async () => {
  const f = fixture(); await assert.rejects(collectCheck(f.request, 'main', 101, { get: f.get })); assert.equal(f.calls.length, 0);
  for (const path of ['/actions/runs/1/rerun', '/actions/workflows/compute-worker.yml/dispatches', 'https://example.com', '/actions/runs/1?x=2'])
    await assert.rejects(githubGet(path), /read_path_denied/);
});
function recoveryFixture() {
  const f = fixture(), stop = { marker: 'PICARD_UNATTENDED_STOP_V1', reason: 'mcp_operation_failed', automaticRetries: 0 };
  Object.assign(f.coordinator, { conclusion: 'failure', created_at: new Date(CLOCK + 1000).toISOString(), updated_at: new Date(CLOCK + 10_000).toISOString() });
  f.worker.created_at = new Date(CLOCK + 5000).toISOString();
  f.data['/actions/runs/101/jobs?per_page=10'].jobs[1].conclusion = 'failure';
  const path = workerHistoryPath(f.coordinator.created_at, f.coordinator.updated_at);
  f.data[path] = { total_count: 1, workflow_runs: [f.worker] };
  const get = async (path, raw) => {
    f.calls.push(path);
    if (path === '/actions/jobs/1102/logs') return [f.intent, stop].map(r => JSON.stringify(r)).join('\n');
    if (path === '/actions/jobs/1202/logs') return `${'ordinary log\n'.repeat(20_000)}PICARD_COMPUTE_RESULT_V1:${Buffer.from(JSON.stringify(f.summary.receipt)).toString('base64')}`;
    assert.ok(Object.hasOwn(f.data, path), 'unexpected recovery operation'); return f.data[path];
  };
  return { ...f, stop, get, history: f.data[path] };
}
test('historical recovery verifies stopped coordinator and exact worker without claiming ledger restart recovery', async () => {
  const f = recoveryFixture(), before = JSON.stringify(f.request);
  const result = await recoverCheck(f.request, headSha, 101, 202, { get: f.get });
  assert.equal(result.state, 'passed'); assert.equal(result.recovery, 'read-only-worker-log');
  assert.equal(result.savedRecoveryAfterRestart, false); assert.equal(result.automaticRetries, 0);
  assert.equal(result.uploadedArtifacts, 0); assert.equal(f.calls.length, 9);
  assert.equal(JSON.stringify(f.request), before);
  assert.ok(f.calls.every(p => !/dispatches|rerun/.test(p)));
});
test('historical recovery retains failed test groups and never converts them to success', async () => {
  const f = recoveryFixture(), result = structuredClone(f.summary.receipt.result); result.checks[2].exitCode = 1;
  f.summary.receipt = makeReceipt(f.request.job, f.request.workerSha256, 'failed', result, 'project_checks_failed');
  f.worker.conclusion = 'failure'; f.data['/actions/runs/202/jobs?per_page=10'].jobs[0].conclusion = 'failure';
  const recovered = await recoverCheck(f.request, headSha, 101, 202, { get: f.get });
  assert.equal(recovered.state, 'failed'); assert.equal(recovered.checks[2].exitCode, 1);
});
test('historical recovery refuses ambiguous history, altered evidence, reruns and unavailable original stops', async () => {
  for (const mutate of [f => f.history.total_count = 21, f => f.history.workflow_runs.push(f.worker),
    f => f.history.workflow_runs = [], f => f.history.workflow_runs = [{ ...f.worker, id: 203 }],
    f => f.stop.reason = 'other', f => f.stop.automaticRetries = 1, f => f.stop.marker = 'PICARD_UNATTENDED_RESULT_V1',
    f => f.intent.maximumDispatches = 2, f => f.coordinator.run_attempt = 2, f => f.coordinator.conclusion = 'success',
    f => f.worker.run_attempt = 2, f => f.worker.head_sha = sourceSha, f => f.worker.repository.private = true,
    f => f.worker.created_at = new Date(CLOCK + 11_000).toISOString(), f => f.coordinator.updated_at = 'invalid',
    f => f.summary.receipt.artifacts[0].sha256 = '0'.repeat(64), f => f.summary.receipt.result.sourceSha = headSha,
    f => f.data['/actions/runs/202/jobs?per_page=10'].jobs[0].labels = ['self-hosted', 'ubuntu-latest'],
    f => f.data['/actions/runs/101/artifacts?per_page=10'].total_count = 1]) {
    const f = recoveryFixture(); mutate(f);
    await assert.rejects(recoverCheck(f.request, headSha, 101, 202, { get: f.get }));
  }
});
test('recovery history paths are fixed GET queries with a finite time window', async () => {
  for (const range of [['invalid', 'invalid'], [new Date(CLOCK).toISOString(), new Date(CLOCK - 1).toISOString()],
    [new Date(CLOCK).toISOString(), new Date(CLOCK + 86_400_001).toISOString()]]) assert.throws(() => workerHistoryPath(...range));
  for (const path of ['/actions/workflows/compute-worker.yml/runs?event=workflow_dispatch&per_page=100',
    workerHistoryPath(new Date(CLOCK).toISOString(), new Date(CLOCK + 1).toISOString()) + '&page=2'])
    await assert.rejects(githubGet(path));
});
