import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.mjs';
import { createBroker } from '../src/broker.mjs';
import { BATCH_LIMITS, createBatchRunner } from '../src/batch.mjs';
import { fixtureAdapters } from '../src/fixtures.mjs';
import { createExecutionRegistry } from '../src/execution-profile.mjs';
import { makeReceipt, jobSha256 } from '../src/execution-protocol.mjs';
import { CLOCK, registry, job } from './helpers.mjs';
import { provider, liveJob, ciJob, HASH } from './execution-helpers.mjs';

function setup(t, changes = {}) {
  const store = changes.store ?? createStore(':memory:'); t.after(() => store.close());
  const options = { store, resources: registry, adapters: fixtureAdapters(), fixtureMode: true, now: () => CLOCK, ...changes };
  return { store, broker: createBroker(options), options };
}

test('batch admission routes before execution and keeps reservations within capacity', async t => {
  const { broker } = setup(t);
  const jobs = [job('cpu-one'), job('cpu-two'), job('blocked'), job('arm', { arch: 'arm64' })];
  const admitted = broker.submitBatch(jobs);
  assert.deepEqual(admitted.map(r => [r.state, r.resourceId]), [
    ['reserved', 'fixture-x64'], ['reserved', 'fixture-x64'], ['blocked', null], ['reserved', 'fixture-arm64']]);
  assert.equal(broker.get('cpu-one').result, null);
  const answer = await broker.runBatch(jobs.map(j => j.id));
  assert.deepEqual(answer.jobs.map(r => r.state), ['completed', 'completed', 'blocked', 'completed']);
  assert.ok(answer.jobs.every(r => !Object.hasOwn(r, 'result')));
  assert.equal(broker.get('cpu-one').result.value, 3);
  assert.equal(broker.discover().resources.find(r => r.id === 'fixture-x64').capacity.cpuMs, 9800);
  assert.deepEqual(broker.submitBatch(jobs), jobs.map(j => broker.get(j.id)));
  assert.deepEqual((await broker.runBatch(jobs.map(j => j.id))).jobs.map(r => r.disposition), Array(4).fill('unchanged'));
});

test('invalid, duplicate, oversized and conflicting batches never leave partial reservations', t => {
  const { broker } = setup(t); broker.submit(job('existing'));
  const before = broker.discover();
  for (const value of [[], Array(9).fill(job()), [job(), job()], [job('new'), { ...job('bad'), command: 'nope' }],
    [job('large', { input: { text: '\0'.repeat(9000) } })], new Array(1)]) {
    assert.throws(() => broker.submitBatch(value), /invalid_job_batch|unknown_job_field|invalid_job/);
    assert.equal(broker.get('new'), null);
  }
  assert.throws(() => broker.submitBatch([job('new'), job('existing', { input: { text: 'changed' } })]), /job_identity_conflict/);
  assert.equal(broker.get('new'), null); assert.equal(broker.list().length, 1);
  assert.deepEqual(broker.discover(), before);
});

test('all eight jobs fit the metadata-only batch response even with large saved answers', async t => {
  const resources = registry(); resources[1].capacity = { cpuMs: 10000, ramMb: 1024, diskMb: 0, gpus: 0, slots: 8 };
  const adapters = new Map([['fixture-x64', { kind: 'local-fixture', execute: () => ({ text: 'x'.repeat(16000) }) }]]);
  const { broker } = setup(t, { resources: () => resources, adapters });
  const jobs = Array.from({ length: 8 }, (_, i) => job('large-result-' + i)); broker.submitBatch(jobs);
  const answer = await broker.runBatch(jobs.map(j => j.id));
  assert.ok(answer.jobs.every(r => r.state === 'completed'));
  assert.ok(Buffer.byteLength(JSON.stringify(answer)) < 2048);
  assert.equal(broker.get(jobs[0].id).result.text.length, 16000);
});

