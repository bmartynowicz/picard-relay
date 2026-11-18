// Bounded offline workload for the broker and signed relay, using fresh SQLite files.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { availableParallelism, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { createDispatcher } from '../../runtime-control/src/dispatcher.mjs';
import { canonical, digest, payloadHash } from '../../runtime-control/src/protocol.mjs';
import { createRelayStore } from '../../runtime-control/src/relay-store.mjs';
import { createBroker } from '../src/broker.mjs';
import { jobSha256 } from '../src/execution-protocol.mjs';
import { createStore } from '../src/store.mjs';
import { ciJob, liveJob, provider } from './execution-helpers.mjs';
import { setupGitHub, setupOracle } from './executor-fixtures.mjs';
import { CLOCK } from './helpers.mjs';

const batchSize = 8;
const brokerJobs = 128;
const relayJobs = 256;
const ownerId = 'qualification-owner';
const taskId = 'qualification-task';
const isLost = sequence => sequence % 32 === 0;
const replies = 'fixture result '.repeat(36).trim();

function footprint(database) {
  const files = ['', '-wal', '-shm'].map(suffix => statSync(database + suffix, { throwIfNoEntry: false })).filter(Boolean);
  return {
    logicalBytes: files.reduce((sum, file) => sum + file.size, 0),
    allocatedBytes: process.platform === 'linux' ? files.reduce((sum, file) => sum + file.blocks * 512, 0) : null,
  };
}

async function exerciseBroker(database, ci, sample) {
  const profile = provider(ci);
  const jobFor = index => (ci ? ciJob : liveJob)('qualification-' + index);
  const needs = jobFor(1).needs;
  profile.resource.capacity = { cpuMs: brokerJobs * needs.cpuMs, ramMb: batchSize * needs.ramMb,
    diskMb: batchSize * needs.diskMb, gpus: 0, slots: batchSize };
  const adapters = new Map();
  const store = createStore(database);
  const approved = new Set(Array.from({ length: brokerJobs }, (_, i) => jobSha256(jobFor(i + 1))));
  const broker = createBroker({ store, resources: () => [profile.resource], adapters, executionEnabled: true,
    authorize: job => approved.has(jobSha256(job)), now: () => CLOCK });
  let attempts = 0, uncertainSeen = 0, maxQueued = 0;
  function attach(job, fail = false) {
    function dispatch() {
      attempts++;
      if (fail) throw Error('fixture_reply_lost');
    }
    const fixture = ci
      ? setupGitHub({ profile, job, handle(_url, options) { if (options.method === 'POST') dispatch(); } })
      : setupOracle({}, (_command, args) => {
        if (args.at(-1) === 'picard-compute-execute-v1') dispatch();
      }, { profile, job });
    adapters.set(profile.resource.id, fixture.adapter);
  }

  try {
    attach(jobFor(1));
    assert.throws(() => broker.submitBatch(Array.from({ length: batchSize + 1 }, (_, i) => jobFor(i + 1))), /invalid_job_batch/);
    for (let first = 1; first <= brokerJobs; first += batchSize) {
      const batch = Array.from({ length: batchSize }, (_, i) => jobFor(first + i));
      const reserved = broker.submitBatch(batch);
      assert.ok(reserved.every(row => row.state === 'reserved'));
      assert.equal(broker.discover().resources[0].capacity.slots, 0);
      maxQueued = Math.max(maxQueued, reserved.length);
      sample();
      for (const [offset, job] of batch.entries()) {
        // This fixed workload runs one job at a time through the real adapter.
        const lost = isLost(first + offset);
        attach(job, lost);
        const started = await broker.run(job.id);
        assert.equal(started.state, lost ? 'uncertain' : ci ? 'pending' : 'completed');
        if (lost) {
          uncertainSeen++;
          assert.equal((await broker.run(job.id)).state, 'uncertain');
        }
        assert.equal((await broker.collect(job.id)).state, 'completed');
        sample();
      }
    }
    assert.equal(attempts, brokerJobs);
    assert.equal(uncertainSeen, brokerJobs / 32);
    assert.equal(broker.list().length, 100);
  } finally { store.close(); }

  const reopened = createStore(database);
  try {
    const saved = reopened.find(jobFor(1).id);
    assert.equal(saved.state, 'completed');
    assert.equal(saved.result.result.value, 3);
  } finally { reopened.close(); }
  return { jobs: brokerJobs, maxQueued, attempts, uncertainSeen, retainedResult: true, telemetryLimit: 100 };
}

async function relayPayload(sequence) {
  const requestId = 'qualification-' + sequence;
  const eventId = await digest(canonical([ownerId, taskId, requestId]));
  const payload = { v: 1, eventId, ownerId, taskId, requestId, grantId: 'qualification-grant',
    assistantId: 'qualification-local', grantExpiresAt: CLOCK + 60_000,
    request: { text: 'Synthetic note. '.repeat(64).trim(), createdAt: new Date(CLOCK).toISOString(), answerTo: null },
    context: { title: 'Resource qualification', nextAction: '', latestFinding: '' } };
  return { ...payload, payloadHash: await payloadHash(payload) };
}

