import { createHash } from 'node:crypto';

export function fixtureResources(now = Date.now()) {
  return ['arm64', 'x64'].map(arch => ({
    id: `fixture-${arch}`, provider: 'local-fixture-not-a-cloud', simulated: true,
    enabled: true, mode: 'vm', arch, operations: ['word-count', 'sha256'],
    observedAt: now, cost: { kind: 'permanent-free', verifiedAt: now,
      validUntil: now + 60_000, maximumIncrementalUsd: 0, evidenceRef: 'synthetic-fixture-only' },
    capacity: { cpuMs: 10_000, ramMb: 256, diskMb: 32, gpus: 0, slots: 2 },
  }));
}
export function fixtureAdapters() {
  const adapter = Object.freeze({ kind: 'local-fixture', async execute(job, { signal }) {
    if (signal.aborted) throw Error('aborted');
    const text = job.input.text;
    if (job.operation === 'word-count') return { simulated: true, operation: job.operation,
      value: text.trim() ? text.trim().split(/\s+/u).length : 0, artifacts: [] };
    if (job.operation === 'sha256') return { simulated: true, operation: job.operation,
      value: createHash('sha256').update(text, 'utf8').digest('hex'), artifacts: [] };
    throw Error('unsupported_operation');
  } });
  return new Map(['arm64', 'x64'].map(arch => [`fixture-${arch}`, adapter]));
}
