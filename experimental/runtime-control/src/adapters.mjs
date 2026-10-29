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

export function createRealAssistantAdapter() {
  return {
    kind: 'real-blocked',
    ready:false,
    code:'assistant_invocation_unavailable',
    async answer() { throw new AdapterBlockedError('assistant_adapter_unavailable', 'This intended assistant adapter has no supported invocation mechanism configured. Select an explicitly supported provider and scope; no automatic substitution is allowed.'); },
  };
}
