import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/store.mjs';
import { createBroker } from '../src/broker.mjs';
import { fixtureAdapters } from '../src/fixtures.mjs';
import { CLOCK, registry, job } from './helpers.mjs';
function setup(t, { resources = registry, adapters = fixtureAdapters(), fixtureMode = true, store = createStore(':memory:') } = {}) {
  t.after(() => store.close());
  return { store, broker: createBroker({ store, resources, adapters, fixtureMode, now: () => CLOCK }) };
}
test('default mode blocks all execution, even with an adapter and eligible resources', async t => {
  const { broker } = setup(t, { fixtureMode: false });
  assert.equal(broker.submit(job()).state, 'blocked');
  assert.equal((await broker.run('first')).state, 'blocked');
  assert.equal(broker.discover().liveCloudExecutionEnabled, false);
});
test('two simulated architectures produce durable results and exact replay', async t => {
  const { broker } = setup(t);
  broker.submit(job('x64')); broker.submit(job('arm64', { arch: 'arm64', operation: 'sha256' }));
  const results = await Promise.all([broker.run('x64'), broker.run('arm64')]);
  assert.equal(results[0].result.value, 3);
  assert.equal(results[1].result.value.length, 64);
  assert.equal(results[0].result.simulated, true);
  assert.deepEqual(broker.submit(job('x64')), broker.get('x64'));
  assert.throws(() => broker.submit(job('x64', { input: { text: 'changed' } })), /job_identity_conflict/);
});
test('reservations prevent oversubscription; terminal completion releases slots but not CPU budget', async t => {
  const resources = registry(); resources[1].capacity = { cpuMs: 200, ramMb: 32, diskMb: 1, gpus: 0, slots: 1 };
  const { broker } = setup(t, { resources: () => resources });
  assert.equal(broker.submit(job('one')).state, 'reserved');
  assert.equal(broker.submit(job('blocked-slot')).state, 'blocked');
  await broker.run('one');
  assert.equal(broker.submit(job('two')).state, 'reserved'); await broker.run('two');
  assert.equal(broker.submit(job('blocked-cpu')).state, 'blocked');
  assert.equal(broker.discover().resources[1].capacity.cpuMs, 0);
});
test('same-job concurrent calls invoke once', async t => {
  let calls = 0;
  const adapters = new Map([['fixture-x64', { kind: 'local-fixture', async execute() { calls++; await new Promise(r => setTimeout(r, 5)); return { value: 7 }; } }]]);
  const { broker } = setup(t, { adapters }); broker.submit(job());
  const results = await Promise.all(Array.from({ length: 6 }, () => broker.run('first')));
  assert.equal(calls, 1); assert.ok(results.every(row => row.state === 'completed'));
});
test('two simulated workers overlap; loss of one leaves its attempt uncertain without harming the other', async t => {
  let inFlight = 0, peak = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const adapters = new Map(['x64', 'arm64'].map(arch => [`fixture-${arch}`, {
    kind: 'local-fixture', async execute() {
      peak = Math.max(peak, ++inFlight); if (inFlight === 2) release();
      await ready; inFlight--; if (arch === 'x64') throw Error('synthetic_worker_lost');
      return { simulated: true, value: 42 };
    },
  }]));
  const { broker } = setup(t, { adapters });
  broker.submit(job('worker-x64')); broker.submit(job('worker-arm', { arch: 'arm64' }));
  const results = await Promise.all([broker.run('worker-x64'), broker.run('worker-arm')]);
  assert.equal(peak, 2); assert.equal(results[0].state, 'uncertain'); assert.equal(results[1].state, 'completed');
  assert.equal((await broker.run('worker-x64')).state, 'uncertain');
});
test('timeout retains quota and cannot retry, fail over or overwrite the uncertain result', async t => {
  let calls = 0, finish;
  const adapters = new Map([['fixture-x64', { kind: 'local-fixture', execute() { calls++; return new Promise(r => { finish = r; }); } }]]);
  const { broker } = setup(t, { adapters }); broker.submit(job('timeout', { timeoutMs: 10 }));
  assert.equal((await broker.run('timeout')).state, 'uncertain');
  finish({ value: 'late' }); await new Promise(r => setImmediate(r));
  assert.equal((await broker.run('timeout')).state, 'uncertain'); assert.equal(calls, 1);
  assert.equal(broker.get('timeout').result, null);
  assert.equal(broker.discover().resources[1].capacity.slots, 1);
});
test('invalid and oversized adapter replies stop uncertain without releasing capacity', async t => {
  for (const result of [undefined, 'x'.repeat(16385)]) {
    const adapters = new Map([['fixture-x64', { kind: 'local-fixture', execute: async () => result }]]);
    const { broker } = setup(t, { adapters }); broker.submit(job());
    assert.equal((await broker.run('first')).state, 'uncertain');
  }
});
test('fresh eligibility and all reservations are rechecked before invocation', async t => {
  for (const change of [r => { r.observedAt = CLOCK - 60_001; }, r => { r.capacity.ramMb = 1; }, r => { r.capacity.slots = 1; }]) {
    const resources = registry(); let calls = 0;
    const adapters = new Map([['fixture-x64', { kind: 'local-fixture', execute: async () => { calls++; return {}; } }]]);
    const { broker } = setup(t, { resources: () => resources, adapters });
    broker.submit(job('one')); broker.submit(job('two')); change(resources[1]);
    assert.equal((await broker.run('one')).state, 'failed'); assert.equal(calls, 0);
  }
});
test('untrusted strings, duplicate IDs and unsupported commands never execute', t => {
  const resources = registry(); resources[1].capacity.cpuMs = '10000';
  const { broker } = setup(t, { resources: () => resources });
  assert.equal(broker.submit(job()).state, 'blocked');
  assert.throws(() => broker.submit(job('shell', { operation: 'shell' })), /invalid_job/);
  assert.throws(() => broker.submit({ ...job(), command: 'echo nope' }), /unknown_job_field/);
  resources[1] = resources[0]; assert.equal(broker.plan(job()).resourceId, null);
});
test('input normalization makes object key order irrelevant and enforces UTF-8 bounds', t => {
  const { broker } = setup(t); const work = job(); broker.submit(work);
  assert.equal(broker.submit({ ...work, needs: { gpus: 0, diskMb: 0, ramMb: 32, cpuMs: 100 } }).state, 'reserved');
  assert.throws(() => broker.submit(job('large', { input: { text: '😀'.repeat(3001) } })), /invalid_job/);
});
test('on-disk restart preserves result and crash intent; explicit offline recovery never resends', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-test-'));
  const filename = join(directory, 'state.sqlite'); let store = createStore(filename);
  let broker = createBroker({ store, resources: registry, adapters: fixtureAdapters(), fixtureMode: true, now: () => CLOCK });
  broker.submit(job('saved')); await broker.run('saved'); broker.submit(job('interrupted')); store.begin('interrupted', CLOCK); store.close();
  store = createStore(filename); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  broker = createBroker({ store, resources: registry, adapters: fixtureAdapters(), fixtureMode: true, now: () => CLOCK });
  assert.equal(broker.get('saved').result.value, 3); assert.equal(broker.get('interrupted').state, 'invoking');
  assert.equal(broker.recover(), 1); assert.equal((await broker.run('interrupted')).state, 'uncertain');
  assert.equal(broker.discover().resources[1].capacity.slots, 1);
});
test('two store connections share reservations and invocation compare-and-swap', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-test-'));
  const filename = join(directory, 'state.sqlite'); const stores = [createStore(filename), createStore(filename)];
  t.after(() => { stores.forEach(store => store.close()); rmSync(directory, { recursive: true, force: true }); });
  const resources = registry(); resources[1].capacity.slots = 1; let calls = 0;
  const adapters = new Map([['fixture-x64', { kind: 'local-fixture', async execute() { calls++; await new Promise(r => setTimeout(r, 5)); return {}; } }]]);
  const brokers = stores.map(store => createBroker({ store, resources: () => resources, adapters, fixtureMode: true, now: () => CLOCK }));
  assert.equal(brokers[0].submit(job('one')).state, 'reserved'); assert.equal(brokers[1].submit(job('two')).state, 'blocked');
  await Promise.all(brokers.map(broker => broker.run('one'))); assert.equal(calls, 1);
});
test('unrelated SQLite databases are refused without modifying their tables', t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'other.sqlite'); const db = new DatabaseSync(filename); db.exec('CREATE TABLE valuable (id TEXT)'); db.close();
  if (process.platform !== 'win32') chmodSync(filename, 0o600);
  assert.throws(() => createStore(filename), /unrelated_database/);
  const check = new DatabaseSync(filename); assert.equal(check.prepare('SELECT COUNT(*) AS n FROM valuable').get().n, 0); check.close();
});
test('POSIX state must be private and cannot be a symlink', { skip: process.platform === 'win32' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  chmodSync(directory, 0o755); assert.throws(() => createStore(join(directory, 'bad.sqlite')), /private_state_directory_required/);
  chmodSync(directory, 0o700); const target = join(directory, 'real.sqlite'); const store = createStore(target); store.close();
  symlinkSync(target, join(directory, 'link.sqlite')); assert.throws(() => createStore(join(directory, 'link.sqlite')), /private_state_file_required/);
});
