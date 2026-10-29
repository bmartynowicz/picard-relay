// Dispatcher, v2. Genuinely async, reconciling, production validated.
// - Awaits getTaskContext, assistant answer, appendReply and completion.
// - If a claim already has a response_id, it reconciles: it does not call
//   the assistant again, it marks the claim completed with the existing reply.
// - Production mode rejects, at creation, synthetic adapters, blocked real
//   adapters, missing scope enforcement, and :memory: storage. It does not
//   silently run in a test configuration and call that production.
// - Non-production mode allows blocked adapters so fail-closed behaviour
//   can be demonstrated, and allows the synthetic adapter only when it is
//   explicitly enabled for local testing.
import { AdapterBlockedError } from './adapters.mjs';

export function createDispatcher({
  store, boardAdapter, assistantAdapter, workerId = 'bridge-worker-1',
  claimTtlMs = 60000, enabled = false, production = false, dbPath = ':memory:', now = () => Date.now(),
} = {}) {
  if (!store || !boardAdapter || !assistantAdapter) throw new Error('Dispatcher requires store, boardAdapter and assistantAdapter.');
  if (production) {
    if (dbPath === ':memory:') throw new Error('Production mode must not use :memory: storage.');
    if (assistantAdapter.kind === 'synthetic-local-test-only') throw new Error('Production mode must not use the synthetic assistant adapter.');
    if (boardAdapter.kind === 'real-blocked' || assistantAdapter.kind === 'real-blocked') {
      throw new AdapterBlockedError('production_adapter_missing', 'Production mode rejects missing real adapters. Board ingress and assistant invocation are not available.');
    }
    if (!boardAdapter.scopeEnforced) throw new Error('Production mode requires scope enforcement in the board adapter.');
  }

  async function runOnce() {
    if (!enabled) return { status: 'disabled' };
    const claim = await store.claimNext({ workerId, claimTtlMs });
    if (!claim) return { status: 'idle' };
    const { request_id: requestId, owner, task, attempt } = claim;
    let heartbeat=null;const controller=new AbortController();
    try {
      const context = await boardAdapter.getTaskContext({ owner, task, requestId });
      // Reconciliation: reply already committed, completion was lost.
      // Do not re-invoke, do not create a second reply.
      if (context.responseId || claim.response_id) {
        const existing = boardAdapter.getReplyByRequestId ? await boardAdapter.getReplyByRequestId(requestId) : null;
        await store.markCompleted({ requestId, attempt, workerId });
        return { status: 'reconciled', requestId, attempt, replyId: existing ? existing.reply_id : (context.responseId || claim.response_id) };
      }
      // v3 production store records the invocation boundary before external I/O.
      // An expired invocation without a durable result becomes uncertain, never
      // an automatic second model call. The original local v2 fixtures omit it.
      if(store.startInvocation)await store.startInvocation({requestId,attempt,workerId});
      if(store.renewLease)heartbeat=setInterval(()=>{Promise.resolve(store.renewLease({requestId,attempt,workerId,claimTtlMs})).catch(()=>controller.abort());},Math.max(250,Math.floor(claimTtlMs/3)));
      const answer = await assistantAdapter.answer({ owner, task, requestId, requestText: context.requestText, context, attempt, invocationId:requestId, signal:controller.signal });
      const persisted = await boardAdapter.appendReply({
        owner: answer.owner, task: answer.task, requestId: answer.requestId,
        attempt: answer.attempt, workerId, eventId: answer.eventId, kind: answer.kind,
        outcomeKind: answer.outcomeKind ?? null, body: answer.body, statusChange: answer.statusChange ?? null,
      });
      await store.markCompleted({ requestId, attempt, workerId });
      return { status: 'completed', requestId, attempt, replayed: persisted.replayed, replyId: persisted.reply.reply_id };
    } catch (e) {
      const code = e && e.code ? e.code : 'dispatcher_error';
      const isBlocked = e instanceof AdapterBlockedError || ['identity_mismatch', 'scope_revoked_or_expired', 'status_change_forbidden', 'claim_mismatch', 'idempotency_conflict', 'duplicate_response'].includes(code);
      try {
        if (isBlocked) await store.markBlocked({ requestId, attempt, workerId, error: code });
        else await store.markFailed({ requestId, attempt, workerId, error: code });
      } catch {}
      return { status: isBlocked ? 'blocked' : 'failed', requestId, attempt, code, message: e ? e.message : 'Unknown error' };
    }finally{if(heartbeat!==null)clearInterval(heartbeat);}
  }

  return { runOnce, workerId, enabled, production };
}

export function loadBridgeConfig(env = process.env) {
  const enabled = env.BRIDGE_ENABLED === 'true';
  const production = env.BRIDGE_PRODUCTION === 'true';
  const claimTtlMs = env.BRIDGE_CLAIM_TTL_MS ? Number(env.BRIDGE_CLAIM_TTL_MS) : 60000;
  if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs < 1000 || claimTtlMs > 900000) throw new Error('BRIDGE_CLAIM_TTL_MS must be an integer between 1000 and 900000.');
  const pollIntervalMs = env.BRIDGE_POLL_INTERVAL_MS ? Number(env.BRIDGE_POLL_INTERVAL_MS) : 5000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60000) throw new Error('BRIDGE_POLL_INTERVAL_MS must be an integer between 100 and 60000.');
  return {
    enabled, production, workerId: env.BRIDGE_WORKER_ID || 'bridge-worker-1',
    claimTtlMs, pollIntervalMs, dbPath: env.BRIDGE_DB_PATH || ':memory:',
    localTestMode: env.BRIDGE_LOCAL_TEST_MODE === 'true',
    stopPath: env.BRIDGE_STOP_PATH || null,
    boardAdapterTokenRef: env.BRIDGE_BOARD_ADAPTER_TOKEN_REF || null,
    assistantAdapterTokenRef: env.BRIDGE_ASSISTANT_ADAPTER_TOKEN_REF || null,
  };
}
