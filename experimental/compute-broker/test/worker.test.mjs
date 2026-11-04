import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { executeWorker, lookupWorker, workerRequest } from '../src/worker.mjs';
import { signGrant } from '../src/execution-protocol.mjs';
import { CLOCK } from './helpers.mjs';
import { KEY, HASH, liveJob } from './execution-helpers.mjs';
const policy = () => ({ resourceId: 'oracle-worker', keyHex: KEY, maximumJobs: 2, cpuBudgetMs: 6000, validUntil: CLOCK + 10_000 });
const envelope = job => ({ job, grant: signGrant(job, { resourceId: 'oracle-worker', keyHex: KEY, workerHash: HASH(), expiresAt: CLOCK + 5000 }) });
function setup(t) { const store = createStore(':memory:'); t.after(() => store.close());
  return { store, policy: policy(), sourceHash: HASH(), now: () => CLOCK, isolationVerified: true }; }
test('fixed worker verifies exact HMAC scope and expiry before executing', t => {
  const options = setup(t); let calls = 0; options.operation = () => { calls++; return { value: 3 }; };
  for (const change of [e => e.job.input.text = 'changed', e => e.grant.signature = '0'.repeat(64),
    e => e.grant.resourceId = 'another', e => e.grant.workerSha256 = '0'.repeat(64), e => e.grant.expiresAt = CLOCK,
    e => e.command = 'nope']) {
    const input = envelope(liveJob()); change(input); assert.throws(() => executeWorker(input, options));
  }
  assert.equal(calls, 0); assert.equal(options.store.list().length, 0);
  assert.equal(executeWorker(envelope(liveJob()), options).result.value, 3); assert.equal(calls, 1);
});
test('worker replays exact input once and retains independent finite CPU/job limits', t => {
  const options = setup(t); let calls = 0; options.operation = () => ({ calls: ++calls });
  const input = envelope(liveJob()); executeWorker(input, options); executeWorker(input, options);
  assert.equal(calls, 1); assert.throws(() => executeWorker(envelope(liveJob('live-one', { input: { text: 'different' } })), options), /identity_conflict/);
  assert.equal(executeWorker(envelope(liveJob('second')), options).state, 'completed');
  assert.equal(executeWorker(envelope(liveJob('third')), options).reason, 'worker_budget_exhausted'); assert.equal(calls, 2);
});
test('worker denies missing isolation, unsupported operation/resource sizes and expired policy', t => {
  const options = setup(t); const input = envelope(liveJob());
  assert.equal(executeWorker(input, { ...options, isolationVerified: false }).reason, 'worker_isolation_unverified');
  assert.equal(options.store.list().length, 0);
  for (const patch of [{ cpuMs: 2999 }, { ramMb: 129 }, { gpus: 1 }]) {
    const job = liveJob(); Object.assign(job.needs, patch); assert.throws(() => executeWorker(envelope(job), options), /authority_denied/);
  }
  options.policy.validUntil = CLOCK; assert.throws(() => executeWorker(input, options), /policy_expired/);
});
test('interrupted worker intent and uncertain operation never re-execute; recovery survives approval expiry and source update', t => {
  const options = setup(t), input = envelope(liveJob());
  options.store.transaction(() => { options.store.insert(input.job, 'oracle-worker', '', CLOCK);
    options.store.setContext(input.job.id, { workerSha256: HASH() }); options.store.begin(input.job.id, CLOCK); });
  let calls = 0; options.operation = () => { calls++; return {}; };
  assert.equal(executeWorker(input, options).state, 'uncertain'); assert.equal(calls, 0);
  assert.equal(lookupWorker(input, { ...options, now: () => CLOCK + 100_000 }).state, 'uncertain');
  assert.throws(() => executeWorker(input, { ...options, sourceHash: '0'.repeat(64) }), /authority_denied/);
  const other = setup(t); other.operation = () => { throw Error('lost'); };
  assert.equal(executeWorker(input, other).state, 'uncertain');
  assert.equal(executeWorker(input, { ...other, operation: () => { throw Error('must_not_execute'); } }).state, 'uncertain');
});
test('worker stores completed receipt and retrieves it after expiry without new execution', t => {
  const options = setup(t), input = envelope(liveJob());
  assert.equal(executeWorker(input, options).state, 'completed');
  const receipt = lookupWorker(input, { ...options, now: () => CLOCK + 100_000 });
  assert.equal(receipt.result.value, 3); assert.equal(receipt.artifacts[0].name, 'result.json');
  assert.throws(() => workerRequest(input, { ...options, now: CLOCK + 100_000 }), /authority_denied/);
});
