// Offline reporting regressions. No credentials or provider requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelayStore} from '../src/relay-store.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {AdapterBlockedError} from '../src/adapters.mjs';
import {canonical, digest, payloadHash} from '../src/protocol.mjs';
import {startOracleService} from '../src/oracle-service.mjs';

const secretText = 'SYNTHETIC_PRIVATE_ERROR_SENTINEL';
const assistantId = 'groq:openai/gpt-oss-20b';
async function payload(at) {
  const p = {v:1, eventId:await digest(canonical(['owner','task','message'])), ownerId:'owner', taskId:'task', requestId:'message', grantId:'grant', assistantId, grantExpiresAt:at+60000,
    request:{text:'Offline outcome fixture', createdAt:new Date(at).toISOString(), answerTo:null}, context:{title:'Fixture', nextAction:'Review', latestFinding:'Synthetic'}};
  p.payloadHash = await payloadHash(p);
  return p;
}
async function fixture(t, {groq = true} = {}) {
  let clock = Date.now(), calls = 0;
  const dir = mkdtempSync(join(tmpdir(), 'picard-outcomes-')), dbPath = join(dir, 'ledger.sqlite');
  let store = createRelayStore({dbPath, now:()=>clock});
  const p = await payload(clock);
  await store.accept(p);
  t.after(()=>{store.close(); rmSync(dir,{recursive:true,force:true});});
  const board = {scopeEnforced:true, getTaskContext:i=>store.getTaskContext(i), appendReply:i=>store.appendReply(i), getReplyByRequestId:id=>store.getReplyByRequestId(id)};
  const adapter = {kind:'offline-reporting-fixture', ...(groq?{assistantId}:{}), async answer(){calls++; throw Object.assign(Error(secretText), {code:'groq_outcome_uncertain'});}};
  return {p, board, adapter, get store(){return store;}, get calls(){return calls;}, advance(ms){clock+=ms;},
    reopen(){store.close();store=createRelayStore({dbPath,now:()=>clock});},
    run(overrides={}){return createDispatcher({store:{...store,...overrides}, boardAdapter:board, assistantAdapter:adapter, enabled:true, workerId:'fixture', claimTtlMs:1000}).runOnce();}};
}

test('unknown external outcome reports the committed uncertain state, including the service log projection, and never reclaims', async t=>{
  const f=await fixture(t), result=await f.run();
  assert.equal(result.status,'uncertain');
  assert.equal(result.status,f.store.get(f.p.eventId).state);
  assert.equal(result.code,'groq_outcome_uncertain');
  assert.equal(JSON.stringify(result).includes(secretText),false);
  assert.equal(JSON.parse(JSON.stringify({state:result.status,eventId:result.requestId,attempt:result.attempt,code:result.code})).state,'uncertain');
  f.reopen();f.advance(1001);
  assert.equal((await f.run()).status,'idle');
  assert.equal(f.store.get(f.p.eventId).state,'uncertain');
  assert.equal(f.store.get(f.p.eventId).attempt,1);
  assert.equal(f.calls,1);
});

test('a pre-invocation context failure reports the actual failed transition with zero calls', async t=>{
  const f=await fixture(t);f.board.getTaskContext=()=>{throw Error(secretText);};
  assert.equal((await f.run()).status,'failed');
  assert.equal(f.store.get(f.p.eventId).state,'failed');assert.equal(f.calls,0);
});

test('an allowlisted scope refusal reports the actual blocked transition with zero calls', async t=>{
  const f=await fixture(t);f.board.getTaskContext=()=>{throw new AdapterBlockedError('identity_mismatch',secretText);};
  const result=await f.run();assert.equal(result.status,'blocked');assert.equal(result.code,'identity_mismatch');
  assert.equal(f.store.get(f.p.eventId).state,'blocked');assert.equal(f.calls,0);
});

for (const readback of ['throws','missing','unavailable','wrong-request','invalid-state']) {
  test('failed outcome persistence and '+readback+' readback report unknown, never a fabricated terminal outcome',async t=>{
    const f=await fixture(t), overrides={markFailed(){throw Error(secretText);}, get:readback==='unavailable'?undefined:()=>{
      if(readback==='throws')throw Error(secretText);
      if(readback==='missing')return null;
      const row=f.store.get(f.p.eventId);
      return {...row,...(readback==='wrong-request'?{event_id:'other-request'}:{state:'untrusted-state'})};
    }};
    const result=await f.run(overrides);
    assert.equal(result.status,'unknown');
    assert.equal(f.store.get(f.p.eventId).state,'invoking');
    assert.match(result.message,/review/i);assert.match(result.message,/do not resubmit/i);
    assert.equal(JSON.stringify(result).includes(secretText),false);
    f.reopen();f.advance(1001);assert.equal((await f.run()).status,'idle');assert.equal(f.calls,1);
    assert.equal(f.store.get(f.p.eventId).state,'uncertain');
  });
}

