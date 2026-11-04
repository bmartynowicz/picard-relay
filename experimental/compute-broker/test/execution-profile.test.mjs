import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionRegistry, readExecutionProfile } from '../src/execution-profile.mjs';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBroker } from '../src/broker.mjs';
import { createStore } from '../src/store.mjs';
import { jobSha256 } from '../src/execution-protocol.mjs';
import { CLOCK } from './helpers.mjs';
import { provider, liveJob, ciJob, HASH } from './execution-helpers.mjs';
const profile = () => ({ schemaVersion: 1, enabled: true, validUntil: CLOCK + 60_000,
  providers: [provider(), provider(true)], approvedJobs: [liveJob(), ciJob()].map((job, i) => ({ jobSha256: jobSha256(job),
    resourceId: i ? 'github-ci' : 'oracle-worker', validUntil: CLOCK + 30_000 })) });
function setup(value = profile(), fail = false) {
  let reads = 0;
  const factory = p => ({ kind: p.kind, context: { workerSha256: HASH() }, observe: async () => {
    reads++; await new Promise(r => setImmediate(r)); if (fail) throw Error('unavailable'); return { observedAt: CLOCK, details: {} }; } });
  return { registry: createExecutionRegistry(value, { now: () => CLOCK, oracleFactory: factory, githubFactory: factory }), reads: () => reads };
}
test('default and disabled profiles make no network calls; enabled profiles require explicit refresh', async () => {
  assert.equal(createExecutionRegistry().enabled, false);
  const disabled = profile(); disabled.enabled = false; const d = setup(disabled); await d.registry.refresh(); assert.equal(d.reads(), 0);
  const s = setup(); assert.ok(s.registry.resources().every(r => r.enabled === false)); assert.equal(s.reads(), 0);
  await Promise.all([s.registry.refresh(), s.registry.refresh()]); assert.equal(s.reads(), 2);
  assert.ok(s.registry.resources().every(r => r.enabled));
});
test('finite exact job authority cannot widen, expire or mutate under caller changes', async () => {
  const p = profile(), s = setup(p); await s.registry.refresh();
  assert.equal(s.registry.authorize(liveJob(), 'oracle-worker', CLOCK), true);
  assert.equal(s.registry.authorize(liveJob('another'), 'oracle-worker', CLOCK), false);
  assert.equal(s.registry.authorize(liveJob(), 'github-ci', CLOCK), false);
  assert.equal(s.registry.authorize(liveJob(), 'oracle-worker', CLOCK + 30_000), false);
  p.approvedJobs[0].validUntil = CLOCK + 50_000;
  assert.equal(s.registry.authorize(liveJob(), 'oracle-worker', CLOCK + 30_000), false);
});
test('malformed/widened profiles and credential material are rejected', () => {
  for (const change of [p => p.token = 'secret', p => p.providers[0].keyHex = 'secret',
    p => p.providers[0].resource.capacity.cpuMs = 100_000, p => p.providers[1].resource.operations.push('sha256'),
    p => p.providers[0].keyEnv = 'HOME', p => p.approvedJobs.push(p.approvedJobs[0]),
    p => p.validUntil = CLOCK + 86_400_001, p => p.providers.push(p.providers[0])]) {
    const p = profile(); change(p); assert.throws(() => setup(p), /invalid_execution_profile/);
  }
});
test('failed readiness and stale/paid cost evidence cannot reserve a live job', async t => {
  const store = createStore(':memory:'); t.after(() => store.close());
  const s = setup(profile(), true); await s.registry.refresh();
  const broker = createBroker({ store, resources: s.registry.resources, adapters: s.registry.adapters,
    executionEnabled: true, authorize: s.registry.authorize, now: () => CLOCK });
  assert.equal(broker.submit(liveJob()).state, 'blocked');
  const p = profile(); p.providers[0].resource.cost.kind = 'trial'; assert.throws(() => setup(p), /invalid_execution_profile/);
  const stale = profile(); stale.providers[0].resource.cost.verifiedAt = CLOCK - 86_400_001;
  const staleRegistry = setup(stale).registry; await staleRegistry.refresh();
  const b = createBroker({ store, resources: staleRegistry.resources, adapters: staleRegistry.adapters,
    executionEnabled: true, authorize: staleRegistry.authorize, now: () => CLOCK });
  assert.equal(b.plan(liveJob('stale')).resourceId, null);
});
test('POSIX execution profiles must be private owned regular bounded files', { skip: process.platform === 'win32' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-profile-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'execution.json'); writeFileSync(path, JSON.stringify(profile()), { mode: 0o600 });
  assert.equal(readExecutionProfile(path).schemaVersion, 1);
  chmodSync(path, 0o644); assert.throws(() => readExecutionProfile(path), /private_execution_profile_required/);
  chmodSync(path, 0o600); const link = join(directory, 'link.json'); symlinkSync(path, link);
  assert.throws(() => readExecutionProfile(link), /private_execution_profile_required/);
  writeFileSync(path, 'x'.repeat(32_769)); assert.throws(() => readExecutionProfile(path), /private_execution_profile_required/);
});
