// Crash simulation helper: claim, call the synthetic assistant once,
// persist the reply, then exit WITHOUT marking the work completed.
// That is the exact state of a process that dies after reply commit and
// before completion. The caller then reconciles it without re-invoking.
// Used only by test/process-tests.mjs.
import { appendFileSync } from 'node:fs';
import { createOutboxStore } from './outbox.mjs';
import { createLocalBoardAdapter, createSyntheticAssistantAdapter } from './adapters.mjs';

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const dbPath = arg('--db');
const workerId = arg('--worker') || 'crash-worker';
const callsFile = arg('--calls');
if (!dbPath) { console.error('Usage: cli-crash-after-reply.mjs --db <path> --worker <id> --calls <path>'); process.exit(2); }
const store = createOutboxStore({ dbPath });
const board = createLocalBoardAdapter(store, { scopeCheck: () => ({ revoked: false, expiresAt: null }) });
const assistant = createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true, onCall: () => { if (callsFile) appendFileSync(callsFile, 'call\n'); } });
const claim = store.claimNext({ workerId, claimTtlMs: 1000 });
if (!claim) { console.log('no claim'); process.exit(0); }
const context = await board.getTaskContext({ owner: claim.owner, task: claim.task, requestId: claim.request_id });
const answer = await assistant.answer({ owner: claim.owner, task: claim.task, requestId: claim.request_id, requestText: context.requestText, attempt: claim.attempt });
await board.appendReply({ owner: answer.owner, task: answer.task, requestId: answer.requestId, attempt: answer.attempt, workerId, eventId: answer.eventId, kind: answer.kind, outcomeKind: answer.outcomeKind, body: answer.body, statusChange: null });
console.log(JSON.stringify({ status: 'reply_committed_not_completed', request_id: claim.request_id, attempt: claim.attempt }));
store.close();
// Intentionally no markCompleted. This is the crash point.
process.exit(0);
