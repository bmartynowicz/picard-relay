// Adapter boundaries, v2. All board and assistant methods are async,
// because the real D1-backed adapters are asynchronous. The local SQLite
// fixture implements the same async contract; it is not a claim that
// D1 behaves like local SQLite.
export class AdapterBlockedError extends Error {
  constructor(code, message) { super(message); this.name = 'AdapterBlockedError'; this.code = code; }
}
// A parsed HTTP-200 completion explicitly ended at its output length limit.
// It is consumed, incomplete work, not an unknown transport outcome.
export class InvocationIncompleteError extends Error {
 constructor(){super('groq_output_incomplete');this.name='InvocationIncompleteError';this.code='groq_output_incomplete';}
}

// Usage is observational metadata, never execution or billing authority.
export function sanitizeProviderUsage(value){
 const keys='inputTokens,model,outputTokens,provider,totalTokens,v';
 return value&&Object.keys(value).sort().join(',')===keys&&value.v===1
  &&value.provider==='groq'&&value.model==='openai/gpt-oss-20b'
  &&[value.inputTokens,value.outputTokens,value.totalTokens].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000)
  &&value.totalTokens>0&&value.totalTokens===value.inputTokens+value.outputTokens
  ?{...value}:null;
}

// Local observations only: none of these codes proves remote execution.
const DIAGNOSTIC_PHASES=Object.freeze({
 pre_send:['scope_unavailable','scope_mismatch','cancelled_before_send','input_too_large','transport_scope_rejected','transport_endpoint_rejected','context_unavailable','context_validated','invocation_boundary_failed'],
 reservation:['reservation_started','one_shot_reserved','cost_reservation_started','cost_reserved','reservation_failed','cost_release_started','cost_release_failed'],
 network:['transport_call_pending','network_failed'],timeout:['deadline_exceeded'],cancel:['cancelled_after_start'],
 http:['response_headers','http_rejected','transport_redirect_rejected'],
 body:['body_read_started','body_read_failed','body_too_large','body_missing'],parse:['json_parse_failed'],
 validation:['invalid_response','response_validated'],finish_reason:['finish_reason_rejected'],
 result_commit:['result_commit_started','result_commit_failed'],completion_commit:['completion_commit_started','completion_commit_failed'],
 unknown:['unknown','diagnostic_persistence_failed'],
});
const FAILURE_CODES=new Set(['dispatcher_error','board_adapter_unavailable','assistant_adapter_unavailable','invocation_in_progress','invocation_outcome_uncertain','identity_mismatch','scope_revoked_or_expired','scope_revoked','scope_expired','owner_revoked','status_change_forbidden','claim_mismatch','idempotency_conflict','duplicate_response','invalid_reply','invalid_outcome','result_missing','groq_free_scope_unavailable','groq_scope_mismatch','groq_cancelled_before_send','groq_input_too_large','groq_once_allowance_unavailable','groq_cost_enrollment_stopped','groq_quota_exhausted','groq_payment_required','groq_request_rejected','groq_outcome_uncertain','groq_output_incomplete']);
const FINISH_REASONS=new Set(['stop','length','tool_calls','function_call','content_filter']);
export const invocationFailureCode=value=>FAILURE_CODES.has(value)?value:'dispatcher_error';
export function sanitizeInvocationDiagnostic(value){
 let phase='unknown',code='unknown',httpStatus=null,finishReason='unknown';
 try{
  if(Object.hasOwn(DIAGNOSTIC_PHASES,value?.phase)&&DIAGNOSTIC_PHASES[value.phase].includes(value.code)){phase=value.phase;code=value.code;}
  if(Number.isInteger(value?.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)httpStatus=value.httpStatus;
  if(FINISH_REASONS.has(value?.finishReason))finishReason=value.finishReason;
 }catch{}
 return Object.freeze({v:1,phase,code,httpStatus,finishReason});
}
const observedFailures=new WeakMap();
export function withInvocationDiagnostic(error,value){const diagnostic=sanitizeInvocationDiagnostic(value);observedFailures.set(error,diagnostic);error.diagnostic=diagnostic;return error;}
export const invocationDiagnostic=error=>observedFailures.get(error)??null;
export function isIncompleteDiagnostic(value){const d=sanitizeInvocationDiagnostic(value);return d.phase==='finish_reason'&&d.code==='finish_reason_rejected'&&d.httpStatus===200&&d.finishReason==='length';}
export const isIncompleteInvocation=error=>error instanceof InvocationIncompleteError&&isIncompleteDiagnostic(invocationDiagnostic(error));
export function encodeInvocationError(code,diagnostic){return JSON.stringify({v:1,code:invocationFailureCode(code),diagnostic:sanitizeInvocationDiagnostic(diagnostic)});}
export function decodeInvocationError(value){
 if(typeof value!=='string'||value.length>1024)return {code:'dispatcher_error',diagnostic:null};
 if(!value.startsWith('{'))return {code:invocationFailureCode(value),diagnostic:null}; // Existing known codes remain readable.
 try{const p=JSON.parse(value);if(p.v===1&&Object.keys(p).sort().join(',')==='code,diagnostic,v')return {code:invocationFailureCode(p.code),diagnostic:sanitizeInvocationDiagnostic(p.diagnostic)};}catch{}
 return {code:'dispatcher_error',diagnostic:null};
}
// Only this local transport type carries observations across the TLS boundary;
// arbitrary provider/network exception properties are never copied.
export class TransportObservationError extends Error {
 constructor(code,httpStatus=null){super(code);withInvocationDiagnostic(this,{phase:code==='transport_timeout'?'timeout':code==='transport_redirect_rejected'?'http':'pre_send',code:code==='transport_timeout'?'deadline_exceeded':code,httpStatus});}
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
