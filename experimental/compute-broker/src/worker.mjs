import { normalizeJob } from './job.mjs';
import { identity, integer } from './policy.mjs';
import { hex256, verifyGrant, makeReceipt, fixedOperation } from './execution-protocol.mjs';
import { validateReceipt } from './receipt.mjs';

export function validateWorkerPolicy(policy) {
  if (!policy || !identity(policy.resourceId) || !hex256(policy.keyHex)
    || !integer(policy.maximumJobs, 1) || policy.maximumJobs > 8
    || !integer(policy.cpuBudgetMs, 3000) || policy.cpuBudgetMs > 24_000
    || !integer(policy.validUntil, 1)) throw Error('invalid_worker_policy');
}
export function workerRequest(envelope, { policy, sourceHash, now, recovery = false }) {
  validateWorkerPolicy(policy);
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'grant,job') throw Error('invalid_worker_request');
  const job = normalizeJob(envelope.job);
  if (!['word-count', 'sha256'].includes(job.operation) || job.needs.cpuMs !== 3000
    || job.needs.ramMb < 96 || job.needs.ramMb > 128 || job.needs.diskMb > 1 || job.needs.gpus !== 0
    || !verifyGrant(envelope.grant, job, { resourceId: policy.resourceId, workerHash: sourceHash,
      keyHex: policy.keyHex, now, recovery })) throw Error('worker_authority_denied');
  if (!recovery && policy.validUntil <= now) throw Error('worker_policy_expired');
  return job;
}
function savedReceipt(job, row, sourceHash) {
  return makeReceipt(job, sourceHash, ['completed', 'failed', 'uncertain'].includes(row.state) ? row.state : 'uncertain',
    row.state === 'completed' ? row.result : null,
    row.state === 'completed' ? '' : row.reason || 'invocation_in_progress_or_interrupted');
}
export function executeWorker(envelope, { store, policy, sourceHash, now = Date.now, isolationVerified = false,
  operation = fixedOperation }) {
  const job = workerRequest(envelope, { policy, sourceHash, now: now() });
  if (!isolationVerified) return makeReceipt(job, sourceHash, 'failed', null, 'worker_isolation_unverified');
  const row = store.transaction(() => {
    const replay = store.replay(job);
    if (replay) return replay;
    const remaining = store.effective([{ id: policy.resourceId, capacity: {
      cpuMs: policy.cpuBudgetMs, ramMb: 128, diskMb: 1, gpus: 0, slots: 1 } }])[0].capacity;
    if (store.list().length >= policy.maximumJobs || remaining.cpuMs < 3000 || remaining.slots < 1)
      return null;
    store.insert(job, policy.resourceId, '', now());
    store.setContext(job.id, { workerSha256: sourceHash });
    if (!store.begin(job.id, now())) throw Error('worker_claim_failed');
    return { claimed: true };
  });
  if (!row) return makeReceipt(job, sourceHash, 'failed', null, 'worker_budget_exhausted');
  if (!row.claimed) {
    const context = store.context(job.id);
    if (context?.workerSha256 !== sourceHash) throw Error('worker_context_changed');
    return savedReceipt(job, row, sourceHash);
  }
  try {
    const result = operation(job);
    const candidate = makeReceipt(job, sourceHash, 'completed', result);
    if (!validateReceipt(candidate, { jobId: candidate.jobId, jobSha256: candidate.jobSha256, workerSha256: sourceHash }))
      throw Error('invalid_operation_result');
    const saved = store.finish(job.id, 'completed', result, '', now());
    return makeReceipt(job, sourceHash, 'completed', saved.result, '', ['fixed_operation_completed']);
  } catch {
    store.finish(job.id, 'uncertain', null, 'worker_outcome_uncertain', now());
    return makeReceipt(job, sourceHash, 'uncertain', null, 'worker_outcome_uncertain');
  }
}
export function lookupWorker(envelope, { store, policy, now = Date.now }) {
  const context = store.context(envelope?.job?.id);
  const sourceHash = context?.workerSha256;
  if (!hex256(sourceHash)) throw Error('worker_result_not_found');
  const job = workerRequest(envelope, { policy, sourceHash, now: now(), recovery: true });
  const row = store.replay(job);
  if (!row) throw Error('worker_result_not_found');
  return savedReceipt(job, row, sourceHash);
}
