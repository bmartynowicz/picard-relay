// Adapter boundaries, v2. All board and assistant methods are async,
// because the real D1-backed adapters are asynchronous. The local SQLite
// fixture implements the same async contract; it is not a claim that
// D1 behaves like local SQLite.
export class AdapterBlockedError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterBlockedError'; this.code = code; }
}

export function createLocalBoardAdapter(store, { scopeCheck } = {}) {
  return {
    kind: 'local',
    scopeEnforced: typeof scopeCheck === 'function',
    async submitOwnerMessage(input) { return store.submitOwnerMessage(input); },
    async getTaskContext({ owner, task, requestId }) {
      const row = store.getOutbox(requestId);
      if (!row) throw new Error('Request not found.');
      if (row.owner !== owner || row.task !== task) throw new Error('Identity mismatch.');
      const message = store.getMessage(row.message_id);
      return { owner, task, requestId, requestText: message ? message.text : null, messageId: row.message_id, attempt: row.attempt, payloadHash: row.payload_hash, responseId: row.response_id ?? null };
    },
    async appendReply(input) { return store.appendReply({ ...input, scopeCheck: scopeCheck ?? input.scopeCheck }); },
    async listReplies(requestId) { return store.listReplies(requestId); },
    async listOutbox() { return store.listOutbox(); },
    async getTaskMessages(owner, task) { return store.listMessages(owner, task); },
    async getReplyByRequestId(requestId) { return store.getReplyByRequestId(requestId); },
  };
}

export function createRealBoardAdapter() {
  const blocked = () => { throw new AdapterBlockedError('board_adapter_unavailable', 'Real board adapter is unavailable in this standalone source preview; implement and verify your consuming application adapter.'); };
  return { kind: 'real-blocked', scopeEnforced: false, submitOwnerMessage: blocked, getTaskContext: blocked, appendReply: blocked, listReplies: blocked, listOutbox: blocked, getTaskMessages: blocked, getReplyByRequestId: blocked };
}

export function createSyntheticAssistantAdapter({ enabledForLocalTestOnly = false, onCall } = {}) {
  return {
    kind: 'synthetic-local-test-only',
    async answer({ owner, task, requestId, requestText, attempt }) {
      if (!enabledForLocalTestOnly) throw new AdapterBlockedError('assistant_adapter_unavailable', 'Synthetic assistant is not enabled. The real assistant adapter is blocked.');
      if (onCall) onCall({ requestId });
      // Stable event id, independent of attempt. A reclaimed lease must
      // not create a second visible reply for the same request.
      return { kind: 'answer', outcomeKind: 'information', body: `Synthetic local answer to request ${requestId}: ${String(requestText ?? '').slice(0, 200)}`, statusChange: null, eventId: `evt_${requestId}`, owner, task, requestId, attempt };
    },
  };
}

/**
 * Deterministic local fixture tasks only. This is not a production executor:
 * no tools, callbacks, filesystem, network, dynamic code, or external actions.
 * Each instance retains at most eight small results for exact replay checking.
 */
export function createFixtureTaskExecutor({ enabledForLocalTestOnly = false, maxTasks = 4 } = {}) {
  const blocked = code => new AdapterBlockedError(code, code);
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 1 || maxTasks > 8) throw blocked('fixture_invalid_limits');
  const results = new Map();
  const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  return Object.freeze({
    kind: 'controlled-local-fixture-only',
    localTestOnly: true,
    ready: false,
    get executedTasks() { return results.size; },
    async answer(input) {
      if (enabledForLocalTestOnly !== true) throw blocked('fixture_disabled');
      if (!input || !['owner', 'task', 'requestId'].every(key => identity(input[key])) ||
          input.invocationId !== input.requestId || !Number.isSafeInteger(input.attempt) ||
          input.attempt < 1 || input.attempt > 1000) throw blocked('fixture_identity_invalid');
      if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) throw blocked('fixture_invalid_request');
      if (input.signal?.aborted) throw blocked('fixture_cancelled_before_run');
      if (typeof input.requestText !== 'string') throw blocked('fixture_invalid_request');
      if (input.requestText.length > 1024 || new TextEncoder().encode(input.requestText).length > 2048) throw blocked('fixture_input_too_large');
      let job;
      try { job = JSON.parse(input.requestText); } catch { throw blocked('fixture_invalid_request'); }
      if (!job || typeof job !== 'object' || Array.isArray(job) ||
          Object.keys(job).sort().join(',') !== 'operation,text,v' || job.v !== 1 || typeof job.text !== 'string') throw blocked('fixture_invalid_request');
      if (job.text.length > 512 || new TextEncoder().encode(job.text).length > 1024) throw blocked('fixture_input_too_large');
      if (!['echo', 'count-words'].includes(job.operation)) throw blocked('fixture_task_unsupported');
      const fingerprint = JSON.stringify([input.owner, input.task, input.requestText]);
      const old = results.get(input.requestId);
      if (old && old.fingerprint !== fingerprint) throw blocked('idempotency_conflict');
      if (!old && results.size >= maxTasks) throw blocked('fixture_task_limit');
      // Task text stays inert data. Replays use a cached result, never a rerun.
      const body = old?.body ?? (job.operation === 'echo'
        ? `Fixture only (echo): ${job.text}`
        : `Fixture only (count-words): ${job.text.trim() ? job.text.trim().split(/\s+/u).length : 0}`);
      if (!old) results.set(input.requestId, { fingerprint, body });
      return { kind: 'answer', outcomeKind: 'information', body, statusChange: null,
        eventId: `resp:${input.requestId}`, owner: input.owner, task: input.task,
        requestId: input.requestId, attempt: input.attempt };
    },
  });
}

export function createRealAssistantAdapter() {
  return {
    kind: 'real-blocked',
    ready:false,
    code:'assistant_invocation_unavailable',
    async answer() { throw new AdapterBlockedError('assistant_adapter_unavailable', 'This intended assistant adapter has no supported invocation mechanism configured. Select an explicitly supported provider and scope; no automatic substitution is allowed.'); },
  };
}
