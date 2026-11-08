import { RESULT_MARKER } from './github-job.mjs';

// GitHub repeats repository metadata for each of the twenty runs. Keep other API reads at 128 KiB.
export const WORKER_RUNS_PATH = '/actions/workflows/compute-worker.yml/runs?event=workflow_dispatch&per_page=20';
export const WORKER_RUNS_MAXIMUM_BYTES = 524_288;
export const WORKER_LOG_MAXIMUM_BYTES = 4_194_304;
export function workerRuns(value) {
  if (!Array.isArray(value?.workflow_runs) || value.workflow_runs.length > 20) throw Error('invalid_github_runs');
  return value.workflow_runs;
}
export function readWorkerReceipt(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > WORKER_LOG_MAXIMUM_BYTES) throw Error('invalid_github_receipt');
  const lines = output.split(/\r?\n/).filter(line => line.includes(RESULT_MARKER));
  const match = lines.length === 1 && lines[0].match(/^(?:[0-9T:.+-]+Z )?PICARD_COMPUTE_RESULT_V1:([A-Za-z0-9+/]+={0,2})$/);
  if (!match || Buffer.byteLength(match[1]) > 22_000) throw Error('invalid_github_receipt');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.toString('base64') !== match[1] || bytes.length > 16_384) throw Error('invalid_github_receipt');
  return JSON.parse(bytes.toString('utf8'));
}
