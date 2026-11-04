import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { createBroker } from '../src/broker.mjs';
import { makeReceipt, PreflightDenied } from '../src/execution-protocol.mjs';
import { CLOCK } from './helpers.mjs';
import { ciJob, liveJob, resource, HASH } from './execution-helpers.mjs';
function setup(t, ci = true) {
  const store = createStore(':memory:'); t.after(() => store.close()); const r = resource(ci); let calls = 0;
  const adapter = { kind: ci ? 'github-public-ci' : 'oracle-fixed-worker', context: { workerSha256: HASH(), scopeSha256: 's' },
    execute: async job => { calls++; return makeReceipt(job, HASH(), ci ? 'accepted' : 'completed', ci ? null : { value: 3 }); },
    lookup: async job => makeReceipt(job, HASH(), 'completed', { value: 3 }) };
  const options = { store, resources: () => [r], adapters: new Map([[r.id, adapter]]), executionEnabled: true, authorize: () => true, now: () => CLOCK };
  return { store, r, adapter, options, calls: () => calls, broker: createBroker(options) };
}
test('live CI dispatches once; collect validates receipt and completes without dispatch or renewed authority', async t => {
  const s = setup(t), job = ciJob(); assert.equal(s.broker.submit(job).state, 'reserved');
  assert.equal((await s.broker.run(job.id)).state, 'pending'); assert.equal((await s.broker.run(job.id)).state, 'pending');
  const restarted = createBroker({ ...s.options, executionEnabled: false, authorize: () => false });
  assert.equal((await restarted.collect(job.id)).state, 'completed'); assert.equal(s.calls(), 1);
  assert.equal(restarted.discover().resources[0].capacity.cpuMs, 360_000);
  assert.equal(restarted.discover().resources[0].capacity.slots, 1);
});
test('revoked exact authority or changed transport context prevents invocation', async t => {
  for (const context of [false, true]) {
    const s = setup(t); const job = ciJob(); s.broker.submit(job);
    if (context) s.adapter.context.scopeSha256 = 'different'; else s.options.authorize = () => false;
    const b = createBroker(s.options); assert.equal((await b.run(job.id)).state, 'failed'); assert.equal(s.calls(), 0);
  }
});
test('unknown dispatch retains capacity and can reconcile by lookup but cannot run again', async t => {
  const s = setup(t), job = ciJob(); let calls = 0;
  s.adapter.execute = async () => { calls++; throw Error('transport_lost'); };
  s.broker.submit(job); assert.equal((await s.broker.run(job.id)).state, 'uncertain');
  assert.equal((await s.broker.run(job.id)).state, 'uncertain'); assert.equal(calls, 1);
  assert.equal(s.broker.discover().resources[0].capacity.slots, 0);
  assert.equal((await s.broker.collect(job.id)).state, 'completed'); assert.equal(calls, 1);
});
test('invalid receipts cannot overwrite uncertainty; collector failures are not cached forever', async t => {
  const s = setup(t), job = ciJob(); s.broker.submit(job); await s.broker.run(job.id);
  let reads = 0; s.adapter.lookup = () => { reads++; throw Error('unavailable'); };
  await assert.rejects(s.broker.collect(job.id)); await assert.rejects(s.broker.collect(job.id)); assert.equal(reads, 2);
  s.adapter.lookup = () => makeReceipt(job, '0'.repeat(64), 'completed', { value: 1 });
  await assert.rejects(s.broker.collect(job.id), /invalid_worker_receipt/); assert.equal(s.broker.get(job.id).state, 'pending');
  s.adapter.context.scopeSha256 = 'changed'; await assert.rejects(s.broker.collect(job.id), /context_unavailable/);
});
test('preflight denial is known failed, Oracle cannot return asynchronous accepted, and final receipt cannot regress', async t => {
  const s = setup(t, false), job = liveJob(); s.adapter.execute = () => { throw new PreflightDenied(); };
  s.broker.submit(job); assert.equal((await s.broker.run(job.id)).state, 'failed');
  const s2 = setup(t, false); s2.adapter.execute = j => makeReceipt(j, HASH(), 'accepted');
  s2.broker.submit(job); assert.equal((await s2.broker.run(job.id)).state, 'uncertain');
  await s2.broker.collect(job.id); s2.store.recordReceipt(job.id, makeReceipt(job, HASH(), 'accepted'), CLOCK);
  assert.equal(s2.broker.get(job.id).state, 'completed');
});
