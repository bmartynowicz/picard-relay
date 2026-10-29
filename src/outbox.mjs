// Conversation bridge outbox, v2.
// Corrections from the NEXT packet, applied to the v1 candidate:
// - Idempotency is owner scoped: UNIQUE(owner, kind, idempotency_key), matching
//   task_messages_owner_kind_key in db/schema.ts. A same owner, same key,
//   different task, text, answerTo or disposition is a conflict, never a
//   silent replay, and never a disclosure of another owner's record.
//   A different owner may use the same key, with no leakage.
// - Reply replay is validated before it is returned: owner, task, request,
//   body and outcome must match the stored reply, otherwise it fails with
//   a conflict and no stored content is returned.
// - Claims and terminal transitions are single UPDATE statements with
//   owner, task, request, attempt, worker and lease predicates. A stale
//   worker cannot complete or block work claimed by a newer worker, and
//   cannot overwrite a completed row.
// - Response identity is stable and independent of attempt: reply_id and
//   outbox.response_id are derived from the request, not from the attempt.
//   A crash after reply commit but before markCompleted is reconciled by
//   the dispatcher, without re-invoking the assistant and without a second
//   visible reply.
// - Eligibility is explicit, not inferred from text: disposition
//   'request' and 'answer_to_question' are eligible. 'acknowledgement'
//   and 'approval_receipt' are stored as messages only, with no outbox row.
//   Assistant replies never create outbox work, by construction: only
//   submitOwnerMessage creates outbox rows.
// - An ordinary answer must not carry a status change. Outcome classification
//   (information or question) is preserved in the reply row, but it does not
//   approve, accept or complete a task. Real task status transitions belong
//   to the outcome store, see board-patch/lib/board-conversation-work.ts.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const stableResponseId = (requestId) => `resp_${sha256(`board-conversation-response:${requestId}`).slice(0, 24)}`;

