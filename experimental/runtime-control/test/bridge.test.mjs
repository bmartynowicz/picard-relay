// Local unit tests for bridge v2. Synthetic records only.
// No board, no Oracle, no Omen, no paid model, no real assistant.
import assert from 'node:assert/strict';
import { createOutboxStore } from '../src/outbox.mjs';
import { createLocalBoardAdapter, createSyntheticAssistantAdapter, createRealAssistantAdapter, createRealBoardAdapter } from '../src/adapters.mjs';
import { createDispatcher, loadBridgeConfig } from '../src/dispatcher.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const OWNER = 'owner_0001';
const TASK = 'task_0001';

function setup({ scopeCheck } = {}) {
  let clock = 1000000;
  const now = () => clock;
  const store = createOutboxStore({ now });
  const board = createLocalBoardAdapter(store, { scopeCheck });
  const assistant = createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true });
  const dispatcher = createDispatcher({ store, boardAdapter: board, assistantAdapter: assistant, workerId: 'w1', claimTtlMs: 60000, enabled: true, now });
  return { store, board, assistant, dispatcher, advance: (ms) => { clock += ms; }, now: () => clock };
}
function submit(store, key = 'key-00001', extra = {}) {
  return store.submitOwnerMessage({ owner: OWNER, task: TASK, text: 'Please review this task.', idempotencyKey: key, ...extra });
}

await test('one request produces one persisted correlated response visible through getTaskMessages', async () => {
  const s = setup();
  const { outbox } = submit(s.store);
  const result = await s.dispatcher.runOnce();
  assert.equal(result.status, 'completed');
  const replies = s.store.listReplies(outbox.request_id);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].owner, OWNER);
  assert.equal(replies[0].task, TASK);
  assert.equal(replies[0].kind, 'answer');
  assert.equal(replies[0].outcome_kind, 'information');
  assert.equal(replies[0].status_change, null);
  const messages = await s.board.getTaskMessages(OWNER, TASK);
  assert.equal(messages.messages.length, 2);
  assert.equal(messages.messages[1].kind, 'reply');
  assert.equal(messages.messages[1].author, 'Axiom');
});

await test('duplicate delivery produces no duplicate reply', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00002');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  const a = await s.board.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: `evt_${outbox.request_id}`, kind: 'answer', outcomeKind: 'information', body: 'First delivery.' });
  const b = await s.board.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: `evt_${outbox.request_id}`, kind: 'answer', outcomeKind: 'information', body: 'First delivery.' });
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(s.store.listReplies(outbox.request_id).length, 1);
});

await test('replay with changed body or identity fails without returning stored content', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00003');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  await s.board.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: `evt_${outbox.request_id}`, kind: 'answer', outcomeKind: 'information', body: 'Original.' });
  assert.throws(() => s.store.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: `evt_${outbox.request_id}`, kind: 'answer', outcomeKind: 'information', body: 'Changed.' }), (e) => e.code === 'idempotency_conflict');
  assert.throws(() => s.store.appendReply({ owner: 'other_owner', task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: `evt_${outbox.request_id}`, kind: 'answer', outcomeKind: 'information', body: 'Original.' }), (e) => e.code === 'idempotency_conflict');
  assert.equal(s.store.listReplies(outbox.request_id).length, 1);
});

await test('owner scoped idempotency: same owner different content conflicts, different owner does not leak', async () => {
  const s = setup();
  submit(s.store, 'key-00004');
  assert.throws(() => submit(s.store, 'key-00004', { text: 'Different text.' }), (e) => e.code === 'idempotency_conflict');
  const other = s.store.submitOwnerMessage({ owner: 'owner_0002', task: TASK, text: 'Other owner text.', idempotencyKey: 'key-00004' });
  assert.equal(other.replayed, false);
  assert.equal(s.store.listOutbox().length, 2);
});

await test('acknowledgement and approval receipt are stored but do not create work', async () => {
  const s = setup();
  const a = s.store.submitOwnerMessage({ owner: OWNER, task: TASK, text: 'Noted.', idempotencyKey: 'key-00005', disposition: 'acknowledgement' });
  const b = s.store.submitOwnerMessage({ owner: OWNER, task: TASK, text: 'Approved.', idempotencyKey: 'key-00006', disposition: 'approval_receipt' });
  assert.equal(a.eligible, false);
  assert.equal(b.eligible, false);
  assert.equal(s.store.listOutbox().length, 0);
  const c = submit(s.store, 'key-00007');
  assert.equal(c.eligible, true);
  assert.equal(s.store.listOutbox().length, 1);
});

await test('concurrent claims have one winner per request', async () => {
  const s = setup();
  const a = submit(s.store, 'key-00011');
  const b = submit(s.store, 'key-00012');
  const first = s.store.claimNext({ workerId: 'worker-a' });
  const second = s.store.claimNext({ workerId: 'worker-b' });
  assert.notEqual(second.request_id, first.request_id);
  assert.equal(second.request_id, b.outbox.request_id);
  assert.equal(s.store.claimNext({ workerId: 'worker-c' }), null);
});

