import assert from 'node:assert/strict';
import {createFixtureTaskExecutor} from '../experimental/runtime-control/src/adapters.mjs';
import {createDispatcher} from '../experimental/runtime-control/src/dispatcher.mjs';
import {createRelayStore} from '../experimental/runtime-control/src/relay-store.mjs';
import {canonical,digest,payloadHash} from '../experimental/runtime-control/src/protocol.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS '+name); };
const text = (operation='echo', value='Fixture text') => JSON.stringify({v:1,operation,text:value});
const input = (patch={}) => ({owner:'fixture-owner',task:'fixture-task',requestId:'a'.repeat(64),invocationId:'a'.repeat(64),attempt:1,requestText:text(),...patch});
const create = options => createFixtureTaskExecutor({enabledForLocalTestOnly:true,...options});

await test('disabled by default and always declares local-only production readiness', async () => {
  const disabled = createFixtureTaskExecutor();
  assert.equal(disabled.kind,'controlled-local-fixture-only');
  assert.equal(disabled.localTestOnly,true);
  assert.equal(disabled.ready,false);
  assert.equal(Object.isFrozen(disabled),true);
  assert.throws(()=>{disabled.ready=true;},TypeError);
  await assert.rejects(()=>disabled.answer(input()),{code:'fixture_disabled'});
  await assert.rejects(()=>create({enabledForLocalTestOnly:'true'}).answer(input()),{code:'fixture_disabled'});
  assert.equal(disabled.executedTasks,0);
  assert.equal(create().ready,false);
});

await test('only small deterministic echo and word-count fixtures are supported', async () => {
  const executor = create();
  const a = await executor.answer(input());
  assert.deepEqual(a,{kind:'answer',outcomeKind:'information',body:'Fixture only (echo): Fixture text',statusChange:null,eventId:'resp:'+'a'.repeat(64),owner:'fixture-owner',task:'fixture-task',requestId:'a'.repeat(64),attempt:1});
  const b = await executor.answer(input({requestId:'b',invocationId:'b',requestText:text('count-words','  one\n two\tthree  ')}));
  assert.equal(b.body,'Fixture only (count-words): 3');
  const c = await executor.answer(input({requestId:'c',invocationId:'c',requestText:text('count-words',' \t\n')}));
  assert.equal(c.body,'Fixture only (count-words): 0');
  assert.equal(executor.executedTasks,3);
});

await test('hostile shell code URLs and instructions remain inert fixture text', async () => {
  const hostile = '$(Invoke-WebRequest https://invalid.example); `rm -rf /`; <script>alert(1)</script>; eval("throw Error()")';
  let callbacks = 0;
  const executor = create();
  const result = await executor.answer(input({requestText:text('echo',hostile),context:{execute(){callbacks++;},taskContext:{command:hostile}}}));
  assert.equal(result.body,'Fixture only (echo): '+hostile);
  assert.equal(callbacks,0);
  assert.equal(executor.executedTasks,1);
});

await test('unknown operations and extra execution fields fail without consuming a task', async () => {
  const executor = create();
  for (const operation of ['shell','eval','exec','fetch','http','tools','count-words;exec']) {
    await assert.rejects(()=>executor.answer(input({requestText:text(operation)})),{code:'fixture_task_unsupported'});
  }
  for (const value of [{v:1,operation:'echo',text:'x',command:'calc'}, {v:1,operation:'echo',text:'x',tools:[]}, {v:1,operation:'echo',text:'x',url:'https://invalid.example'}]) {
    await assert.rejects(()=>executor.answer(input({requestText:JSON.stringify(value)})),{code:'fixture_invalid_request'});
  }
  assert.equal(executor.executedTasks,0);
});

await test('malformed or ambiguous fixture envelopes are denied', async () => {
  const executor = create();
  for (const value of ['', '{', 'null', '[]', '"echo"', JSON.stringify({v:2,operation:'echo',text:'x'}), JSON.stringify({v:1,operation:'echo',text:42}), JSON.stringify({operation:'echo',text:'x'}), '{"v":1,"operation":"echo","text":"x","__proto__":{}}']) {
    await assert.rejects(()=>executor.answer(input({requestText:value})),{code:'fixture_invalid_request'});
  }
  await assert.rejects(()=>executor.answer(input({requestText:{operation:'echo'}})),{code:'fixture_invalid_request'});
  assert.equal(executor.executedTasks,0);
});

