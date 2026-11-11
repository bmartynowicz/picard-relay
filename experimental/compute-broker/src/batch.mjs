import { normalizeJob } from './job.mjs';
import { identity } from './policy.mjs';

export const BATCH_LIMITS = Object.freeze({ jobs: 8, inputBytes: 49_152, parallelResources: 2 });
const unresolved = state => ['invoking', 'pending', 'uncertain'].includes(state);
function entries(value, code) {
  if (!Array.isArray(value) || value.length < 1 || value.length > BATCH_LIMITS.jobs) throw Error(code);
  return Array.from(value);
}
export function normalizeBatchIds(value) {
  const ids = entries(value, 'invalid_job_id_batch');
  if (!ids.every(identity) || new Set(ids).size !== ids.length) throw Error('invalid_job_id_batch');
  return ids;
}
export function normalizeBatchJobs(value) {
  const jobs = entries(value, 'invalid_job_batch').map(normalizeJob);
  if (new Set(jobs.map(job => job.id)).size !== jobs.length
    || Buffer.byteLength(JSON.stringify(jobs)) > BATCH_LIMITS.inputBytes) throw Error('invalid_job_batch');
  return jobs;
}
// Batch replies contain bounded routing metadata, never a concatenation of saved results.
export const batchJobSummary = row => ({ id: row.id, state: row.state, resourceId: row.resourceId });

export function createBatchRunner({ get, run }) {
  let active = null;
  return async function runBatch(value) {
    const ids = normalizeBatchIds(value), key = JSON.stringify(ids);
    if (active) {
      if (active.key !== key) throw Error('batch_execution_busy');
      return active.promise;
    }
    // Reject a missing ID before any invocation, including when it appears last.
    const rows = ids.map(get);
    if (rows.some(row => !row)) throw Error('job_not_found');
    const summaries = rows.map(row => ({ ...batchJobSummary(row), disposition: 'unchanged' }));
    const byResource = new Map();
    rows.forEach((row, index) => {
      if (!row.resourceId) return;
      if (!byResource.has(row.resourceId)) byResource.set(row.resourceId, []);
      byResource.get(row.resourceId).push(index);
    });
    const unresolvedGroups = [...byResource.values()].filter(group => group.some(index => unresolved(rows[index].state)));
    const groups = [...byResource.values()].filter(group => !unresolvedGroups.includes(group));
    for (const group of unresolvedGroups) for (const index of group) if (rows[index].state === 'reserved')
      summaries[index] = { ...batchJobSummary(rows[index]), disposition: 'deferred', reason: 'resource_execution_stopped' };
    let next = 0;
    async function worker() {
      while (next < groups.length) {
        const group = groups[next++];
        // Re-read each job before dispatch so concurrent ledger changes remain authoritative.
        let stopped = false, holdSlot = false;
        for (const index of group) {
          const current = get(ids[index]);
          if (current.state !== 'reserved') {
            summaries[index] = { ...batchJobSummary(current), disposition: 'unchanged' };
            if (unresolved(current.state)) { stopped = true; holdSlot = true; }
            continue;
          }
          if (stopped) {
            summaries[index] = { ...batchJobSummary(current), disposition: 'deferred', reason: 'resource_execution_stopped' };
            continue;
          }
          try {
            const outcome = await run(current.id);
            summaries[index] = { ...batchJobSummary(outcome), disposition: 'observed' };
            if (outcome.state !== 'completed') stopped = true;
            if (unresolved(outcome.state)) holdSlot = true;
          } catch {
            // A lost store/adapter outcome must not trigger a retry or switch resources.
            summaries[index] = { ...batchJobSummary(get(current.id)), disposition: 'unavailable', reason: 'execution_outcome_unavailable' };
            stopped = true; holdSlot = true;
          }
        }
        if (holdSlot) return;
      }
    }
    const promise = Promise.resolve().then(async () => {
      const available = Math.max(0, BATCH_LIMITS.parallelResources - unresolvedGroups.length);
      const settled = await Promise.allSettled(Array.from({ length: Math.min(available, groups.length) }, worker));
      if (settled.some(result => result.status === 'rejected')) throw Error('batch_outcome_unavailable');
      for (const group of groups) for (const index of group) if (summaries[index].state === 'reserved' && summaries[index].disposition === 'unchanged')
        summaries[index] = { ...summaries[index], disposition: 'deferred', reason: 'parallel_capacity_held' };
      return { jobs: summaries, maximumParallelResources: BATCH_LIMITS.parallelResources, automaticRetries: 0 };
    });
    active = { key, promise };
    try { return await promise; } finally { active = null; }
  };
}
