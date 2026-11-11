// Check-only harness. Uses the unchanged one-dispatch coordinator and real MCP.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runUnattended } from './unattended.mjs';
import { openMcp } from './src/mcp-client.mjs';

const request = JSON.parse(readFileSync(new URL('./unattended-request.json', import.meta.url), 'utf8'));
const extra = [
  { ...request.job, id: request.job.id + '-unapproved' },
  { id: request.job.id + '-data', operation: 'word-count', workload: 'data', arch: 'x64',
    input: { text: 'No eligible Oracle allowance remains' },
    needs: { cpuMs: 3000, ramMb: 128, diskMb: 1, gpus: 0 }, timeoutMs: 10000 },
];
const ids = [request.job.id, ...extra.map(job => job.id)];
let replayVerified = false, restartVerified = false;
const log = value => console.log(JSON.stringify(value));
function verifyBlocked(jobs) {
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.slice(1).map(row => [row.id, row.state, row.resourceId]), extra.map(job => [job.id, 'blocked', null]));
  assert.ok(jobs.every(row => !Object.hasOwn(row, 'result') && !Object.hasOwn(row, 'input')));
}
const open = async options => {
  const session = await openMcp(options);
  return { close: session.close, async call(name, args = {}) {
    if (options.profile && name === 'compute_submit') {
      assert.deepEqual(args, request.job);
      const admitted = await session.call('compute_submit_batch', { jobs: [args, ...extra] });
      assert.equal(admitted.executionStarted, false); verifyBlocked(admitted.jobs);
      assert.deepEqual(admitted.jobs[0], { id: request.job.id, state: 'reserved', resourceId: 'github-ci' });
      log({ marker: 'PICARD_BATCH_ADMISSION_V1', sourceSha: request.job.input.text, ...admitted });
      return session.call('compute_get', { id: request.job.id });
    }
    if (options.profile && name === 'compute_run') {
      assert.deepEqual(args, { id: request.job.id });
      const dispatched = await session.call('compute_run_batch', { ids });
      verifyBlocked(dispatched.jobs);
      assert.ok(['pending', 'completed', 'failed'].includes(dispatched.jobs[0].state));
      assert.equal(dispatched.automaticRetries, 0);
      log({ marker: 'PICARD_BATCH_DISPATCH_V1', ...dispatched });
      return session.call('compute_get', args);
    }
    const answer = await session.call(name, args);
    if (name === 'compute_get' && args.id === request.job.id && ['completed', 'failed'].includes(answer.state)) {
      const replay = await session.call('compute_run_batch', { ids }); verifyBlocked(replay.jobs);
      assert.ok(replay.jobs.every(row => row.disposition === 'unchanged'));
      assert.equal(replay.jobs[0].state, answer.state);
      if (options.profile) replayVerified = true;
      else {
        assert.equal(options.env.PICARD_COMPUTE_GITHUB_TOKEN, undefined);
        restartVerified = true;
      }
      log({ marker: 'PICARD_BATCH_REPLAY_V1', afterCredentialFreeRestart: !options.profile, ...replay });
    }
    return answer;
  } };
};
try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const summary = await runUnattended(request, { event, temporaryRoot: process.env.RUNNER_TEMP, open, log });
  assert.ok(replayVerified && restartVerified);
  log({ marker: 'PICARD_BATCH_LIVE_VERIFIED_V1', sourceSha: request.job.input.text,
    liveProvider: 'github-public-ci', approvedJobsExecuted: 1, unapprovedJobsBlocked: 1,
    noEligibleProviderJobsBlocked: 1, savedReplayVerified: replayVerified,
    credentialFreeRestartVerified: restartVerified, automaticRetries: 0,
    oracleLiveExecution: false, workerRunUrl: summary.workerRunUrl });
  if (summary.receipt.state === 'failed') process.exitCode = 1;
} catch {
  log({ marker: 'PICARD_BATCH_LIVE_STOP_V1', reason: 'verification_failed_no_retry', automaticRetries: 0 });
  process.exitCode = 1;
}
