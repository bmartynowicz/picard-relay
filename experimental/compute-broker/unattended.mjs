import { readFileSync, writeFileSync, mkdtempSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeJob } from './src/job.mjs';
import { workerSha256, jobSha256, hex256 } from './src/execution-protocol.mjs';
import { validateReceipt } from './src/receipt.mjs';
import { openMcp } from './src/mcp-client.mjs';
import { repositoryResultState } from './src/repository-checks.mjs';
import { WORKER_RUNS_PATH, WORKER_RUNS_MAXIMUM_BYTES, workerRuns } from './src/github-result.mjs';

export const REPOSITORY = 'bmartynowicz/picard-relay';
export const DISPATCH_WORKFLOW = '.github/workflows/compute-broker-tests.yml';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const integer = v => Number.isSafeInteger(v) && v > 0;
const commit = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const credential = v => typeof v === 'string' && /^[A-Za-z0-9_.-]{20,4096}$/.test(v);
export function validateRequestEnvelope(value, now = Date.now(), expectedHash = workerSha256()) {
  if (!exact(value, ['schemaVersion', 'enabled', 'approvedAt', 'validUntil', 'workerRef', 'workerCommit', 'workerSha256', 'job'])
    || value.schemaVersion !== 1 || value.enabled !== true || !integer(value.approvedAt) || value.approvedAt > now
    || !integer(value.validUntil) || value.validUntil <= now || value.validUntil > value.approvedAt + 86_400_000
    || now - value.approvedAt > 86_400_000 || !/^compute-worker-v[1-9][0-9]*$/.test(value.workerRef)
    || !commit(value.workerCommit) || !hex256(value.workerSha256) || value.workerSha256 !== expectedHash) throw Error('unattended_request_denied');
  const job = normalizeJob(value.job);
  if (job.operation !== 'project-checks' || job.workload !== 'project-ci' || job.arch !== 'x64'
    || job.needs.cpuMs !== 360_000 || job.needs.ramMb !== 4096 || job.needs.diskMb !== 0 || job.needs.gpus !== 0
    || job.timeoutMs !== 30_000) throw Error('unattended_request_denied');
  return { ...value, job };
}
export function validateRequest(value, env, event, now = Date.now()) {
  const request = validateRequestEnvelope(value, now), job = request.job, pr = event?.pull_request;
  if (request.workerRef !== 'compute-worker-v2'
    || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_ACTOR !== 'bmartynowicz'
    || env.GITHUB_EVENT_NAME !== 'pull_request' || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || !integer(Number(env.GITHUB_RUN_ID))
    || pr?.user?.login !== 'bmartynowicz' || pr?.head?.repo?.full_name !== REPOSITORY
    || !commit(pr?.head?.sha) || pr?.head?.ref !== `compute-request/${job.id}`
    || env.GITHUB_HEAD_REF !== pr.head.ref || event?.repository?.full_name !== REPOSITORY || event.repository.private !== false)
    throw Error('unattended_context_denied');
  return request;
}
export function checkHistory(data, request, env, event) {
  if (!integer(data?.total_count) || data.total_count > 20 || !Array.isArray(data.workflow_runs)
    || data.workflow_runs.length !== data.total_count) throw Error('dispatch_history_incomplete');
  const name = `picard-dispatch/compute-request/${request.job.id}`;
  const same = data.workflow_runs.filter(r => r.display_title === name && r.head_branch === env.GITHUB_HEAD_REF);
  const current = same.filter(r => r.id === Number(env.GITHUB_RUN_ID));
  if (current.length !== 1 || current[0].run_attempt !== 1 || current[0].path !== DISPATCH_WORKFLOW
    || current[0].event !== 'pull_request' || current[0].head_sha !== event.pull_request.head.sha
    || same.some(r => r.id !== current[0].id)) throw Error('prior_dispatch_attempt_or_identity_mismatch');
}
export function executionProfile(request) {
  const r = request;
  return { schemaVersion: 1, enabled: true, validUntil: r.validUntil,
    approvedJobs: [{ resourceId: 'github-ci', jobSha256: jobSha256(r.job), validUntil: r.validUntil }],
    providers: [{ kind: 'github-public-ci', workerSha256: r.workerSha256, tokenEnv: 'PICARD_COMPUTE_GITHUB_TOKEN',
      refKind: 'branch', tag: r.workerRef, commitSha: r.workerCommit,
      resource: { id: 'github-ci', enabled: true, mode: 'project-ci', arch: 'x64', operations: ['project-checks'], observedAt: 0,
        cost: { kind: 'free-public-ci', verifiedAt: r.approvedAt, validUntil: r.validUntil,
          maximumIncrementalUsd: 0, evidenceRef: 'github-public-standard-ci' },
        capacity: { cpuMs: 360_000, ramMb: 4096, diskMb: 0, gpus: 0, slots: 1 } } }] };
}
export async function runUnattended(value, { env = process.env, event, temporaryRoot, fetchImpl = fetch,
  open = openMcp, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)), log = () => {} } = {}) {
  const request = validateRequest(value, env, event, now());
  if (!credential(env.PICARD_COMPUTE_GITHUB_TOKEN)) throw Error('ephemeral_workflow_credential_required');
  async function get(path, maximum = 131_072) {
    const response = await fetchImpl(API + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.PICARD_COMPUTE_GITHUB_TOKEN}`, 'user-agent': 'picard-unattended-ci' } });
    if (response.status !== 200) { await response.body?.cancel(); throw Error('dispatch_history_unavailable'); }
    const chunks = []; let count = 0;
    for await (const chunk of response.body) { count += chunk.length; if (count > maximum) throw Error('dispatch_history_too_large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const history = await get(`/actions/workflows/compute-broker-tests.yml/runs?event=pull_request&branch=${encodeURIComponent(env.GITHUB_HEAD_REF)}&per_page=20`);
  checkHistory(history, request, env, event);
  const root = lstatSync(temporaryRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error('private_runner_temp_required');
  const directory = mkdtempSync(join(temporaryRoot, 'picard-unattended-'));
  const profile = join(directory, 'execution.json'), database = join(directory, 'ledger.sqlite');
  writeFileSync(profile, JSON.stringify(executionProfile(request)), { mode: 0o600 });
  let session = await open({ database, profile, env }); let result;
  try {
    const ready = await session.call('compute_refresh_resources');
    if (ready.resources?.length !== 1 || ready.resources[0].ready !== true) throw Error('worker_not_ready');
    const planned = await session.call('compute_plan', request.job);
    if (planned.resourceId !== 'github-ci') throw Error('request_ineligible');
    const row = await session.call('compute_submit', request.job);
    if (row.state !== 'reserved') throw Error('request_not_reserved');
    log({ marker: 'PICARD_UNATTENDED_INTENT_V1', jobId: request.job.id, inputHash: jobSha256(request.job),
      workflowRunId: Number(env.GITHUB_RUN_ID), maximumDispatches: 1 });
    result = await session.call('compute_run', { id: request.job.id }); // Exactly one execution call.
    for (let reads = 0; ['pending', 'uncertain', 'invoking'].includes(result.state) && reads < 120; reads++) {
      await wait(5000); result = await session.call('compute_collect', { id: request.job.id });
    }
    const receipt = result.result;
    if (!['completed', 'failed'].includes(result.state) || !validateReceipt(receipt, { jobId: request.job.id,
      jobSha256: jobSha256(request.job), workerSha256: request.workerSha256 })
      || receipt.state !== result.state || receipt.result?.sourceSha !== request.job.input.text
      || repositoryResultState(receipt.result) !== receipt.state)
      throw Error('unattended_outcome_not_completed_no_retry');
    // Read-only replay, never another dispatch; compute_get also works after restart without credentials.
    const saved = await session.call('compute_get', { id: request.job.id });
    if (JSON.stringify(saved) !== JSON.stringify(result)) throw Error('saved_result_mismatch');
  } finally { await session.close(); }
  const readEnv = { ...env }; delete readEnv.PICARD_COMPUTE_GITHUB_TOKEN;
  session = await open({ database, env: readEnv });
  try {
    const recovered = await session.call('compute_get', { id: request.job.id });
    if (JSON.stringify(recovered) !== JSON.stringify(result)) throw Error('restart_result_mismatch');
  } finally { await session.close(); }
  const runs = await get(WORKER_RUNS_PATH, WORKER_RUNS_MAXIMUM_BYTES);
  const matches = workerRuns(runs).filter(r => r.display_title === `picard-compute/${request.job.id}/${jobSha256(request.job)}`
    && r.head_sha === request.workerCommit && r.event === 'workflow_dispatch' && r.path === '.github/workflows/compute-worker.yml');
  if (matches?.length !== 1 || matches[0].run_attempt !== 1
    || matches[0].conclusion !== (result.state === 'completed' ? 'success' : 'failure')) throw Error('worker_run_identity_mismatch');
  const summary = { schemaVersion: 1, marker: 'PICARD_UNATTENDED_RESULT_V1', jobId: request.job.id,
    coordinatorRunId: Number(env.GITHUB_RUN_ID), workerRunId: matches[0].id,
    workerRunUrl: `https://github.com/${REPOSITORY}/actions/runs/${matches[0].id}`,
    transport: 'unattended-mcp-github-rest-api', credential: 'ephemeral-GITHUB_TOKEN', browserUsed: false,
    savedRecoveryAfterRestart: true, ledgerLifetime: 'private coordinator runner; invocation fences and receipts retained in GitHub run history/logs',
    receipt: result.result };
  writeFileSync(join(directory, 'result.json'), JSON.stringify(summary), { mode: 0o600 });
  log(summary); return summary;
}
function readJson(path, maximum) {
  const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('invalid_ci_input_file');
  return JSON.parse(readFileSync(path, 'utf8'));
}
async function main() {
  const request = readJson(fileURLToPath(new URL('./unattended-request.json', import.meta.url)), 8192);
  const event = readJson(process.env.GITHUB_EVENT_PATH, 262_144);
  const summary = await runUnattended(request, { event, temporaryRoot: process.env.RUNNER_TEMP, log: value => console.log(JSON.stringify(value)) });
  if (summary.receipt.state === 'failed') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const allowed = new Set(['unattended_request_denied', 'unattended_context_denied', 'ephemeral_workflow_credential_required',
      'dispatch_history_incomplete', 'prior_dispatch_attempt_or_identity_mismatch', 'dispatch_history_unavailable',
      'dispatch_history_too_large', 'private_runner_temp_required', 'worker_not_ready', 'request_ineligible',
      'request_not_reserved', 'unattended_outcome_not_completed_no_retry', 'saved_result_mismatch',
      'restart_result_mismatch', 'worker_run_identity_mismatch', 'invalid_ci_input_file',
      'mcp_session_failed', 'mcp_operation_failed', 'mcp_response_timeout', 'mcp_shutdown_failed']);
    console.error(JSON.stringify({ marker: 'PICARD_UNATTENDED_STOP_V1', reason: allowed.has(error.message) ? error.message : 'operation_failed', automaticRetries: 0 }));
    process.exitCode = 1;
  });
}
