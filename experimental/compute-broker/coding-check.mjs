import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedProcess } from './src/process.mjs';
import { workerSha256, jobSha256 } from './src/execution-protocol.mjs';
import { validateReceipt } from './src/receipt.mjs';
import { REPOSITORY, DISPATCH_WORKFLOW, validateRequestEnvelope } from './unattended.mjs';
import { repositoryResultState, REPOSITORY_SCOPE } from './src/repository-checks.mjs';
import { WORKER_RUNS_PATH, WORKER_RUNS_MAXIMUM_BYTES, WORKER_LOG_MAXIMUM_BYTES, workerRuns, readWorkerReceipt } from './src/github-result.mjs';

const LEGACY_WORKER = Object.freeze({ workerRef: 'compute-worker-v1',
  workerCommit: 'b928ef2a10c7792a9c709f38a8065373d76160b4',
  workerSha256: 'ae31a4c71dbf5a79a751832199e6dd8b77af4a82bb02426890486b1619d00439' });
const WORKER = Object.freeze({ workerRef: 'compute-worker-v2',
  workerCommit: 'c3d05f0c8d48e244481459a5cf1b7e222c50e14f',
  workerSha256: '92bf82d89359c0942c961e39e1ebafaa50076da41e46ec7d152ac4092d639df2' });
const sha = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const id = v => Number.isSafeInteger(v) && v > 0;
const url = runId => `https://github.com/${REPOSITORY}/actions/runs/${runId}`;

