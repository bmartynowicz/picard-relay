import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createRelayStore} from '../src/relay-store.mjs';import * as p from '../src/protocol.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function setup(t){
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());const usage=store.openCodexUsage('owner');
 const native=(label,extra={})=>({v:1,id:hash(label),model:'gpt-6.1-sol',effort:'low',recordedAt:1000,inputTokens:100,cachedInputTokens:50,outputTokens:20,comparisonId:null,variant:null,tools:[],...extra});
 const b=native('baseline',{comparisonId:'model-quality',variant:'baseline'}),a=native('assisted',{comparisonId:'model-quality',variant:'assisted',tools:['prepare_context']}),review=native('baseline-review');
 for(const row of [b,a,review])assert.equal(usage.record(row),'saved');
 const at=Date.now(),work={v:1,ownerId:'owner',taskId:'task',requestId:'synthetic-qwen',grantId:'synthetic-grant',assistantId:'groq:qwen/qwen3.8-27b',grantExpiresAt:at+60000,request:{text:'Synthetic public proposal',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Synthetic model-quality fixture',nextAction:'',latestFinding:''}};
 work.eventId=await p.digest(p.canonical([work.ownerId,work.taskId,work.requestId]));work.payloadHash=await p.payloadHash(work);
 await store.accept(work);const claim=store.claimNext({workerId:'fixture',claimTtlMs:60000}),identity={owner:'owner',task:'task',requestId:work.eventId,workerId:'fixture',attempt:claim.attempt};store.startInvocation(identity);
 store.appendReply({...identity,eventId:'resp:'+work.eventId,kind:'answer',outcomeKind:'information',statusChange:null,body:'Synthetic saved proposal',providerUsage:{v:1,provider:'groq',model:'qwen/qwen3.8-27b',inputTokens:10,outputTokens:20,totalTokens:30}});store.markCompleted(identity);
 for(const variant of ['baseline','assisted'])assert.equal(usage.record({v:1,kind:'workflow',comparisonId:'model-quality',variant,preparationIds:[review.id],picardRefs:variant==='assisted'?[work.eventId]:[] }),'saved');
 const quality={v:1,kind:'quality',id:hash('observation-1'),comparisonId:'model-quality',rootId:a.id,initialReviewId:a.id,providerRef:work.eventId,providerModel:'qwen/qwen3.8-27b',taskFingerprint:hash('frozen requirements'),evidenceSha256:hash('saved review evidence'),firstPassPassed:false,finalQualified:false,repairIds:[],recheckIds:[]};
 return {store,usage,native,b,a,review,work,quality,pair:()=>usage.overview().runs.find(r=>r.id===a.id).comparison};
}
test('quality distinguishes actual repairs and rechecks from coordination without changing full costs',async t=>{
 const x=await setup(t);assert.equal(x.usage.record(x.quality),'saved');assert.equal(x.usage.record(x.quality),'duplicate');
 const fix=x.native('fix',{recordedAt:2000,followUpTo:x.a.id}),recheck=x.native('recheck',{recordedAt:3000,followUpTo:x.a.id}),coord=x.native('coordination',{recordedAt:4000,followUpTo:x.a.id});
 for(const row of [fix,recheck,coord])assert.equal(x.usage.record(row),'saved');
 const before=x.pair().assisted.workflow.codexCredits;
 assert.equal(x.usage.record({...x.quality,id:hash('observation-2'),repairIds:[fix.id],recheckIds:[recheck.id],finalQualified:true}),'saved');
 const side=x.pair().assisted;assert.equal(side.workflow.followUpCount,3);assert.equal(side.quality.repairs.turns,1);assert.equal(side.quality.rechecks.turns,1);assert.equal(side.quality.firstPassPassed,false);assert.equal(side.quality.finalQualified,true);
 assert.equal(side.quality.repairs.tokens,120);assert.equal(side.workflow.codexCredits,before);assert.equal(side.quality.repairs.estimatedCredits,0.007625);assert.match(side.quality.source,/separate from owner acceptance/);
});
test('baseline review and unknown outcomes stay explicit',async t=>{
 const x=await setup(t);const q={...x.quality,id:hash('baseline-q'),rootId:x.b.id,initialReviewId:x.review.id,providerRef:null,providerModel:null,firstPassPassed:null,finalQualified:null};
 assert.equal(x.usage.record(q),'saved');assert.equal(x.pair().baseline.quality.firstPassPassed,null);assert.equal(x.pair().baseline.quality.repairs.turns,0);
});
test('wrong models, owner scopes, root links and initial reviews fail closed',async t=>{
 const x=await setup(t);assert.equal(x.usage.record({...x.quality,providerModel:'openai/gpt-oss-120b'}),'conflict');
 assert.equal(x.store.openCodexUsage('other').record(x.quality),'conflict');assert.equal(x.usage.record({...x.quality,initialReviewId:hash('missing')}),'conflict');
 const wrong=x.native('unlinked-fix');x.usage.record(wrong);assert.equal(x.usage.record({...x.quality,repairIds:[wrong.id]}),'conflict');
});
test('observations are immutable; overlapping repair/check IDs and invalid verdicts are rejected',async t=>{
 const x=await setup(t);assert.equal(x.usage.record(x.quality),'saved');assert.equal(x.usage.record({...x.quality,firstPassPassed:true}),'conflict');
 assert.equal(x.usage.record({...x.quality,id:hash('bad'),firstPassPassed:'passed'}),'invalid');
 assert.equal(x.usage.record({...x.quality,id:hash('overlap'),repairIds:[hash('f')],recheckIds:[hash('f')]}),'invalid');
});