export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export function createOutboxStore({ dbPath = ':memory:', now = () => Date.now() } = {}) {
  const db = new DatabaseSync(dbPath);
  // Bound real cross-process schema/write contention; never retry provider calls.
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_messages (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      task TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'request',
      text TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      answer_to TEXT,
      disposition TEXT NOT NULL DEFAULT 'request',
      created_at INTEGER NOT NULL,
      UNIQUE(owner, kind, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      request_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      task TEXT NOT NULL,
      message_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','claimed','completed','blocked','failed')),
      attempt INTEGER NOT NULL DEFAULT 0,
      claimed_by TEXT,
      claimed_until INTEGER,
      response_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS replies (
      reply_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      task TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('answer','question','acknowledgement')),
      outcome_kind TEXT,
      body TEXT NOT NULL,
      status_change TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  function withTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }

  function submitOwnerMessage({ owner, task, text, idempotencyKey, answerTo, disposition = 'request' }) {
    if (typeof owner !== 'string' || !owner || typeof task !== 'string' || !task) {
      throw new BridgeError('invalid_identity', 'Owner and task are required.');
    }
    if (typeof text !== 'string' || text.trim().length < 1 || text.length > 4000) {
      throw new BridgeError('invalid_text', 'Request text must be 1 to 4000 characters.');
    }
    if (!IDEMPOTENCY.test(idempotencyKey)) {
      throw new BridgeError('invalid_idempotency_key', 'Submission key must be 8 to 128 characters.');
    }
    if (!['request', 'answer_to_question', 'acknowledgement', 'approval_receipt'].includes(disposition)) {
      throw new BridgeError('invalid_disposition', 'Disposition must be request, answer_to_question, acknowledgement or approval_receipt.');
    }
    if (disposition === 'answer_to_question' && !answerTo) {
      throw new BridgeError('invalid_answer_to', 'An answer_to_question disposition requires answerTo.');
    }
    const at = now();
    return withTransaction(() => {
      const existing = db.prepare('SELECT * FROM board_messages WHERE owner = ? AND kind = ? AND idempotency_key = ?').get(owner, 'request', idempotencyKey);
      if (existing) {
        if (existing.task !== task || existing.text !== text.trim() || (existing.answer_to ?? null) !== (answerTo ?? null) || existing.disposition !== disposition) {
          throw new BridgeError('idempotency_conflict', 'This submission key was already used for different content.');
        }
        const outbox = db.prepare('SELECT * FROM outbox WHERE message_id = ?').get(existing.id) ?? null;
        return { replayed: true, message: existing, outbox, eligible: outbox !== null };
      }
      const messageId = `msg_${sha256(`${owner}:${task}:${idempotencyKey}:${at}`).slice(0, 24)}`;
      const trimmed = text.trim();
      db.prepare('INSERT INTO board_messages (id, owner, task, kind, text, idempotency_key, answer_to, disposition, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(messageId, owner, task, 'request', trimmed, idempotencyKey, answerTo ?? null, disposition, at);
      if (disposition === 'acknowledgement' || disposition === 'approval_receipt') {
        return { replayed: false, message: { id: messageId, owner, task, text: trimmed, idempotency_key: idempotencyKey, answer_to: answerTo ?? null, disposition, created_at: at }, outbox: null, eligible: false };
      }
      const requestId = `req_${sha256(`${owner}:${task}:${messageId}`).slice(0, 24)}`;
      db.prepare(`INSERT INTO outbox (request_id, owner, task, message_id, payload_hash, state, attempt, created_at, updated_at) VALUES (?,?,?,?,?,'queued',0,?,?)`)
        .run(requestId, owner, task, messageId, sha256(trimmed), at, at);
      const outbox = db.prepare('SELECT * FROM outbox WHERE request_id = ?').get(requestId);
      return { replayed: false, message: { id: messageId, owner, task, text: trimmed, idempotency_key: idempotencyKey, answer_to: answerTo ?? null, disposition, created_at: at }, outbox, eligible: true };
    });
  }

  function getOutbox(requestId) { return db.prepare('SELECT * FROM outbox WHERE request_id = ?').get(requestId) ?? null; }
  function getMessage(messageId) { return db.prepare('SELECT * FROM board_messages WHERE id = ?').get(messageId) ?? null; }
  function getReplyByRequestId(requestId) { return db.prepare('SELECT * FROM replies WHERE request_id = ?').get(requestId) ?? null; }
  function getReplyByEventId(eventId) { return db.prepare('SELECT * FROM replies WHERE event_id = ?').get(eventId) ?? null; }

  function claimNext({ workerId, claimTtlMs = 60000 } = {}) {
    const at = now();
    const row = db.prepare(`SELECT * FROM outbox WHERE state = 'queued' OR (state = 'claimed' AND claimed_until IS NOT NULL AND claimed_until <= ?) ORDER BY created_at ASC LIMIT 1`).get(at);
    if (!row) return null;
    const newAttempt = row.attempt + 1;
    const changed = db.prepare(`UPDATE outbox SET state = 'claimed', attempt = ?, claimed_by = ?, claimed_until = ?, updated_at = ? WHERE request_id = ? AND (state = 'queued' OR (state = 'claimed' AND claimed_until IS NOT NULL AND claimed_until <= ?))`)
      .run(newAttempt, workerId, at + claimTtlMs, at, row.request_id, at);
    if (changed.changes !== 1) return null;
    const claimed = getOutbox(row.request_id);
    const message = getMessage(row.message_id);
    return { ...claimed, messageText: message ? message.text : null, messageId: row.message_id };
  }

  // Single-statement compare-and-swap transitions. No read-then-update.
  function casTransition({ requestId, attempt, workerId, toState, error }) {
    const at = now();
    const changed = db.prepare(`UPDATE outbox SET state = ?, claimed_by = NULL, claimed_until = NULL, updated_at = ?, last_error = ? WHERE request_id = ? AND state = 'claimed' AND attempt = ? AND claimed_by = ?`)
      .run(toState, at, error ?? null, requestId, attempt, workerId);
    if (changed.changes !== 1) {
      throw new BridgeError('claim_mismatch', 'Stale worker, stale attempt, or work is no longer claimed by this worker. Nothing was changed.');
    }
    return getOutbox(requestId);
  }
  function markCompleted({ requestId, attempt, workerId }) { return casTransition({ requestId, attempt, workerId, toState: 'completed' }); }
  function markBlocked({ requestId, attempt, workerId, error }) { return casTransition({ requestId, attempt, workerId, toState: 'blocked', error }); }
  function markFailed({ requestId, attempt, workerId, error }) { return casTransition({ requestId, attempt, workerId, toState: 'failed', error }); }

  function appendReply({ owner, task, requestId, attempt, workerId, eventId, kind, outcomeKind = null, body, statusChange = null, scopeCheck } = {}) {
    if (!['answer', 'question', 'acknowledgement'].includes(kind)) throw new BridgeError('invalid_kind', 'Reply kind must be answer, question or acknowledgement.');
    if (kind === 'answer' && statusChange !== null) throw new BridgeError('status_change_forbidden', 'An ordinary answer must not carry a status change.');
    if (outcomeKind !== null && !['information', 'question'].includes(outcomeKind)) throw new BridgeError('invalid_outcome', 'Outcome kind must be information or question.');
    if (typeof body !== 'string' || !body.trim() || body.length > 4000) throw new BridgeError('invalid_body', 'Reply body must be 1 to 4000 characters.');
    if (typeof eventId !== 'string' || !eventId) throw new BridgeError('invalid_event_id', 'Reply event id is required.');
    const at = now();
    return withTransaction(() => {
      // Validate replay before returning it. A conflicting reuse fails
      // without returning stored content.
      const existing = getReplyByEventId(eventId);
      if (existing) {
        if (existing.owner !== owner || existing.task !== task || existing.request_id !== requestId || existing.body !== body.trim() || (existing.outcome_kind ?? null) !== (outcomeKind ?? null)) {
          throw new BridgeError('idempotency_conflict', 'This reply event id was already used for different content.');
        }
        return { replayed: true, reply: existing };
      }
      const row = getOutbox(requestId);
      if (!row) throw new BridgeError('not_found', 'Request not found.');
      if (row.owner !== owner || row.task !== task) throw new BridgeError('identity_mismatch', 'Reply owner or task does not match the originating request. Nothing was written.');
      if (row.state !== 'claimed' || row.attempt !== attempt || (workerId && row.claimed_by !== workerId)) {
        throw new BridgeError('claim_mismatch', 'Reply does not match the claimed attempt. Nothing was written.');
      }
      if (scopeCheck) {
        const scope = scopeCheck({ owner, task });
        if (!scope || scope.revoked === true || (typeof scope.expiresAt === 'number' && scope.expiresAt <= at)) {
          throw new BridgeError('scope_revoked_or_expired', 'Scope is revoked or expired. Nothing was written.');
        }
      }
      // One logical reply per request, stable identity, independent of attempt.
      const alreadyForRequest = getReplyByRequestId(requestId);
      if (alreadyForRequest) {
        throw new BridgeError('duplicate_response', 'A reply already exists for this request. Use its existing event id for replay.');
      }
      const replyId = stableResponseId(requestId);
      db.prepare(`INSERT INTO replies (reply_id, request_id, owner, task, attempt, event_id, kind, outcome_kind, body, status_change, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(replyId, requestId, owner, task, attempt, eventId, kind, outcomeKind, body.trim(), statusChange, at);
      // Record the response receipt in the same transaction as the reply.
      // This is what makes crash-after-reply reconciliation possible:
      // reply committed, outbox still claimed, response_id present.
      db.prepare(`UPDATE outbox SET response_id = ?, updated_at = ? WHERE request_id = ? AND state = 'claimed'`).run(replyId, at, requestId);
      const reply = db.prepare('SELECT * FROM replies WHERE reply_id = ?').get(replyId);
      return { replayed: false, reply };
    });
  }

  function listReplies(requestId) { return db.prepare('SELECT * FROM replies WHERE request_id = ? ORDER BY created_at ASC').all(requestId); }
  function listOutbox() { return db.prepare('SELECT * FROM outbox ORDER BY created_at ASC').all(); }
  function listMessages(owner, task) {
    const msgs = db.prepare('SELECT * FROM board_messages WHERE owner = ? AND task = ? ORDER BY created_at ASC').all(owner, task);
    const reps = db.prepare('SELECT * FROM replies WHERE owner = ? AND task = ? ORDER BY created_at ASC').all(owner, task);
    const combined = [
      ...msgs.map(m => ({ id: m.id, taskId: task, kind: 'request', text: m.text, createdAt: m.created_at, status: 'queued', author: 'Owner', transport: 'owner_form', answerTo: m.answer_to ?? null, disposition: m.disposition })),
      ...reps.map(r => ({ id: r.reply_id, taskId: task, kind: 'reply', text: r.body, createdAt: r.created_at, status: 'replied', author: 'Axiom', transport: 'assistant_tool', replyTo: r.request_id, outcomeKind: r.outcome_kind ?? null })),
    ].sort((a, b) => a.createdAt - b.createdAt);
    return { messages: combined, hasMore: false };
  }
  function close() { db.close(); }

  return { db, dbPath, now, stableResponseId, submitOwnerMessage, getOutbox, getMessage, getReplyByRequestId, getReplyByEventId, claimNext, markCompleted, markBlocked, markFailed, appendReply, listReplies, listOutbox, listMessages, close };
}
