import test from 'node:test';
import assert from 'node:assert/strict';
import { observeProjectCi, PROJECT, CI_WORKFLOW } from '../src/github-ci.mjs';
const sha = 'a'.repeat(40);
function fixture(changes = {}) {
  const calls = [];
  const replies = [
    { full_name: PROJECT, private: false, archived: false },
    { workflow_runs: [{ id: 12, head_sha: sha, event: 'pull_request', path: CI_WORKFLOW, run_attempt: 1, status: 'completed', conclusion: 'success' }] },
    { total_count: 1, jobs: [{ id: 34, run_id: 12, name: 'offline', status: 'completed', conclusion: 'success', steps: [] }] },
  ];
  for (const [index, value] of Object.entries(changes)) replies[Number(index)] = value;
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify(replies[calls.length - 1]), { status: 200 });
  } };
}
test('live observer binds public repository, exact commit/workflow and job identity with GET only', async () => {
  const f = fixture(); const result = await observeProjectCi(sha, { ...f, now: () => 123 });
  assert.equal(result.run.conclusion, 'success'); assert.equal(result.jobs[0].id, 34); assert.equal(result.observedAt, 123);
  assert.equal(result.dispatchEnabled, false); assert.equal(f.calls.length, 3);
  for (const call of f.calls) {
    assert.ok(call.url.startsWith('https://api.github.com/repos/bmartynowicz/picard-relay'));
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal(Object.hasOwn(call.options.headers, 'authorization'), false);
  }
});
test('invalid commits and nonpublic/archived repositories cannot select another target', async () => {
  for (const invalid of ['main', '../secret', 'A'.repeat(40), sha + '?token=x'])
    await assert.rejects(observeProjectCi(invalid, { fetchImpl: () => { throw Error('must_not_fetch'); } }), /invalid_commit_sha/);
  for (const patch of [{ private: true }, { archived: true }, { full_name: 'other/repo' }]) {
    const f = fixture({ 0: { full_name: PROJECT, private: false, archived: false, ...patch } });
    await assert.rejects(observeProjectCi(sha, f), /public_project_required/); assert.equal(f.calls.length, 1);
  }
});
test('unmatched or missing CI is unknown rather than a fabricated successful result', async () => {
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { path: '.github/workflows/other.yml' }, { event: 'push' }]) {
    const f = fixture({ 1: { workflow_runs: [{ id: 12, head_sha: sha, event: 'pull_request', path: CI_WORKFLOW, ...patch }] } });
    assert.equal((await observeProjectCi(sha, f)).found, false); assert.equal(f.calls.length, 2);
  }
});
test('rate-limit, oversized and malformed responses stop without retry', async () => {
  let count = 0;
  await assert.rejects(observeProjectCi(sha, { fetchImpl: async () => { count++; return new Response('{}', { status: 403 }); } }), /project_ci_unavailable/);
  assert.equal(count, 1);
  await assert.rejects(observeProjectCi(sha, { fetchImpl: async () => new Response('x'.repeat(131073)) }), /project_ci_response_too_large/);
  await assert.rejects(observeProjectCi(sha, fixture({ 1: {} })), /invalid_project_ci_response/);
});
test('mismatched jobs are omitted and text/step output stays bounded', async () => {
  const f = fixture({ 2: { total_count: 20, jobs: [{ id: 1, run_id: 9 }, { id: 2, run_id: 12,
    name: 'x'.repeat(1000), steps: Array.from({ length: 25 }, (_, number) => ({ number, name: 'step' })) }] } });
  const result = await observeProjectCi(sha, f);
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].name.length, 200);
  assert.equal(result.jobs[0].steps.length, 20); assert.equal(result.jobs[0].stepsTruncated, true); assert.equal(result.jobsTruncated, true);
});