await test('identities invocation correlation and bounded attempts are required', async () => {
  const executor = create();
  for (const patch of [{owner:''},{owner:'x'.repeat(201)},{task:null},{requestId:3},{invocationId:'other'},{attempt:0},{attempt:1.5},{attempt:1001}]) {
    await assert.rejects(()=>executor.answer(input(patch)),{code:'fixture_identity_invalid'});
  }
  await assert.rejects(()=>executor.answer(null),{code:'fixture_identity_invalid'});
  assert.equal(executor.executedTasks,0);
});

await test('input size is bounded by characters and UTF-8 bytes', async () => {
  const executor = create();
  for (const requestText of [text('echo','x'.repeat(513)),text('echo','€'.repeat(512)),' '.repeat(1025)]) {
    await assert.rejects(()=>executor.answer(input({requestText})),{code:'fixture_input_too_large'});
  }
  const result = await executor.answer(input({requestText:text('echo','é'.repeat(512))}));
  assert.equal(result.body,'Fixture only (echo): '+'é'.repeat(512));
  assert.equal(executor.executedTasks,1);
});

await test('already cancelled work consumes no task and invokes no callback', async () => {
  const executor = create(), controller = new AbortController();
  controller.abort();
  await assert.rejects(()=>executor.answer(input({signal:controller.signal})),{code:'fixture_cancelled_before_run'});
  await assert.rejects(()=>executor.answer(input({signal:{aborted:false}})),{code:'fixture_invalid_request'});
  assert.equal(executor.executedTasks,0);
});

await test('limits cannot be expanded beyond eight tasks or disabled by coercion', async () => {
  for (const maxTasks of [0,-1,9,1.5,Infinity,NaN,'8',null]) assert.throws(()=>create({maxTasks}),{code:'fixture_invalid_limits'});
  const executor = create({maxTasks:1});
  await executor.answer(input());
  await assert.rejects(()=>executor.answer(input({requestId:'b',invocationId:'b'})),{code:'fixture_task_limit'});
  assert.equal(executor.executedTasks,1);
});

await test('exact replay is cached and changed content or identity cannot reuse a request', async () => {
  const executor = create({maxTasks:1});
  const result = await executor.answer(input());
  result.body = 'Caller mutation';
  const replay = await executor.answer(input({attempt:2}));
  assert.equal(replay.body,'Fixture only (echo): Fixture text');
  assert.equal(replay.eventId,result.eventId);
  assert.equal(replay.attempt,2);
  for (const patch of [{owner:'another'},{task:'another'},{requestText:text('echo','changed')}]) {
    await assert.rejects(()=>executor.answer(input(patch)),{code:'idempotency_conflict'});
  }
  assert.equal(executor.executedTasks,1);
});

await test('production dispatcher rejects fixture kind or marker before claiming work', async () => {
  let claims = 0;
  const store = {claimNext(){claims++;}}, boardAdapter = {scopeEnforced:true};
  for (const assistantAdapter of [create(), {kind:'controlled-local-fixture-only',localTestOnly:false}, {kind:'renamed-fixture',localTestOnly:true}]) {
    assert.throws(()=>createDispatcher({store,boardAdapter,assistantAdapter,enabled:true,production:true,dbPath:'fixture.db'}),{code:'production_fixture_forbidden'});
  }
  assert.throws(()=>createDispatcher({store,boardAdapter:{...boardAdapter,localTestOnly:true},assistantAdapter:{kind:'provider'},enabled:true,production:true,dbPath:'fixture.db'}),{code:'production_fixture_forbidden'});
  assert.equal(claims,0);
});

await test('local fixture dispatcher stores one deterministic result and immutable replay makes no second task', async () => {
  const at=Date.now(), store=createRelayStore({dbPath:':memory:',now:()=>at});
  try {
    const payload={v:1,eventId:await digest(canonical(['fixture-owner','fixture-task','fixture-message'])),ownerId:'fixture-owner',taskId:'fixture-task',requestId:'fixture-message',grantId:'fixture-grant',assistantId:'fixture-local-only',grantExpiresAt:at+60000,request:{text:text('count-words','one two'),createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Local fixture',nextAction:'',latestFinding:''}};
    payload.payloadHash=await payloadHash(payload);
    await store.accept(payload);
    const assistantAdapter=create({maxTasks:1}),boardAdapter={kind:'local-fixture-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
    const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter,enabled:true,production:false,workerId:'fixture-worker'});
    assert.equal((await dispatcher.runOnce()).status,'completed');
    assert.equal(JSON.parse(store.get(payload.eventId).result_json).body,'Fixture only (count-words): 2');
    assert.equal((await store.accept(payload)).state,'completed');
    assert.equal((await dispatcher.runOnce()).status,'idle');
    assert.equal(assistantAdapter.executedTasks,1);
  } finally {store.close();}
});

console.log(`${passed} controlled local fixture cases passed; no production execution or live calls.`);