test('failed write with a successful readback reports the last confirmed invoking state',async t=>{
  const f=await fixture(t),result=await f.run({markFailed(){throw Error(secretText);}});
  assert.equal(result.status,'invoking');assert.equal(result.status,f.store.get(f.p.eventId).state);
  assert.equal(f.calls,1);
});

test('a refused request with an unconfirmed blocked write is unknown rather than reported blocked',async t=>{
  const f=await fixture(t);f.board.getTaskContext=()=>{throw new AdapterBlockedError('identity_mismatch',secretText);};
  const result=await f.run({markBlocked(){throw Error(secretText);},get:()=>null});
  assert.equal(result.status,'unknown');assert.equal(f.store.get(f.p.eventId).state,'claimed');assert.equal(f.calls,0);
});

test('non-Groq errors expose only an allowlisted code and safe review guidance',async t=>{
  const f=await fixture(t,{groq:false});f.adapter.answer=()=>{throw Object.assign(Error(secretText),{code:secretText});};
  const result=await f.run();assert.equal(result.code,'dispatcher_error');
  assert.equal(result.status,'uncertain');assert.equal(JSON.stringify(result).includes(secretText),false);
  assert.equal(f.store.get(f.p.eventId).last_error,'dispatcher_error');
  assert.match(result.message,/do not resubmit/i);
});

test('completion committed before an acknowledgement failure is reported completed without another answer',async t=>{
  const f=await fixture(t);let answers=0;
  f.adapter.answer=async i=>{answers++;return {...i,eventId:'resp:'+i.requestId,kind:'answer',outcomeKind:'information',statusChange:null,body:'Saved fixture answer'};};
  const result=await f.run({markCompleted(i){f.store.markCompleted(i);throw Error(secretText);}});
  assert.equal(result.status,'completed');assert.equal(f.store.get(f.p.eventId).state,'completed');
  assert.equal(JSON.parse(f.store.get(f.p.eventId).result_json).body,'Saved fixture answer');
  f.reopen();f.advance(1001);assert.equal((await f.run()).status,'idle');assert.equal(answers,1);
});

test('saved reply with a lost completion reconciles after restart with zero new answers',async t=>{
  const f=await fixture(t),claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000}),owned={requestId:f.p.eventId,attempt:claim.attempt,workerId:'fixture'};
  f.store.startInvocation(owned);f.store.appendReply({...owned,owner:'owner',task:'task',eventId:'resp:'+f.p.eventId,kind:'answer',outcomeKind:'information',statusChange:null,body:'Already saved'});
  f.reopen();f.advance(1001);assert.equal((await f.run()).status,'reconciled');assert.equal(f.calls,0);
  assert.equal(f.store.get(f.p.eventId).state,'completed');assert.equal(JSON.parse(f.store.get(f.p.eventId).result_json).body,'Already saved');
});

test('actual service log agrees with persisted uncertain outcome and excludes raw errors',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'picard-log-')),dbPath=join(dir,'ledger.sqlite'),p=await payload(Date.now());
  const seed=createRelayStore({dbPath});await seed.accept(p);seed.close();
  let runtime,calls=0,resolveLog,rejectLog;
  const records=[],originalLog=console.log;
  const observed=new Promise((resolve,reject)=>{resolveLog=resolve;rejectLog=reject;});
  const timeout=setTimeout(()=>rejectLog(Error('fixture_log_timeout')),3000);
  console.log=value=>{records.push(String(value));let record;try{record=JSON.parse(value);}catch{return;}if(record.eventId===p.eventId)resolveLog(record);};
  try {
    runtime=await startOracleService({dbPath,port:0,ownerId:'owner',allowedTaskId:'task',assistantId,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'},
      {ready:true,assistantId,kind:'offline-log-fixture',async answer(){calls++;throw Object.assign(Error(secretText),{code:'groq_outcome_uncertain'});}}, {intervalMs:5,installSignals:false});
    const record=await observed;await runtime.shutdown();
    const saved=createRelayStore({dbPath});try{assert.equal(record.state,saved.get(p.eventId).state);}finally{saved.close();}
    assert.equal(record.state,'uncertain');assert.equal(record.code,'groq_outcome_uncertain');
    assert.equal(records.join('\n').includes(secretText),false);assert.equal(calls,1);
  } finally {clearTimeout(timeout);console.log=originalLog;if(runtime)await runtime.shutdown();rmSync(dir,{recursive:true,force:true});}
});
