import { lstatSync, readFileSync } from 'node:fs';
import { identity, integer } from './policy.mjs';
import { hex256, jobSha256 } from './execution-protocol.mjs';
import { createOracleExecutor } from './oracle-executor.mjs';
import { createGitHubExecutor } from './github-executor.mjs';

const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const envName = value => typeof value === 'string' && /^PICARD_COMPUTE_[A-Z0-9_]{1,64}$/.test(value);
export function readExecutionProfile(filename) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32_768 || (process.platform !== 'win32'
    && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) throw Error('private_execution_profile_required');
  return JSON.parse(readFileSync(filename, 'utf8'));
}
export function createExecutionRegistry(value, { now = Date.now,
  oracleFactory = createOracleExecutor, githubFactory = createGitHubExecutor } = {}) {
  if (!value) return { enabled: false, resources: () => [], adapters: new Map(), authorize: () => false,
    refresh: async () => ({ executionEnabled: false, resources: [] }) };
  // Own a private copy so callers cannot change authority after validation.
  const profile = JSON.parse(JSON.stringify(value));
  if (!exact(profile, ['schemaVersion', 'enabled', 'validUntil', 'approvedJobs', 'providers'])
    || profile.schemaVersion !== 1 || typeof profile.enabled !== 'boolean' || !integer(profile.validUntil, 1)
    || profile.validUntil > now() + 86_400_000 || !Array.isArray(profile.providers) || profile.providers.length > 2
    || !Array.isArray(profile.approvedJobs) || profile.approvedJobs.length > 8) throw Error('invalid_execution_profile');
  const adapters = new Map(), registry = [], kinds = new Set();
  for (const provider of profile.providers) {
    const oracle = provider.kind === 'oracle-fixed-worker';
    if (!exact(provider, oracle ? ['kind', 'resource', 'workerSha256', 'keyEnv', 'ssh']
      : ['kind', 'resource', 'workerSha256', 'tokenEnv', 'tag', 'commitSha'])
      || !['oracle-fixed-worker', 'github-public-ci'].includes(provider.kind) || kinds.has(provider.kind)
      || !hex256(provider.workerSha256) || !envName(oracle ? provider.keyEnv : provider.tokenEnv)) throw Error('invalid_execution_profile');
    kinds.add(provider.kind);
    const r = provider.resource, cpu = oracle ? 3000 : 360_000;
    if (!exact(r, ['id', 'enabled', 'mode', 'arch', 'operations', 'observedAt', 'cost', 'capacity'])
      || !identity(r.id) || adapters.has(r.id) || r.enabled !== true || r.mode !== (oracle ? 'vm' : 'project-ci')
      || r.arch !== 'x64' || !Array.isArray(r.operations)
      || r.operations.join(',') !== (oracle ? 'word-count,sha256' : 'project-checks')
      || !exact(r.capacity, ['cpuMs', 'ramMb', 'diskMb', 'gpus', 'slots'])
      || !integer(r.capacity.cpuMs, cpu) || r.capacity.cpuMs > cpu * 8
      || r.capacity.ramMb !== (oracle ? 128 : 4096) || r.capacity.diskMb !== (oracle ? 1 : 0)
      || r.capacity.gpus !== 0 || r.capacity.slots !== 1
      || !exact(r.cost, ['kind', 'verifiedAt', 'validUntil', 'maximumIncrementalUsd', 'evidenceRef'])
      || r.cost.kind !== (oracle ? 'permanent-free' : 'free-public-ci')) throw Error('invalid_execution_profile');
    // Invalid/stale cost evidence disables admission; it must not prevent reading old receipts.
    const adapter = (oracle ? oracleFactory : githubFactory)(provider, { now });
    adapters.set(r.id, adapter); registry.push({ ...r, enabled: false, observedAt: 0 });
  }
  const authority = new Set();
  for (const approval of profile.approvedJobs) {
    if (!exact(approval, ['jobSha256', 'resourceId', 'validUntil']) || !hex256(approval.jobSha256)
      || !adapters.has(approval.resourceId) || !integer(approval.validUntil, 1)
      || approval.validUntil > profile.validUntil || authority.has(`${approval.resourceId}/${approval.jobSha256}`))
      throw Error('invalid_execution_profile');
    authority.add(`${approval.resourceId}/${approval.jobSha256}`);
  }
  let refreshing;
  const enabled = profile.enabled;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const observations = [];
      for (const r of registry) {
        r.enabled = false; r.observedAt = 0;
        if (!enabled || profile.validUntil <= now()) { observations.push({ id: r.id, ready: false, reason: 'execution_disabled_or_expired' }); continue; }
        try {
          const observation = await adapters.get(r.id).observe();
          r.observedAt = observation.observedAt; r.enabled = true;
          observations.push({ id: r.id, ready: true, details: observation.details });
        } catch { observations.push({ id: r.id, ready: false, reason: 'provider_preflight_unavailable' }); }
      }
      return { executionEnabled: enabled, resources: observations };
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  return { enabled, adapters, resources: () => structuredClone(registry), refresh,
    authorize(job, resourceId, clock) {
      return enabled && clock < profile.validUntil && profile.approvedJobs.some(approval => approval.resourceId === resourceId
        && approval.jobSha256 === jobSha256(job) && approval.validUntil > clock);
    } };
}
