import { readFileSync } from 'node:fs';
import { selectResource } from './policy.mjs';
import { sha256, jobSha256, makeReceipt, workerSha256, PreflightDenied } from './execution-protocol.mjs';
import { WORKER_RUNS_PATH, WORKER_RUNS_MAXIMUM_BYTES, WORKER_LOG_MAXIMUM_BYTES, workerRuns, readWorkerReceipt } from './github-result.mjs';

export const EXECUTION_REPOSITORY = 'bmartynowicz/picard-relay';
export const EXECUTION_WORKFLOW = '.github/workflows/compute-worker.yml';
const API = `https://api.github.com/repos/${EXECUTION_REPOSITORY}`;
const validId = id => Number.isSafeInteger(id) && id > 0;
export const freeWorkflowSha256 = () => sha256(readFileSync(new URL('../../../.github/workflows/compute-worker.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
export function createGitHubExecutor(profile, { token = () => process.env[profile.tokenEnv], fetchImpl = fetch,
  now = Date.now, expectedWorker = workerSha256, expectedWorkflow = freeWorkflowSha256 } = {}) {
  if (!/^compute-worker-v[1-9][0-9]*$/.test(profile.tag) || !/^[0-9a-f]{40}$/.test(profile.commitSha)
    || (profile.refKind !== undefined && !['tag', 'branch'].includes(profile.refKind))) throw Error('invalid_github_execution_profile');
  const context = Object.freeze({ kind: 'github-public-ci', workerSha256: profile.workerSha256,
    scopeSha256: sha256(JSON.stringify({ resourceId: profile.resource.id, repository: EXECUTION_REPOSITORY,
      tag: profile.tag, commitSha: profile.commitSha, tokenEnv: profile.tokenEnv,
      ...(profile.refKind ? { refKind: profile.refKind } : {}) })) });
  const runName = job => `picard-compute/${job.id}/${jobSha256(job)}`;
  async function body(response, maximum = 131_072) {
    let count = 0; const chunks = [];
    for await (const chunk of response.body) { count += chunk.length; if (count > maximum) throw Error('github_response_too_large'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function api(method, path, value, signal, maximum = 131_072) {
    const credential = token();
    if (method === 'POST' && (typeof credential !== 'string' || !/^[A-Za-z0-9_.-]{20,4096}$/.test(credential))) throw Error('github_execution_credential_unavailable');
    const response = await fetchImpl(`${API}${path}`, { method, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'picard-compute-worker',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(value ? { 'content-type': 'application/json' } : {}) },
      ...(value ? { body: JSON.stringify(value) } : {}) });
    if (method === 'POST') {
      await response.body?.cancel(); if (response.status !== 204) throw Error('github_dispatch_outcome_unknown'); return null;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw Error('github_execution_unavailable'); }
    return JSON.parse(await body(response, maximum));
  }
  async function observe({ signal } = {}) {
    if (typeof token() !== 'string' || !/^[A-Za-z0-9_.-]{20,4096}$/.test(token())
      || expectedWorker() !== profile.workerSha256) throw Error('github_execution_not_ready');
    const repository = await api('GET', '', undefined, signal);
    if (repository.full_name !== EXECUTION_REPOSITORY || repository.private !== false || repository.archived !== false)
      throw Error('public_project_required');
    const ref = await api('GET', `/git/ref/${profile.refKind === 'branch' ? 'heads' : 'tags'}/${profile.tag}`, undefined, signal);
    if (ref.object?.type !== 'commit' || ref.object.sha !== profile.commitSha) throw Error('github_worker_ref_changed');
    const file = await api('GET', `/contents/${EXECUTION_WORKFLOW}?ref=${profile.commitSha}`, undefined, signal);
    if (file.type !== 'file' || file.path !== EXECUTION_WORKFLOW || file.encoding !== 'base64'
      || typeof file.content !== 'string' || sha256(Buffer.from(file.content, 'base64').toString('utf8').replaceAll('\r\n', '\n')) !== expectedWorkflow())
      throw Error('github_free_workflow_changed');
    return { observedAt: now(), details: { publicProject: true, fixedStandardRunnerWorkflow: true, commitSha: profile.commitSha } };
  }
  async function logs(jobId) {
    const credential = token();
    let response = await fetchImpl(`${API}/actions/jobs/${jobId}/logs`, { method: 'GET', redirect: 'manual',
      signal: AbortSignal.timeout(5000), headers: { accept: 'application/vnd.github+json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) } });
    if (response.status === 302) {
      const location = new URL(response.headers.get('location'));
      await response.body?.cancel();
      if (location.protocol !== 'https:' || location.username || location.password || location.port
        || !['.blob.core.windows.net', '.actions.githubusercontent.com'].some(suffix => location.hostname.endsWith(suffix)))
        throw Error('github_log_location_rejected');
      // The signed redirect URL is transient. Never persist it or forward the API credential.
      response = await fetchImpl(location.href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
    }
    if (response.status !== 200) { await response.body?.cancel(); throw Error('github_logs_unavailable'); }
    return body(response, WORKER_LOG_MAXIMUM_BYTES);
  }
  return { kind: 'github-public-ci', context, observe,
    async execute(job, { signal, mayDispatch = () => false } = {}) {
      try {
        if (job.operation !== 'project-checks' || job.workload !== 'project-ci' || job.needs.cpuMs !== 360_000
          || profile.resource.cost?.kind !== 'free-public-ci' || expectedWorker() !== profile.workerSha256
          || !token() || selectResource([{ ...profile.resource, observedAt: now() }], job, now()).resourceId !== profile.resource.id)
          throw Error('ineligible');
        await observe({ signal });
        signal?.throwIfAborted();
        if (mayDispatch() !== true) throw Error('authority_expired');
      } catch { throw new PreflightDenied(); }
      await api('POST', '/actions/workflows/compute-worker.yml/dispatches', { ref: profile.tag, inputs: {
        job_id: job.id, job_sha256: jobSha256(job), worker_sha256: profile.workerSha256,
        source_sha: job.input.text, job_json_b64: Buffer.from(JSON.stringify(job)).toString('base64'),
      } }, signal);
      return makeReceipt(job, profile.workerSha256, 'accepted');
    },
    async lookup(job) {
      const result = await api('GET', WORKER_RUNS_PATH, undefined, undefined, WORKER_RUNS_MAXIMUM_BYTES);
      const matches = workerRuns(result).filter(run => run.display_title === runName(job)
        && run.head_sha === profile.commitSha && run.event === 'workflow_dispatch' && run.path === EXECUTION_WORKFLOW && validId(run.id));
      if (matches.length !== 1) return makeReceipt(job, profile.workerSha256, 'uncertain', null,
        matches.length ? 'multiple_matching_ci_runs' : 'ci_run_not_found');
      const run = matches[0];
      if (run.run_attempt !== 1) throw Error('github_rerun_not_approved');
      if (run.status !== 'completed') return makeReceipt(job, profile.workerSha256, 'accepted');
      const jobs = await api('GET', `/actions/runs/${run.id}/jobs?per_page=10`);
      if (!Array.isArray(jobs.jobs) || jobs.jobs.length !== 1) throw Error('invalid_github_jobs');
      const workerJob = jobs.jobs[0];
      if (!validId(workerJob.id) || workerJob.run_id !== run.id || workerJob.run_attempt !== 1 || workerJob.name !== 'fixed-project-checks'
        || !Array.isArray(workerJob.labels) || !workerJob.labels.includes('ubuntu-latest') || workerJob.labels.includes('self-hosted'))
        throw Error('unexpected_github_runner');
      const receipt = readWorkerReceipt(await logs(workerJob.id));
      if (!['completed', 'failed'].includes(receipt?.state)
        || (receipt.state === 'completed' && run.conclusion !== 'success') || (receipt.state === 'failed' && run.conclusion !== 'failure'))
        throw Error('github_outcome_mismatch');
      return receipt;
    },
  };
}
