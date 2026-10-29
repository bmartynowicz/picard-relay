// Process-level evidence for bridge v2. Each test uses a separate
// operating system process, a file-backed database, and real process exit.
// An in-memory clock change is not used as restart evidence here.
// Run: node test/process-tests.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import {fileURLToPath} from 'node:url';
import { createOutboxStore } from '../src/outbox.mjs';
import { createLocalBoardAdapter, createSyntheticAssistantAdapter } from '../src/adapters.mjs';
import { createDispatcher } from '../src/dispatcher.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function cleanup(dir){const target=resolve(dir);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('bridge-'))throw Error('Unsafe test cleanup target');rmSync(target,{recursive:true,force:true});}
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const runNode = (script, args) => new Promise((resolve, reject) => {
  const p = spawn('node', [script, ...args], { stdio: 'inherit' });
  p.on('error', reject);
  p.on('exit', (code) => resolve(code));
});
const runNodeCapture = (script, args) => new Promise((resolve, reject) => {
  let out = '',err = '';
  const p = spawn('node', [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', reject);
  p.on('exit', (code) => resolve({ code, out,err }));
});

await test('two processes race for the same work item, one valid claim wins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-race-'));
  const dbPath = join(dir, 'bridge.db');
  const store = createOutboxStore({ dbPath });
  const { outbox } = store.submitOwnerMessage({ owner: 'owner_0001', task: 'task_0001', text: 'Race me.', idempotencyKey: 'key-race-01' });
  store.close();
  const barrier = join(dir, 'go');
  const outA = join(dir, 'a.json');
  const outB = join(dir, 'b.json');
  const pA = runNode(join(root, 'src/cli-claim.mjs'), ['--db', dbPath, '--worker', 'worker-a', '--barrier', barrier, '--output', outA]);
  const pB = runNode(join(root, 'src/cli-claim.mjs'), ['--db', dbPath, '--worker', 'worker-b', '--barrier', barrier, '--output', outB]);
  await new Promise((r) => setTimeout(r, 200));
  writeFileSync(barrier, 'go');
  await Promise.all([pA, pB]);
  const a = JSON.parse(readFileSync(outA, 'utf8'));
  const b = JSON.parse(readFileSync(outB, 'utf8'));
  const winners = [a, b].filter((x) => x.claim !== null);
  const losers = [a, b].filter((x) => x.claim === null);
  assert.equal(winners.length, 1, `expected exactly one winner, got ${JSON.stringify([a, b])}`);
  assert.equal(losers.length, 1);
  assert.equal(winners[0].claim.request_id, outbox.request_id);
  assert.equal(winners[0].claim.attempt, 1);
  const check = createOutboxStore({ dbPath });
  assert.equal(check.getOutbox(outbox.request_id).state, 'claimed');
  assert.equal(check.getOutbox(outbox.request_id).claimed_by, winners[0].workerId);
  check.close();
  cleanup(dir);
});

await test('close database, end process, reopen same file in a new process, recover durable state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-restart-'));
  const dbPath = join(dir, 'bridge.db');
  // Process 1, inline via a small script file written here, submits and exits.
  const script = join(dir, 'submit.mjs');
  writeFileSync(script, `
    import { createOutboxStore } from ${JSON.stringify(new URL('../src/outbox.mjs',import.meta.url).href)};
    const store = createOutboxStore({ dbPath: ${JSON.stringify(dbPath)} });
    const r = store.submitOwnerMessage({ owner: 'owner_0001', task: 'task_0001', text: 'Durable request.', idempotencyKey: 'key-restart-01' });
    console.log(JSON.stringify({ request_id: r.outbox.request_id, state: r.outbox.state }));
    store.close();
  `);
  const first = await runNodeCapture(script, []);
  assert.equal(first.code, 0);
  const requestId = JSON.parse(first.out.trim().split('\n').pop()).request_id;
  // Process 2, in this test process but opening the same file after process 1 exited,
  // proves the file, not memory, holds the state. A second script is used below as well.
  const script2 = join(dir, 'read.mjs');
  writeFileSync(script2, `
    import { createOutboxStore } from ${JSON.stringify(new URL('../src/outbox.mjs',import.meta.url).href)};
    const store = createOutboxStore({ dbPath: ${JSON.stringify(dbPath)} });
    const row = store.getOutbox('${requestId}');
    console.log(JSON.stringify(row));
    store.close();
  `);
  const second = await runNodeCapture(script2, []);
  assert.equal(second.code, 0);
  const row = JSON.parse(second.out.trim().split('\n').pop());
  assert.equal(row.request_id, requestId);
  assert.equal(row.state, 'queued');
  cleanup(dir);
});

await test('terminate child after reply commit and before completion, then reconcile without re-invoking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-crash-'));
  const dbPath = join(dir, 'bridge.db');
  const callsFile = join(dir, 'calls.txt');
  writeFileSync(callsFile, '');
  const store = createOutboxStore({ dbPath });
  const { outbox } = store.submitOwnerMessage({ owner: 'owner_0001', task: 'task_0001', text: 'Crash after reply.', idempotencyKey: 'key-crash-01' });
  store.close();
  const code = await runNode(join(root, 'src/cli-crash-after-reply.mjs'), ['--db', dbPath, '--worker', 'crash-worker', '--calls', callsFile]);
  assert.equal(code, 0);
  const afterCrash = createOutboxStore({ dbPath });
  assert.equal(afterCrash.listReplies(outbox.request_id).length, 1);
  assert.equal(afterCrash.getOutbox(outbox.request_id).state, 'claimed');
  assert.notEqual(afterCrash.getOutbox(outbox.request_id).response_id, null);
  afterCrash.close();
  assert.equal(readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).length, 1);
  // Wait past the 1000 ms claim lease, then reconcile in a new dispatcher run.
  await new Promise((r) => setTimeout(r, 1200));
  let reconcileCalls = 0;
  const store2 = createOutboxStore({ dbPath });
  const board = createLocalBoardAdapter(store2, { scopeCheck: () => ({ revoked: false, expiresAt: null }) });
  const assistant = createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true, onCall: () => { reconcileCalls++; } });
  const dispatcher = createDispatcher({ store: store2, boardAdapter: board, assistantAdapter: assistant, workerId: 'reconcile-worker', claimTtlMs: 60000, enabled: true });
  const result = await dispatcher.runOnce();
  assert.equal(result.status, 'reconciled');
  assert.equal(reconcileCalls, 0);
  assert.equal(store2.listReplies(outbox.request_id).length, 1);
  assert.equal(store2.getOutbox(outbox.request_id).state, 'completed');
  store2.close();
  assert.equal(readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).length, 1);
  cleanup(dir);
});

await test('disabled service startup claims no work', async () => {
  const result = await runNodeCapture(join(root, 'src/service.mjs'), []);
  // No BRIDGE_ENABLED in this environment, so the service exits disabled.
  assert.equal(result.code, 0);
  assert.match(result.out, /disabled/);
});

console.log(`${passed} process tests passed`);
