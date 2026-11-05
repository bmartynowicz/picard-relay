import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeJob } from './job.mjs';
import { boundedProcess } from './process.mjs';
import { workerSha256, jobSha256, makeReceipt, hex256 } from './execution-protocol.mjs';
import { runRepositorySuites, repositoryResultState, REPOSITORY_SCOPE } from './repository-checks.mjs';

export const RESULT_MARKER = 'PICARD_COMPUTE_RESULT_V1:';
function logTail(text) {
  let output = '';
  for (const char of [...text.trim().slice(-256)]) { if (Buffer.byteLength(output + char) > 256) break; output += char; }
  return output;
}
export async function runProjectChecks(value, { directory, sourceHash, run = boundedProcess, suites = runRepositorySuites,
  log = () => {}, signal } = {}) {
  const job = normalizeJob(value);
  if (job.operation !== 'project-checks' || job.workload !== 'project-ci' || !hex256(sourceHash)) throw Error('invalid_project_ci_job');
  const env = { PATH: process.env.PATH, CI: 'true', LANG: 'C.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp' };
  const revision = await run('/usr/bin/git', ['rev-parse', '--verify', 'HEAD'], { cwd: directory, env, timeoutMs: 5000, maximumBytes: 1024, signal });
  if (revision.code !== 0 || revision.stdout.trim() !== job.input.text) throw Error('source_revision_mismatch');
  const { checks, logs } = await suites(directory, { log });
  const result = { sourceSha: job.input.text, scope: REPOSITORY_SCOPE, checks };
  const state = repositoryResultState(result);
  return makeReceipt(job, sourceHash, state, result, state === 'completed' ? '' : 'project_checks_failed', logs.map(logTail));
}
async function main() {
  const encoded = process.env.PICARD_JOB_JSON_B64;
  if (typeof encoded !== 'string' || encoded.length > 8192 || Buffer.from(encoded, 'base64').toString('base64') !== encoded)
    throw Error('invalid_project_ci_payload');
  const job = normalizeJob(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
  const sourceHash = workerSha256();
  if (process.env.PICARD_EXPECTED_JOB_ID !== job.id || process.env.PICARD_EXPECTED_JOB_SHA !== jobSha256(job)
    || process.env.PICARD_EXPECTED_WORKER_SHA !== sourceHash) throw Error('project_ci_identity_mismatch');
  const receipt = await runProjectChecks(job, { sourceHash, directory: resolve(process.env.GITHUB_WORKSPACE, 'source'), log: console.log });
  console.log(`${RESULT_MARKER}${Buffer.from(JSON.stringify(receipt)).toString('base64')}`);
  if (receipt.state !== 'completed') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('project_ci_request_rejected'); process.exitCode = 1; });
}
