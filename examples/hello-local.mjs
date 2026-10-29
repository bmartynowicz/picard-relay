// Picard Relay: a small mission-control exercise, not a live model invocation.
import assert from 'node:assert/strict';
import { createOutboxStore } from '../src/outbox.mjs';
import { createLocalBoardAdapter, createSyntheticAssistantAdapter } from '../src/adapters.mjs';
import { createDispatcher } from '../src/dispatcher.mjs';
const store = createOutboxStore();
try {
  const board = createLocalBoardAdapter(store, {scopeCheck: () => ({revoked:false,expiresAt:null})});
  let calls=0;
  const assistant = createSyntheticAssistantAdapter({enabledForLocalTestOnly:true,onCall:()=>calls++});
  const dispatcher = createDispatcher({store,boardAdapter:board,assistantAdapter:assistant,workerId:'demo',enabled:true});
  const message={owner:'demo-owner',task:'demo-task',text:'Hello World',idempotencyKey:'hello-world-demo'};
  const original=store.submitOwnerMessage(message);
  await dispatcher.runOnce();
  store.submitOwnerMessage(message);
  await dispatcher.runOnce();
  assert.equal(calls,1);
  assert.equal(store.listReplies(original.outbox.request_id).length,1);
  console.log('PICARD RELAY // local mission complete');
  console.log('One synthetic request, one stored answer, duplicate replay suppressed.');
  console.log('No network, API key, billing, deployment, or live AI invocation.');
} finally {store.close();}
