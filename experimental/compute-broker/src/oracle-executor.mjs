import { oracleProbePlan } from './oracle-inventory.mjs';
import { boundedProcess } from './process.mjs';
import { selectResource } from './policy.mjs';
import { jobSha256, signGrant, sha256, workerSha256, PreflightDenied, hex256 } from './execution-protocol.mjs';

export function createOracleExecutor(profile, { key = () => process.env[profile.keyEnv], run = boundedProcess,
  now = Date.now, expectedWorker = workerSha256 } = {}) {
  const ssh = oracleProbePlan(profile.ssh);
  if (profile.ssh.username !== 'picard-compute-worker' || !hex256(profile.workerSha256)) throw Error('invalid_oracle_execution_profile');
  const context = Object.freeze({ kind: 'oracle-fixed-worker', workerSha256: profile.workerSha256,
    scopeSha256: sha256(JSON.stringify({ resourceId: profile.resource.id, ssh: profile.ssh, keyEnv: profile.keyEnv })) });
  async function call(action, input, signal) {
    const result = await run(ssh.command, [...ssh.args.slice(0, -1), `picard-compute-${action}-v1`],
      { input: input ? JSON.stringify(input) : '', timeoutMs: 12_000, maximumBytes: 32_768, signal });
    if (result.code !== 0) throw Error('oracle_worker_unavailable');
    const value = JSON.parse(result.stdout);
    return value;
  }
  async function observe({ signal } = {}) {
    if (!hex256(key()) || expectedWorker() !== profile.workerSha256) throw Error('oracle_worker_not_ready');
    const data = await call('identity', undefined, signal);
    if (data.schemaVersion !== 1 || data.resourceId !== profile.resource.id || data.workerSha256 !== profile.workerSha256
      || data.shape !== 'VM.Standard.E2.1.Micro' || data.architecture !== 'x64' || data.isolationVerified !== true
      || !Number.isSafeInteger(data.remainingCpuMs) || data.remainingCpuMs < 3000
      || data.slots !== 1 || !Number.isSafeInteger(data.memoryAvailableBytes) || data.memoryAvailableBytes < 256 * 1024 * 1024)
      throw Error('oracle_worker_not_ready');
    return { observedAt: now(), details: { shape: data.shape, architecture: data.architecture,
      remainingWorkerCpuMs: data.remainingCpuMs, isolationVerified: true } };
  }
  const envelope = job => ({ job, grant: signGrant(job, { resourceId: profile.resource.id,
    workerHash: profile.workerSha256, expiresAt: now() + 300_000, keyHex: key() }) });
  return { kind: 'oracle-fixed-worker', context, observe,
    async execute(job, { signal, mayDispatch = () => false } = {}) {
      try {
        if (profile.resource.cost?.kind !== 'permanent-free' || expectedWorker() !== profile.workerSha256
          || !hex256(key()) || !['word-count', 'sha256'].includes(job.operation) || job.needs.cpuMs !== 3000
          || selectResource([{ ...profile.resource, observedAt: now() }], job, now()).resourceId !== profile.resource.id)
          throw Error('ineligible');
        await observe({ signal });
        signal?.throwIfAborted();
        if (mayDispatch() !== true) throw Error('authority_expired');
      } catch { throw new PreflightDenied(); }
      return call('execute', envelope(job), signal);
    },
    // This is a different fixed server command; never re-submit an uncertain job.
    lookup: job => call('lookup', envelope(job)),
  };
}
