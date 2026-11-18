import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBroker } from '../src/broker.mjs';
import { jobSha256, makeReceipt } from '../src/execution-protocol.mjs';
import { createStore } from '../src/store.mjs';
import { ciJob, HASH, liveJob } from './execution-helpers.mjs';
import { json, setupGitHub, setupOracle } from './executor-fixtures.mjs';
import { CLOCK } from './helpers.mjs';

const adapters = [
  {
    name: 'Oracle worker',
    newJob: liveJob,
    setup(remote) {
      return setupOracle({}, (_command, args, options) => {
        const command = args.at(-1);
        if (command.endsWith('-execute-v1')) remote.accept(JSON.parse(options.input).job);
        if (command.endsWith('-lookup-v1') && remote.expired) {
          const { job } = JSON.parse(options.input);
          return { code: 0, stdout: JSON.stringify(makeReceipt(job, HASH(), 'uncertain', null, 'fixture_result_expired')) };
        }
      });
    },
  },
  {
    name: 'GitHub CI',
    newJob: ciJob,
    setup(remote) {
      return setupGitHub({ handle(url, options) {
        if (options.method === 'POST') {
          const { inputs } = JSON.parse(options.body);
          remote.accept(JSON.parse(Buffer.from(inputs.job_json_b64, 'base64')));
        }
        if (url.includes('/runs?') && remote.expired) return json({ workflow_runs: [] });
      } });
    },
  },
];

function fixture(t, kind) {
  const dir = mkdtempSync(join(tmpdir(), 'picard-adapter-recovery-'));
  const providerLog = join(dir, 'acceptances.jsonl');
  const database = join(dir, 'broker.sqlite');
  let store = null;
  const remote = {
    expired: false,
    loseResponse: false,
    accept(job) {
      appendFileSync(providerLog, JSON.stringify({ id: job.id, sha256: jobSha256(job) }) + '\n', { flush: true });
      if (this.loseResponse) throw Error('fixture_lost_response_after_acceptance');
    },
  };
  t.after(() => { store?.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    remote,
    open({ authorize = () => true, saveFull = false, now = CLOCK } = {}) {
      store?.close();
      store = createStore(database);
      const { p, adapter, job, calls } = kind.setup(remote);
      const full = () => { throw Object.assign(Error('Injected persistence failure'), { code: 'ENOSPC' }); };
      // Fail both terminal writes while leaving the genuine invocation intent in SQLite.
      const persistence = saveFull ? { ...store, recordReceipt: full, finish: full } : store;
      const broker = createBroker({ store: persistence, resources: () => [p.resource], adapters: new Map([[p.resource.id, adapter]]),
        executionEnabled: true, authorize, now: () => now });
      return { broker, job, calls, store };
    },
    assertNoAcceptances() { assert.equal(existsSync(providerLog), false); },
    assertAcceptedOnce(job) {
      const entries = readFileSync(providerLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(entries, [{ id: job.id, sha256: jobSha256(job) }]);
    },
  };
}

for (const kind of adapters) {
  test(kind.name + ' conservatively recovers an interrupted intent before contacting the provider', async t => {
    const f = fixture(t, kind);
    const original = f.open();
    assert.equal(original.broker.submit(original.job).state, 'reserved');
    assert.equal(original.store.begin(original.job.id, CLOCK), true);

    // Simulate exiting between persisting the intent and opening the transport.
    const reopened = f.open();
    assert.equal(reopened.broker.recover(), 1);
    assert.equal(reopened.broker.submit(reopened.job).state, 'uncertain');
    assert.equal((await reopened.broker.run(reopened.job.id)).state, 'uncertain');
    assert.equal(reopened.calls.length, 0);
    f.assertNoAcceptances();
  });

  test(kind.name + ' retains unknown dispatch after external result expiry and never resubmits', async t => {
    const f = fixture(t, kind);
    f.remote.loseResponse = true;
    const original = f.open();
    assert.equal(original.broker.submit(original.job).state, 'reserved');
    assert.equal((await original.broker.run(original.job.id)).state, 'uncertain');
    f.assertAcceptedOnce(original.job);

    f.remote.expired = true;
    const reopened = f.open();
    assert.equal(reopened.broker.submit(reopened.job).state, 'uncertain');
    assert.equal((await reopened.broker.run(reopened.job.id)).state, 'uncertain');
    assert.equal(reopened.calls.length, 0);
    const result = await reopened.broker.collect(reopened.job.id);
    assert.equal(result.state, 'uncertain');
    assert.equal(result.result.result, null);
    assert.equal(reopened.broker.discover().resources[0].capacity.slots, 0);
    f.assertAcceptedOnce(original.job);
  });

  test(kind.name + ' recovers persisted invocation intent after receipt storage fails', async t => {
    const f = fixture(t, kind);
    const original = f.open({ saveFull: true });
    assert.equal(original.broker.submit(original.job).state, 'reserved');
    await assert.rejects(original.broker.run(original.job.id), { code: 'ENOSPC' });
    assert.equal(original.broker.get(original.job.id).state, 'invoking');
    assert.equal(original.broker.get(original.job.id).result, null);
    f.assertAcceptedOnce(original.job);

    const reopened = f.open({ authorize: () => false });
    assert.equal(reopened.broker.recover(), 1);
    assert.equal((await reopened.broker.run(reopened.job.id)).state, 'uncertain');
    assert.equal(reopened.calls.length, 0);
    assert.equal((await reopened.broker.collect(reopened.job.id)).state, 'completed');
    f.assertAcceptedOnce(original.job);
  });

  test(kind.name + ' keeps the completed receipt after expiry while new execution is blocked', async t => {
    const f = fixture(t, kind);
    const original = f.open();
    original.broker.submit(original.job);
    await original.broker.run(original.job.id);
    const saved = await original.broker.collect(original.job.id);
    assert.equal(saved.state, 'completed');
    f.assertAcceptedOnce(original.job);

    f.remote.expired = true;
    const reopened = f.open({ authorize: () => false, now: CLOCK + 60_001 });
    assert.equal(reopened.broker.submit(kind.newJob('other-job')).state, 'blocked');
    assert.deepEqual(reopened.broker.submit(reopened.job), saved);
    assert.deepEqual(await reopened.broker.run(reopened.job.id), saved);
    assert.deepEqual(await reopened.broker.collect(reopened.job.id), saved);
    assert.throws(() => reopened.broker.submit({ ...reopened.job, timeoutMs: 20_000 }), /job_identity_conflict/);
    assert.equal(reopened.calls.length, 0);
    f.assertAcceptedOnce(original.job);
  });

  test(kind.name + ' refuses work revoked after reservation without contacting the adapter', async t => {
    const f = fixture(t, kind);
    const original = f.open();
    assert.equal(original.broker.submit(original.job).state, 'reserved');
    const reopened = f.open({ authorize: () => false });
    const result = await reopened.broker.run(reopened.job.id);
    assert.equal(result.state, 'failed');
    assert.equal(result.reason, 'eligibility_changed_before_invocation');
    assert.equal(reopened.calls.length, 0);
    f.assertNoAcceptances();
  });
}