function validateCodingRequest(value) {
  // Historical collection validates the original envelope at issuance; it grants no execution authority.
  const pin = value?.workerRef === LEGACY_WORKER.workerRef ? LEGACY_WORKER : WORKER;
  const request = validateRequestEnvelope(value, value?.approvedAt, pin.workerSha256);
  if (Object.keys(pin).some(k => request[k] !== pin[k]))
    throw Error('coding_worker_pin_mismatch');
  return request;
}
export function prepareCheck(sourceSha, jobId, now = Date.now()) {
  if (!id(now) || !Number.isSafeInteger(now + 7_200_000)) throw Error('coding_clock_invalid');
  return validateCodingRequest({ schemaVersion: 1, enabled: true, approvedAt: now, validUntil: now + 7_200_000,
    ...WORKER, job: { id: jobId, operation: 'project-checks', workload: 'project-ci', arch: 'x64',
      needs: { cpuMs: 360_000, ramMb: 4096, diskMb: 0, gpus: 0 }, input: { text: sourceSha }, timeoutMs: 30_000 } });
}
export async function githubGet(path, raw = false) {
  const history = typeof path === 'string' && path.startsWith(WORKER_RUNS_PATH + '&created=');
  if (history) {
    const range = decodeURIComponent(path.slice((WORKER_RUNS_PATH + '&created=').length)).split('..');
    if (range.length !== 2 || workerHistoryPath(...range) !== path) throw Error('coding_read_path_denied');
  } else if (!/^\/actions\/(runs|jobs)\/[1-9][0-9]*(?:\/(?:jobs|artifacts)\?per_page=10|\/logs)?$/.test(path))
    throw Error('coding_read_path_denied');
  const result = await boundedProcess('gh', ['api', '--method', 'GET', `repos/${REPOSITORY}${path}`],
    { timeoutMs: 15_000, maximumBytes: history ? WORKER_RUNS_MAXIMUM_BYTES : raw ? WORKER_LOG_MAXIMUM_BYTES : 262_144 });
  if (result.code !== 0) throw Error('coding_github_read_failed');
  return raw ? result.stdout : JSON.parse(result.stdout);
}
function validateRun(run, { runId, headSha, branch, event, workflow, actor }) {
  if (run?.id !== runId || run.head_sha !== headSha || run.head_branch !== branch || run.event !== event
    || run.path !== workflow || run.run_attempt !== 1 || run.actor?.login !== actor
    || run.repository?.full_name !== REPOSITORY || run.repository.private !== false)
    throw Error('coding_run_identity_mismatch');
}
function checkedJobs(value, runId, names, conclusions = {}) {
  if (value?.total_count !== names.length || !Array.isArray(value.jobs) || value.jobs.length !== names.length
    || names.some(name => value.jobs.filter(j => j.name === name).length !== 1)
    || value.jobs.some(j => !id(j.id) || j.run_id !== runId || j.run_attempt !== 1 || j.status !== 'completed'
      || j.conclusion !== (conclusions[j.name] ?? 'success') || !Array.isArray(j.labels) || !j.labels.includes('ubuntu-latest')
      || j.labels.includes('self-hosted'))) throw Error('coding_jobs_not_verified');
  return value.jobs;
}
function coordinatorRecords(logs) {
  if (typeof logs !== 'string' || Buffer.byteLength(logs) > 262_144) throw Error('coding_logs_invalid');
  const records = [];
  for (const line of logs.split(/\r?\n/)) {
    const text = line.replace(/^\d{4}-\d\d-\d\dT[0-9:.]+Z /, '');
    if (!text.startsWith('{')) continue;
    let record; try { record = JSON.parse(text); } catch { throw Error('coding_log_json_invalid'); }
    if (['PICARD_UNATTENDED_INTENT_V1', 'PICARD_UNATTENDED_RESULT_V1', 'PICARD_UNATTENDED_STOP_V1'].includes(record.marker)) records.push(record);
  }
  return records;
}
function validIntent(intent, request, runId) {
  return id(runId) && intent?.marker === 'PICARD_UNATTENDED_INTENT_V1' && intent.jobId === request.job.id
    && intent.inputHash === jobSha256(request.job) && intent.workflowRunId === runId && intent.maximumDispatches === 1;
}
function verifiedReceipt(receipt, request) {
  return validateReceipt(receipt, { jobId: request.job.id, jobSha256: jobSha256(request.job), workerSha256: request.workerSha256 })
    && ['completed', 'failed'].includes(receipt.state) && receipt.result?.sourceSha === request.job.input.text
    && receipt.artifacts.length === 1 && (request.workerRef === LEGACY_WORKER.workerRef
      ? receipt.state === 'completed' && receipt.result.normalExitCode === 0 && receipt.result.jitlessExitCode === 0
      : repositoryResultState(receipt.result) === receipt.state);
}
export function readResult(logs, request, coordinatorRunId) {
  validateCodingRequest(request);
  const records = coordinatorRecords(logs);
  const intents = records.filter(r => r.marker === 'PICARD_UNATTENDED_INTENT_V1');
  const results = records.filter(r => r.marker === 'PICARD_UNATTENDED_RESULT_V1');
  const intent = intents[0], result = results[0];
  if (records.length !== 2 || intents.length !== 1 || results.length !== 1
    || records[0] !== intent || !validIntent(intent, request, coordinatorRunId)
    || result.schemaVersion !== 1 || result.jobId !== request.job.id || result.coordinatorRunId !== coordinatorRunId
    || !id(result.workerRunId) || result.workerRunUrl !== url(result.workerRunId)
    || result.transport !== 'unattended-mcp-github-rest-api' || result.credential !== 'ephemeral-GITHUB_TOKEN'
    || result.browserUsed !== false || result.savedRecoveryAfterRestart !== true
    || !verifiedReceipt(result.receipt, request)) throw Error('coding_result_not_verified');
  return result;
}
export function workerHistoryPath(start, end) {
  const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
  const from = time(start), to = time(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 86_400_000)
    throw Error('coding_recovery_window_invalid');
  return WORKER_RUNS_PATH + '&created=' + encodeURIComponent(`${new Date(from).toISOString()}..${new Date(to).toISOString()}`);
}
export async function recoverCheck(value, coordinatorHeadSha, coordinatorRunId, workerRunId, { get = githubGet } = {}) {
  const request = validateCodingRequest(value); // Read the original expired request; never renew execution authority.
  if (!sha(coordinatorHeadSha) || !id(coordinatorRunId) || !id(workerRunId)) throw Error('coding_collection_identity_required');
  const coordinator = await get(`/actions/runs/${coordinatorRunId}`);
  validateRun(coordinator, { runId: coordinatorRunId, headSha: coordinatorHeadSha, branch: `compute-request/${request.job.id}`,
    event: 'pull_request', workflow: DISPATCH_WORKFLOW, actor: 'bmartynowicz' });
  if (coordinator.status !== 'completed' || coordinator.conclusion !== 'failure') throw Error('coding_recovery_stop_required');
  const historyPath = workerHistoryPath(coordinator.created_at, coordinator.updated_at);
  if (Date.parse(coordinator.created_at) < request.approvedAt - 1000 || Date.parse(coordinator.created_at) >= request.validUntil)
    throw Error('coding_recovery_window_invalid');
  const jobs = checkedJobs(await get(`/actions/runs/${coordinatorRunId}/jobs?per_page=10`), coordinatorRunId,
    ['offline', 'unattended-dispatch'], { 'unattended-dispatch': 'failure' });
  const records = coordinatorRecords(await get(`/actions/jobs/${jobs.find(j => j.name === 'unattended-dispatch').id}/logs`, true));
  if (records.length !== 2 || !validIntent(records[0], request, coordinatorRunId)
    || records[1].marker !== 'PICARD_UNATTENDED_STOP_V1' || records[1].reason !== 'mcp_operation_failed'
    || records[1].automaticRetries !== 0) throw Error('coding_recovery_stop_required');
  const history = await get(historyPath), runs = workerRuns(history);
  if (!Number.isSafeInteger(history.total_count) || history.total_count < 1 || history.total_count !== runs.length)
    throw Error('coding_recovery_history_incomplete');
  const title = `picard-compute/${request.job.id}/${jobSha256(request.job)}`;
  const matches = runs.filter(r => r.display_title === title);
  if (matches.length !== 1 || matches[0].id !== workerRunId) throw Error('coding_recovery_worker_not_unique');
  const worker = await get(`/actions/runs/${workerRunId}`);
  validateRun(worker, { runId: workerRunId, headSha: request.workerCommit, branch: request.workerRef,
    event: 'workflow_dispatch', workflow: '.github/workflows/compute-worker.yml', actor: 'github-actions[bot]' });
  const created = Date.parse(worker.created_at);
  if (!Number.isFinite(created) || created < Date.parse(coordinator.created_at) || created > Date.parse(coordinator.updated_at)
    || worker.status !== 'completed' || !['success', 'failure'].includes(worker.conclusion) || worker.display_title !== title)
    throw Error('coding_worker_did_not_pass');
  const [job] = checkedJobs(await get(`/actions/runs/${workerRunId}/jobs?per_page=10`), workerRunId,
    ['fixed-project-checks'], { 'fixed-project-checks': worker.conclusion });
  const receipt = readWorkerReceipt(await get(`/actions/jobs/${job.id}/logs`, true));
  if (!verifiedReceipt(receipt, request) || worker.conclusion !== (receipt.state === 'completed' ? 'success' : 'failure'))
    throw Error('coding_result_not_verified');
  for (const runId of [coordinatorRunId, workerRunId]) {
    const artifacts = await get(`/actions/runs/${runId}/artifacts?per_page=10`);
    if (artifacts?.total_count !== 0 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 0)
      throw Error('coding_unexpected_uploaded_artifacts');
  }
  return { state: receipt.state === 'completed' ? 'passed' : 'failed', recovery: 'read-only-worker-log',
    coordinatorState: 'mcp_operation_failed', jobId: request.job.id, sourceSha: request.job.input.text,
    scope: request.workerRef === LEGACY_WORKER.workerRef ? 'compute-broker normal/jitless (legacy worker v1)' : REPOSITORY_SCOPE,
    checks: receipt.result.checks ?? null, coordinatorHeadSha, coordinatorRunUrl: url(coordinatorRunId), workerRunUrl: url(workerRunId),
    receipt, savedRecoveryAfterRestart: false, uploadedArtifacts: 0, automaticRetries: 0 };
}
export async function collectCheck(value, coordinatorHeadSha, coordinatorRunId, { get = githubGet } = {}) {
  const request = validateCodingRequest(value);
  if (!sha(coordinatorHeadSha) || !id(coordinatorRunId)) throw Error('coding_collection_identity_required');
  const coordinator = await get(`/actions/runs/${coordinatorRunId}`);
  validateRun(coordinator, { runId: coordinatorRunId, headSha: coordinatorHeadSha,
    branch: `compute-request/${request.job.id}`, event: 'pull_request', workflow: DISPATCH_WORKFLOW, actor: 'bmartynowicz' });
  if (coordinator.status !== 'completed') return { state: 'pending', coordinatorRunUrl: url(coordinatorRunId), automaticRetries: 0 };
  if (!['success', 'failure'].includes(coordinator.conclusion)) throw Error('coding_coordinator_did_not_pass');
  const jobs = checkedJobs(await get(`/actions/runs/${coordinatorRunId}/jobs?per_page=10`), coordinatorRunId,
    ['offline', 'unattended-dispatch'], { 'unattended-dispatch': coordinator.conclusion });
  const result = readResult(await get(`/actions/jobs/${jobs.find(j => j.name === 'unattended-dispatch').id}/logs`, true), request, coordinatorRunId);
  const conclusion = result.receipt.state === 'completed' ? 'success' : 'failure';
  if (coordinator.conclusion !== conclusion) throw Error('coding_result_not_verified');
  const worker = await get(`/actions/runs/${result.workerRunId}`);
  validateRun(worker, { runId: result.workerRunId, headSha: request.workerCommit, branch: request.workerRef,
    event: 'workflow_dispatch', workflow: '.github/workflows/compute-worker.yml', actor: 'github-actions[bot]' });
  if (worker.status !== 'completed' || worker.conclusion !== conclusion
    || worker.display_title !== `picard-compute/${request.job.id}/${jobSha256(request.job)}`) throw Error('coding_worker_did_not_pass');
  checkedJobs(await get(`/actions/runs/${result.workerRunId}/jobs?per_page=10`), result.workerRunId,
    ['fixed-project-checks'], { 'fixed-project-checks': conclusion });
  for (const runId of [coordinatorRunId, result.workerRunId]) {
    const artifacts = await get(`/actions/runs/${runId}/artifacts?per_page=10`);
    if (artifacts?.total_count !== 0 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 0)
      throw Error('coding_unexpected_uploaded_artifacts');
  }
  return { state: result.receipt.state === 'completed' ? 'passed' : 'failed', jobId: request.job.id, sourceSha: request.job.input.text,
    scope: request.workerRef === LEGACY_WORKER.workerRef ? 'compute-broker normal/jitless (legacy worker v1)' : REPOSITORY_SCOPE,
    checks: result.receipt.result.checks ?? null, coordinatorHeadSha, coordinatorRunUrl: url(coordinatorRunId), workerRunUrl: result.workerRunUrl,
    receipt: result.receipt, savedRecoveryAfterRestart: true, uploadedArtifacts: 0, automaticRetries: 0 };
}
async function main(args) {
  if (args[0] === 'prepare' && args.length === 3) {
    if (/^0+$/.test(WORKER.workerCommit) || WORKER.workerSha256 !== workerSha256()) throw Error('coding_worker_not_enrolled');
    return prepareCheck(args[1], args[2]);
  }
  if ((args[0] === 'collect' && args.length === 4 || args[0] === 'recover' && args.length === 5 && /^[1-9][0-9]*$/.test(args[4]))
    && /^[1-9][0-9]*$/.test(args[3])) {
    const stat = lstatSync(args[1]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error('coding_request_file_invalid');
    const request = JSON.parse(readFileSync(args[1], 'utf8').replace(/^\uFEFF/, ''));
    return args[0] === 'recover' ? recoverCheck(request, args[2], Number(args[3]), Number(args[4]))
      : collectCheck(request, args[2], Number(args[3]));
  }
  throw Error('coding_usage_prepare_SOURCE_SHA_JOB_ID_or_collect_REQUEST_FILE_HEAD_SHA_RUN_ID_or_recover_REQUEST_FILE_HEAD_SHA_RUN_ID_WORKER_RUN_ID');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(value => {
    console.log(JSON.stringify(value, null, 2)); if (value.state === 'failed') process.exitCode = 1;
  }).catch(error => {
    console.error(JSON.stringify({ state: 'unverified', reason: /^coding_[a-zA-Z_]+$/.test(error.message) ? error.message : 'coding_operation_failed', automaticRetries: 0 }));
    process.exitCode = 1;
  });
}