async function exerciseRelay(database, sample) {
  const store = createRelayStore({ dbPath: database, now: () => CLOCK });
  const lostIds = new Set();
  let attempts = 0, uncertainSeen = 0, maxQueued = 0, firstId;
  const boardAdapter = { getTaskContext: store.getTaskContext, appendReply: store.appendReply,
    getReplyByRequestId: store.getReplyByRequestId };
  const assistantAdapter = { kind: 'offline-resource-fixture', async answer(input) {
    attempts++;
    if (lostIds.has(input.requestId)) throw Error('fixture_reply_lost');
    return { ...input, eventId: 'resp:' + input.requestId, kind: 'answer', outcomeKind: 'information', body: replies };
  } };
  const dispatcher = createDispatcher({ store, boardAdapter, assistantAdapter, enabled: true, now: () => CLOCK });
  try {
    for (let first = 1; first <= relayJobs; first += batchSize) {
      for (let offset = 0; offset < batchSize; offset++) {
        const sequence = first + offset, payload = await relayPayload(sequence);
        if (sequence === 1) firstId = payload.eventId;
        if (isLost(sequence)) lostIds.add(payload.eventId);
        await store.accept(payload);
      }
      const queued = store.scopedStats({ ownerId }).find(row => row.state === 'queued')?.count;
      assert.equal(queued, batchSize);
      maxQueued = Math.max(maxQueued, queued);
      sample();
      for (let count = 0; count < batchSize; count++) {
        const result = await dispatcher.runOnce();
        assert.ok(['completed', 'uncertain'].includes(result.status));
        if (result.status === 'uncertain') uncertainSeen++;
        sample();
      }
      lostIds.clear();
    }
    assert.equal((await dispatcher.runOnce()).status, 'idle');
    assert.equal(attempts, relayJobs);
    assert.equal(uncertainSeen, relayJobs / 32);
    assert.equal(store.scopedStats({ ownerId }).find(row => row.state === 'completed')?.count, relayJobs - uncertainSeen);
    assert.equal(store.recentJobs({ ownerId, limit: 50 }).rows.length, 50);
  } finally { store.close(); }

  const reopened = createRelayStore({ dbPath: database, now: () => CLOCK });
  try {
    assert.equal(JSON.parse(reopened.get(firstId).result_json).body, replies);
    assert.equal((await reopened.accept(await relayPayload(32))).state, 'uncertain');
  } finally { reopened.close(); }
  return { jobs: relayJobs, maxQueued, attempts, uncertainSeen, retainedResult: true, telemetryLimit: 50 };
}

function diskIo() {
  if (process.platform !== 'linux') return null;
  const fields = Object.fromEntries(readFileSync('/proc/self/io', 'utf8').trim().split('\n').map(row => row.split(': ')));
  return { readBytes: Number(fields.read_bytes), writtenBytes: Number(fields.write_bytes) };
}

const sandbox = resolve(mkdtempSync(join(tmpdir(), 'picard-resource-qualification-')));
try {
  const start = performance.now(), usageBefore = process.resourceUsage(), ioBefore = diskIo();
  const results = [];
  for (const [fixture, run] of [
    ['oracle-adapter', (db, sample) => exerciseBroker(db, false, sample)],
    ['github-adapter', (db, sample) => exerciseBroker(db, true, sample)],
    ['signed-relay', exerciseRelay],
  ]) {
    const database = join(sandbox, fixture + '.sqlite');
    const peak = { logicalBytes: 0, allocatedBytes: process.platform === 'linux' ? 0 : null };
    const sample = () => {
      const disk = footprint(database);
      peak.logicalBytes = Math.max(peak.logicalBytes, disk.logicalBytes);
      if (disk.allocatedBytes !== null) peak.allocatedBytes = Math.max(peak.allocatedBytes, disk.allocatedBytes);
    };
    const startLane = performance.now(), before = process.cpuUsage();
    const observed = await run(database, sample);
    const cpu = process.cpuUsage(before);
    results.push({ fixture, ...observed, wallMs: performance.now() - startLane, cpuUsec: cpu.user + cpu.system,
      peakSampledDisk: peak, retainedDisk: footprint(database) });
  }
  const usage = process.resourceUsage(), io = diskIo();
  console.log(JSON.stringify({ kind: 'picard-resource-qualification-v1', node: process.version, kernel: release(),
    platform: process.platform, availableCpus: availableParallelism(), memoryBytes: totalmem(),
    wallMs: performance.now() - start,
    userCpuUsec: usage.userCPUTime - usageBefore.userCPUTime, systemCpuUsec: usage.systemCPUTime - usageBefore.systemCPUTime,
    peakRssKiB: usage.maxRSS, diskIo: io && { readBytes: io.readBytes - ioBefore.readBytes,
      writtenBytes: io.writtenBytes - ioBefore.writtenBytes }, results }));
} finally {
  assert.equal(sandbox, resolve(tmpdir(), sandbox.split(/[\\/]/).at(-1)));
  rmSync(sandbox, { recursive: true, force: true });
}