test('parallelism is bounded across resources, same-resource jobs serialize, and overlapping batches cannot multiply it', async t => {
  const resources = ['a', 'b', 'c'].map((id, i) => ({ ...registry()[1], id, capacity: { cpuMs: 10000, ramMb: 256, diskMb: 0, gpus: 0, slots: i === 0 ? 2 : 1 } }));
  let release, started; const gate = new Promise(r => { release = r; }); const twoStarted = new Promise(r => { started = r; });
  t.after(release); let active = 0, peak = 0; const perResource = new Map(), calls = [];
  const adapters = new Map(resources.map(resource => [resource.id, { kind: 'local-fixture', async execute(j) {
    calls.push(j.id); active++; peak = Math.max(peak, active);
    assert.equal(perResource.get(resource.id) ?? 0, 0); perResource.set(resource.id, 1);
    if (active === 2) started(); await gate;
    active--; perResource.set(resource.id, 0); return { value: 3 };
  } }]));
  const { broker } = setup(t, { resources: () => resources, adapters });
  const jobs = ['a-one', 'a-two', 'b-one', 'c-one'].map(id => job(id)); broker.submitBatch(jobs);
  const ids = jobs.map(j => j.id), first = broker.runBatch(ids); await twoStarted;
  assert.equal(calls.length, 2); assert.ok(!calls.includes('a-two'));
  const same = broker.runBatch(ids);
  await assert.rejects(broker.runBatch(['c-one']), /batch_execution_busy/);
  release(); const [one, two] = await Promise.all([first, same]);
  assert.deepEqual(one, two); assert.equal(peak, BATCH_LIMITS.parallelResources);
  assert.equal(new Set(calls).size, 4); assert.equal(calls.length, 4);
});

test('a lost worker defers its remaining jobs without stopping another resource or retrying uncertainty', async t => {
  const calls = [], adapters = fixtureAdapters();
  adapters.set('fixture-x64', { kind: 'local-fixture', execute(j) { calls.push(j.id); throw Error('private transport detail'); } });
  const { broker } = setup(t, { adapters });
  broker.submitBatch([job('lost'), job('later'), job('other', { arch: 'arm64' })]);
  const result = await broker.runBatch(['lost', 'later', 'other']);
  assert.deepEqual(result.jobs.map(r => [r.state, r.disposition]), [['uncertain', 'observed'], ['reserved', 'deferred'], ['completed', 'observed']]);
  assert.doesNotMatch(JSON.stringify(result), /private transport/);
  const repeated = await broker.runBatch(['later', 'lost', 'other']);
  assert.equal(repeated.jobs[0].disposition, 'deferred'); assert.deepEqual(calls, ['lost']);
  assert.equal(broker.discover().resources.find(r => r.id === 'fixture-x64').capacity.slots, 0);
});

test('changed cost/eligibility fails closed on the assigned resource without rerouting', async t => {
  const resources = registry(), calls = [], adapters = fixtureAdapters();
  adapters.set('fixture-x64', { kind: 'local-fixture', execute(j) { calls.push(j.id); return {}; } });
  const { broker } = setup(t, { resources: () => resources, adapters });
  broker.submitBatch([job('first'), job('later'), job('other', { arch: 'arm64' })]);
  resources[1].cost.kind = 'paid';
  const answer = await broker.runBatch(['first', 'later', 'other']);
  assert.deepEqual(answer.jobs.map(r => r.state), ['failed', 'reserved', 'completed']);
  assert.equal(answer.jobs[1].disposition, 'deferred'); assert.equal(calls.length, 0);
  assert.equal(broker.get('first').resourceId, 'fixture-x64');
});