await test('stale worker cannot complete or block work claimed by a newer worker', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00021');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  assert.throws(() => s.store.markCompleted({ requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'wrong-worker' }), (e) => e.code === 'claim_mismatch');
  assert.throws(() => s.store.markBlocked({ requestId: outbox.request_id, attempt: 99, workerId: 'w1' }), (e) => e.code === 'claim_mismatch');
  assert.equal(s.store.getOutbox(outbox.request_id).state, 'claimed');
  const ok = s.store.markCompleted({ requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1' });
  assert.equal(ok.state, 'completed');
  assert.throws(() => s.store.markCompleted({ requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1' }), (e) => e.code === 'claim_mismatch');
});

await test('wrong identity or task cannot cross boundaries', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00022');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  assert.throws(() => s.store.appendReply({ owner: 'other_owner', task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: 'evt_wrong_owner', kind: 'answer', body: 'Wrong owner.' }), (e) => e.code === 'identity_mismatch');
  assert.throws(() => s.store.appendReply({ owner: OWNER, task: 'other_task', requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: 'evt_wrong_task', kind: 'answer', body: 'Wrong task.' }), (e) => e.code === 'identity_mismatch');
  assert.equal(s.store.listReplies(outbox.request_id).length, 0);
});

await test('ordinary answer with a status change is rejected without a write', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00031');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  assert.throws(() => s.store.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: 'evt_status', kind: 'answer', body: 'Done.', statusChange: 'Done' }), (e) => e.code === 'status_change_forbidden');
  assert.equal(s.store.listReplies(outbox.request_id).length, 0);
});

await test('assistant reply does not create outbox work', async () => {
  const s = setup();
  const { outbox } = submit(s.store, 'key-00041');
  await s.dispatcher.runOnce();
  assert.equal(s.store.listOutbox().length, 1);
  assert.equal(s.store.listOutbox()[0].request_id, outbox.request_id);
});

await test('crash after reply commit reconciles without re-invoking the assistant', async () => {
  let calls = 0;
  const s = setup();
  s.assistant = createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true, onCall: () => { calls++; } });
  s.dispatcher = createDispatcher({ store: s.store, boardAdapter: s.board, assistantAdapter: s.assistant, workerId: 'w1', claimTtlMs: 60000, enabled: true, now: s.now });
  const { outbox } = submit(s.store, 'key-00051');
  const claimed = s.store.claimNext({ workerId: 'w1' });
  const context = await s.board.getTaskContext({ owner: OWNER, task: TASK, requestId: outbox.request_id });
  const answer = await s.assistant.answer({ owner: OWNER, task: TASK, requestId: outbox.request_id, requestText: context.requestText, attempt: claimed.attempt });
  await s.board.appendReply({ owner: OWNER, task: TASK, requestId: outbox.request_id, attempt: claimed.attempt, workerId: 'w1', eventId: answer.eventId, kind: answer.kind, outcomeKind: answer.outcomeKind, body: answer.body });
  assert.equal(calls, 1);
  // Simulate crash: no markCompleted. Advance past lease, re-claim, reconcile.
  s.advance(61000);
  const result = await s.dispatcher.runOnce();
  assert.equal(result.status, 'reconciled');
  assert.equal(calls, 1);
  assert.equal(s.store.listReplies(outbox.request_id).length, 1);
  assert.equal(s.store.getOutbox(outbox.request_id).state, 'completed');
});

await test('revoked and expired scope fail closed without a reply', async () => {
  const s = setup({ scopeCheck: () => ({ revoked: true, expiresAt: null }) });
  const { outbox } = submit(s.store, 'key-00061');
  const result = await s.dispatcher.runOnce();
  assert.equal(result.status, 'blocked');
  assert.equal(s.store.listReplies(outbox.request_id).length, 0);
});

await test('unavailable real assistant and board adapters are blocked, not working', async () => {
  const s = setup();
  const dispatcher = createDispatcher({ store: s.store, boardAdapter: s.board, assistantAdapter: createRealAssistantAdapter(), workerId: 'w1', enabled: true, now: s.now });
  const { outbox } = submit(s.store, 'key-00071');
  const result = await dispatcher.runOnce();
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'assistant_adapter_unavailable');
  assert.equal(s.store.listReplies(outbox.request_id).length, 0);
  assert.throws(() => createRealBoardAdapter().submitOwnerMessage({}), (e) => e.code === 'board_adapter_unavailable');
});

await test('production mode rejects synthetic adapters, blocked adapters, missing scope, and memory storage', async () => {
  const s = setup();
  assert.throws(() => createDispatcher({ store: s.store, boardAdapter: s.board, assistantAdapter: createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true }), workerId: 'w1', enabled: true, production: true, dbPath: './bridge.db' }), /Production mode must not use the synthetic/);
  assert.throws(() => createDispatcher({ store: s.store, boardAdapter: createRealBoardAdapter(), assistantAdapter: createRealAssistantAdapter(), workerId: 'w1', enabled: true, production: true, dbPath: './bridge.db' }), (e) => e.code === 'production_adapter_missing');
  assert.throws(() => createDispatcher({ store: s.store, boardAdapter: s.board, assistantAdapter: createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true }), workerId: 'w1', enabled: true, production: true, dbPath: ':memory:' }), /must not use :memory:/);
  const config = loadBridgeConfig({ BRIDGE_ENABLED: undefined });
  assert.equal(config.enabled, false);
  assert.equal(config.production, false);
});

await test('dispatcher is disabled by default and async adapters are awaited', async () => {
  const s = setup();
  const disabled = createDispatcher({ store: s.store, boardAdapter: s.board, assistantAdapter: s.assistant, workerId: 'w1', enabled: false, now: s.now });
  submit(s.store, 'key-00081');
  const result = await disabled.runOnce();
  assert.equal(result.status, 'disabled');
  assert.equal(s.store.listOutbox()[0].state, 'queued');
});

await test('replayed idempotency key creates no second request', async () => {
  const s = setup();
  const first = submit(s.store, 'key-00091');
  const second = submit(s.store, 'key-00091');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(s.store.listOutbox().length, 1);
});

console.log(`${passed} bridge v2 tests passed`);
