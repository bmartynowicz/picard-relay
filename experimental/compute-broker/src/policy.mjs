// Reviewed and corrected from a Picard-generated pure selector proposal.
export const LIMITS = Object.freeze({ resources: 64, observationAgeMs: 60_000, evidenceAgeMs: 86_400_000 });
export const identity = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const dimensions = ['cpuMs', 'ramMb', 'diskMb', 'gpus'];
const fail = reason => ({ resourceId: null, decisions: [{ id: null, eligible: false, reasons: [reason] }] });

export function validWorkload(job) {
  return object(job) && identity(job.operation) && ['data', 'project-ci'].includes(job.workload)
    && ['any', 'x64', 'arm64'].includes(job.arch) && object(job.needs)
    && dimensions.every(key => integer(job.needs[key], ['cpuMs', 'ramMb'].includes(key) ? 1 : 0));
}

export function selectResource(resources, job, nowMs) {
  if (!integer(nowMs, 1)) return fail('invalid_clock');
  if (!validWorkload(job)) return fail('invalid_job');
  if (!Array.isArray(resources) || resources.length > LIMITS.resources) return fail('invalid_registry');
  const ids = new Set();
  for (const resource of resources) {
    if (!object(resource) || !identity(resource.id)) return fail('invalid_resource_identity');
    if (ids.has(resource.id)) return fail('duplicate_resource_identity');
    ids.add(resource.id);
  }
  const decisions = resources.map(resource => {
    const reasons = [];
    const reject = (condition, reason) => { if (condition) reasons.push(reason); };
    reject(resource.enabled !== true, 'disabled');
    reject(!['vm', 'project-ci'].includes(resource.mode), 'invalid_mode');
    reject(resource.mode === 'project-ci' && job.workload !== 'project-ci', 'project_ci_only');
    reject(!['x64', 'arm64'].includes(resource.arch), 'invalid_architecture');
    reject(job.arch !== 'any' && resource.arch !== job.arch, 'architecture_mismatch');
    const operationsValid = Array.isArray(resource.operations) && resource.operations.length > 0
      && resource.operations.length <= 16 && resource.operations.every(identity)
      && new Set(resource.operations).size === resource.operations.length;
    reject(!operationsValid || !resource.operations.includes(job.operation), 'unsupported_operation');
    reject(!integer(resource.observedAt, 1) || resource.observedAt > nowMs
      || nowMs - resource.observedAt > LIMITS.observationAgeMs, 'stale_or_unknown_observation');
    const cost = resource.cost;
    if (!object(cost)) reasons.push('unknown_cost');
    else {
      reject(!['permanent-free', 'free-public-ci'].includes(cost.kind), 'ineligible_cost_class');
      reject(cost.kind === 'free-public-ci' && resource.mode !== 'project-ci', 'ci_cost_scope_mismatch');
      reject(!integer(cost.verifiedAt, 1) || cost.verifiedAt > nowMs
        || nowMs - cost.verifiedAt > LIMITS.evidenceAgeMs, 'stale_or_unknown_cost_evidence');
      reject(!integer(cost.validUntil, 1) || cost.validUntil <= nowMs, 'expired_cost_evidence');
      reject(cost.maximumIncrementalUsd !== 0 || !identity(cost.evidenceRef), 'zero_cost_unverified');
    }
    if (!object(resource.capacity)) reasons.push('unknown_capacity');
    else {
      for (const key of dimensions) reject(!integer(resource.capacity[key])
        || resource.capacity[key] < job.needs[key], `insufficient_${key}`);
      reject(!integer(resource.capacity.slots, 1), 'no_execution_slot');
    }
    return { id: resource.id, eligible: reasons.length === 0, reasons };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { resourceId: decisions.find(decision => decision.eligible)?.id ?? null, decisions };
}