test('unresolved selected resources hold batch parallel slots, even when listed last', async t => {
  const resources = ['a', 'b', 'c'].map(id => ({ ...registry()[1], id, capacity: { cpuMs: 10000, ramMb: 256, diskMb: 0, gpus: 0, slots: 1 } }));
  let active = 0, peak = 0; const calls = [];
  const adapters = new Map(resources.map(r => [r.id, { kind: 'local-fixture', async execute(j) {
    calls.push(j.id); active++; peak = Math.max(peak, active); await new Promise(r => setImmediate(r)); active--; return {};
  } }]));
  const { store, broker } = setup(t, { resources: () => resources, adapters });
  broker.submitBatch([job('a'), job('b'), job('c')]); store.begin('a', CLOCK); store.recover(CLOCK);
  const result = await broker.runBatch(['b', 'c', 'a']);
  assert.equal(result.jobs[2].state, 'uncertain'); assert.deepEqual(calls, ['b', 'c']); assert.equal(peak, 1);
});

test('two uncertain resource groups defer unstarted jobs instead of starting another provider', async t => {
  const resources = ['a', 'b', 'c'].map(id => ({ ...registry()[1], id, capacity: { cpuMs: 10000, ramMb: 256, diskMb: 0, gpus: 0, slots: 1 } }));
  const calls = [], adapters = new Map(resources.map(r => [r.id, { kind: 'local-fixture', execute(j) { calls.push(j.id); throw Error('outcome lost'); } }]));
  const { broker } = setup(t, { resources: () => resources, adapters }); broker.submitBatch([job('a'), job('b'), job('c')]);
  const result = await broker.runBatch(['a', 'b', 'c']);
  assert.deepEqual(result.jobs.map(r => r.state), ['uncertain', 'uncertain', 'reserved']);
  assert.equal(result.jobs[2].reason, 'parallel_capacity_held'); assert.deepEqual(calls, ['a', 'b']);
  assert.equal((await broker.runBatch(['c', 'a', 'b'])).jobs[0].disposition, 'deferred'); assert.deepEqual(calls, ['a', 'b']);
});

test('all IDs are validated before a batch can invoke, and disabled execution stays disabled', async t => {
  const { broker } = setup(t, { fixtureMode: false });
  broker.submitBatch([job('one'), job('two')]);
  for (const ids of [[], ['one', 'one'], ['one', 'missing'], ['one', null], new Array(1), Array(9).fill('one')])
    await assert.rejects(broker.runBatch(ids), /invalid_job_id_batch|job_not_found/);
  assert.deepEqual((await broker.runBatch(['one', 'two'])).jobs.map(r => r.state), ['blocked', 'blocked']);
  assert.equal(broker.get('one').updatedAt, CLOCK);
});

test('restart preserves each saved result and interrupted invocation; batch replay does not resend', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-batch-restart-')), filename = join(directory, 'ledger.sqlite');
  let store = createStore(filename), broker = createBroker({ store, resources: registry, adapters: fixtureAdapters(), fixtureMode: true, now: () => CLOCK });
  const jobs = [job('saved'), job('interrupted')]; broker.submitBatch(jobs); await broker.run('saved'); store.begin('interrupted', CLOCK); store.close();
  store = createStore(filename); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  let calls = 0; const adapters = new Map([['fixture-x64', { kind: 'local-fixture', execute() { calls++; return {}; } }]]);
  broker = createBroker({ store, resources: registry, adapters, fixtureMode: true, now: () => CLOCK });
  assert.deepEqual(broker.submitBatch(jobs).map(r => r.state), ['completed', 'invoking']);
  assert.deepEqual((await broker.runBatch(jobs.map(j => j.id))).jobs.map(r => r.state), ['completed', 'invoking']);
  broker.recover(); assert.equal((await broker.runBatch(['interrupted'])).jobs[0].state, 'uncertain');
  assert.equal(calls, 0); assert.equal(broker.get('saved').result.value, 3);
});

