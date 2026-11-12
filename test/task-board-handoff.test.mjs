import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateHandoffInput,createHandoffDraft,validateHandoffDraft,handoffState,handoffDigest,HANDOFF_LIFETIME_MS} from '../integrations/task-board-handoff.mjs';
const input=()=>({taskId:'synthetic-task',expectedRevision:7,requestText:'Review this synthetic plan.',taskContext:{title:'Synthetic review',nextAction:'Review the saved answer.',latestFinding:'Synthetic data only.'},provenance:'synthetic',outputTokenLimit:512,idempotencyKey:'handoff:test-01'});
const draft=()=>createHandoffDraft('owner',input(),{id:randomUUID(),requestId:randomUUID(),grantId:randomUUID(),now:1000});
test('strict inert input preserves exact bytes and rejects injected authority',()=>{
 const v=input();v.requestText+=' ';assert.deepEqual(validateHandoffInput(v),v);
 for(const injection of [{ownerId:'other'},{approve:true},{model:'other'},{url:'https://other.test'},{tools:true},{retries:1},{paidFallback:true}])assert.throws(()=>validateHandoffInput({...v,...injection}),/input_invalid/);
 for(const change of [{expectedRevision:0},{expectedRevision:Number.MAX_SAFE_INTEGER},{requestText:' '},{outputTokenLimit:513},{provenance:'private'},{idempotencyKey:'short'},{taskContext:{...v.taskContext,hidden:'extra'}}])assert.throws(()=>validateHandoffInput({...v,...change}),/input_invalid/);
});
test('character and UTF-8 limits are enforced independently',()=>{
 const v=input();v.requestText='a'.repeat(4000);v.taskContext.latestFinding='b'.repeat(4000);validateHandoffInput(v);
 assert.throws(()=>validateHandoffInput({...v,requestText:'a'.repeat(4001)}));
 assert.throws(()=>validateHandoffInput({...v,requestText:'界'.repeat(4000)}));
});
test('durable draft binds owner, task revision, exact text, IDs, limits and expiry',async()=>{
 const v=await draft();assert.equal(v.expiresAt-v.createdAt,HANDOFF_LIFETIME_MS);assert.deepEqual(await validateHandoffDraft(v,'owner','synthetic-task'),v);
 assert.equal(v.inputHash,await handoffDigest({requestText:v.input.requestText,taskContext:v.input.taskContext}));
 for(const change of [{ownerId:'other'},{expiresAt:v.expiresAt+1},{requestId:randomUUID()},{draftSha256:'0'.repeat(64)},{input:{...v.input,expectedRevision:8}},{input:{...v.input,requestText:'Changed'}},{approve:true}])await assert.rejects(validateHandoffDraft({...v,...change},'owner','synthetic-task'));
 await assert.rejects(validateHandoffDraft(v,'other','synthetic-task'));await assert.rejects(validateHandoffDraft(v,'owner','other-task'));
});
test('saved and uncertain outcomes cannot become a fresh approval after task edits or expiry',()=>{
 const base={expiresAt:20,currentRevision:7,expectedRevision:7,now:10};
 assert.equal(handoffState(base),'awaiting_owner_approval');assert.equal(handoffState({...base,currentRevision:8}),'stale');assert.equal(handoffState({...base,now:21}),'expired');
 assert.equal(handoffState({...base,grant:{revokedAt:1}}),'revoked');assert.equal(handoffState({...base,grant:{revokedAt:null}}),'approved_not_sent');
 assert.equal(handoffState({...base,now:30,currentRevision:9,work:{state:'completed'}}),'completed');assert.equal(handoffState({...base,now:30,work:{state:'blocked',last_error:'invocation_outcome_uncertain'}}),'uncertain');
 assert.equal(handoffState({...base,work:{state:'queued'}}),'queued');assert.equal(handoffState({...base,work:{state:'claimed'}}),'running');assert.equal(handoffState({...base,work:{state:'new_fake_state'}}),'unknown');
});