test('two ledger connections cannot admit a batch over shared capacity or duplicate invocation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-batch-shared-')), filename = join(directory, 'ledger.sqlite');
  const stores = [createStore(filename), createStore(filename)];
  t.after(() => { stores.forEach(s => s.close()); rmSync(directory, { recursive: true, force: true }); });
  const resources = registry(); resources[1].capacity.slots = 1; let calls = 0;
  const adapters = new Map([['fixture-x64', { kind: 'local-fixture', async execute() { calls++; return {}; } }]]);
  const brokers = stores.map(store => createBroker({ store, resources: () => resources, adapters, fixtureMode: true, now: () => CLOCK }));
  assert.equal(brokers[0].submitBatch([job('shared')])[0].state, 'reserved');
  assert.equal(brokers[1].submitBatch([job('blocked')])[0].state, 'blocked');
  await Promise.all(brokers.map(broker => broker.runBatch(['shared']))); assert.equal(calls, 1);
});

test('Oracle and GitHub adapter receipts remain separate, exact-approved and recoverable after expiry', async t => {
  const jobs = [liveJob('oracle'), ciJob('github')], providers = [provider(), provider(true)];
  let clock = CLOCK; const calls = [], lookups = [];
  const factory = p => ({ kind: p.kind, context: { workerSha256: HASH(), scope: p.resource.id },
    observe: async () => ({ observedAt: clock, details: {} }),
    execute: async j => { calls.push(j.id); return makeReceipt(j, HASH(), p.kind === 'github-public-ci' ? 'accepted' : 'completed', p.kind === 'github-public-ci' ? null : { value: 3 }); },
    lookup: async j => { lookups.push(j.id); return makeReceipt(j, HASH(), 'completed', { checked: true }); } });
  const execution = createExecutionRegistry({ schemaVersion: 1, enabled: true, validUntil: CLOCK + 60000, providers,
    approvedJobs: jobs.map((j, i) => ({ resourceId: providers[i].resource.id, jobSha256: jobSha256(j), validUntil: CLOCK + 60000 })) },
  { now: () => clock, oracleFactory: factory, githubFactory: factory });
  await execution.refresh();
  const { store, broker } = setup(t, { fixtureMode: false, executionEnabled: true, authorize: execution.authorize,
    resources: execution.resources, adapters: execution.adapters, now: () => clock });
  assert.deepEqual(broker.submitBatch(jobs).map(r => r.resourceId), ['oracle-worker', 'github-ci']);
  assert.deepEqual((await broker.runBatch(jobs.map(j => j.id))).jobs.map(r => r.state), ['completed', 'pending']);
  clock += 60001;
  const restarted = createBroker({ store, resources: execution.resources, adapters: execution.adapters, executionEnabled: false, now: () => clock });
  await restarted.runBatch(['oracle', 'github']); assert.equal(calls.length, 2);
  assert.equal((await restarted.collect('github')).state, 'completed'); assert.deepEqual(lookups, ['github']);
  assert.equal((await restarted.runBatch(['github'])).jobs[0].state, 'completed'); assert.equal(calls.length, 2);
  assert.equal(restarted.submitBatch([liveJob('not-approved')])[0].state, 'blocked');
});

test('batch waits for other in-flight work before reporting a store failure', async () => {
  let release, began; const gate = new Promise(r => { release = r; }); const started = new Promise(r => { began = r; });
  const rows = new Map(['one', 'two'].map(id => [id, { id, state: 'reserved', resourceId: id }])); let failedRead = false;
  const runner = createBatchRunner({ get(id) { if (failedRead && id === 'one') throw Error('private database detail'); return rows.get(id); },
    async run(id) { if (id === 'one') { await started; failedRead = true; throw Error('lost store'); } began(); await gate; return { ...rows.get(id), state: 'completed' }; } });
  let settled = false; const running = runner(['one', 'two']); running.catch(() => { settled = true; });
  await started; await new Promise(r => setImmediate(r)); assert.equal(settled, false);
  release(); await assert.rejects(running, /^Error: batch_outcome_unavailable$/);
});
