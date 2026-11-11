import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createServer,request} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelayStore} from '../src/relay-store.mjs';
import {createConsoleHandler} from '../src/oracle-service.mjs';
import {readCodexExecTools,readCompletedCodexUsage} from '../../../tools/codex-usage-notify.mjs';
import {canonical,digest,payloadHash} from '../src/protocol.mjs';

const run={
 v:1,id:'a'.repeat(64),model:'test-model',effort:'low',recordedAt:1000,
 inputTokens:10000,cachedInputTokens:8000,outputTokens:2000,tools:[],comparisonId:'sample',variant:'baseline'
};
const assisted={...run,id:'b'.repeat(64),recordedAt:2000,inputTokens:7500,cachedInputTokens:5500,outputTokens:500,
 tools:['compute_ci_status'],variant:'assisted'};

test('whole workflow persists preparation, actual provider usage and late fixes without double counting',async t=>{
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());
 const usage=store.openCodexUsage('owner');
 const root={...run,model:'gpt-6.1-sol'},withPicard={...assisted,model:'gpt-6.1-sol'};
 const preparation={...root,id:'c'.repeat(64),comparisonId:null,variant:null,inputTokens:500,cachedInputTokens:100,outputTokens:100};
 for(const row of [root,withPicard,preparation])assert.equal(usage.record(row),'saved');
 const at=Date.now(),p={v:1,ownerId:'owner',taskId:'task',requestId:'provider-request',grantId:'grant',assistantId:'groq:openai/gpt-oss-20b',grantExpiresAt:at+60000,
  request:{text:'Summarize public references.',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Fixture',nextAction:'',latestFinding:''}};
 p.eventId=await digest(canonical([p.ownerId,p.taskId,p.requestId]));p.payloadHash=await payloadHash(p);
 await store.accept(p);const claim=store.claimNext({workerId:'worker',claimTtlMs:60000});
 const identity={owner:'owner',task:'task',requestId:p.eventId,attempt:claim.attempt,workerId:'worker'};
 store.startInvocation(identity);
 store.appendReply({...identity,eventId:'resp:'+p.eventId,kind:'answer',outcomeKind:'information',body:'Saved summary',statusChange:null,
  providerUsage:{v:1,provider:'groq',model:'openai/gpt-oss-20b',inputTokens:1500,outputTokens:200,totalTokens:1700}});
 store.markCompleted(identity);
 const scope=variant=>({v:1,kind:'workflow',comparisonId:'sample',variant,preparationIds:[preparation.id],picardRefs:variant==='assisted'?[p.eventId]:[]});
 for(const side of ['baseline','assisted']){assert.equal(usage.record(scope(side)),'saved');assert.equal(usage.record(scope(side)),'duplicate');}
 assert.equal(usage.record({...scope('assisted'),preparationIds:[] }),'conflict');
 let pair=usage.list().find(row=>row.id===withPicard.id).comparison;
 assert.equal(pair.baseline.workflow.totalTokens,12600);
 assert.equal(pair.assisted.workflow.totalTokens,10300);
 assert.equal(pair.assisted.workflow.preparationTokens,600);
 assert.equal(pair.assisted.workflow.picardTokens,1700);
 assert.equal(pair.assisted.workflow.codexTokens,8600);
 assert.equal(pair.assisted.workflow.providerBilledUsd,null);
 assert(pair.assisted.workflow.complete);
 assert.equal(usage.overview().rolling.sampleCount,1);
 assert.equal(usage.overview().rolling.assistedCredits,pair.assisted.workflow.codexCredits);
 const fix={...preparation,id:'d'.repeat(64),recordedAt:4000,followUpTo:withPicard.id};
 assert.equal(usage.record(fix),'saved');assert.equal(usage.record(fix),'duplicate');
 pair=usage.list().find(row=>row.id===withPicard.id).comparison;
 assert.equal(pair.assisted.workflow.totalTokens,10900);assert.equal(pair.assisted.workflow.followUpCount,1);
 assert.equal(pair.assisted.workflow.preparationTokens,600);
 assert.equal(usage.overview().rolling.sampleCount,1);
 assert.equal(usage.overview().rolling.assistedCredits,pair.assisted.workflow.codexCredits);
 // A later Picard correction joins the original comparison without rewriting its coverage.
 assert.equal(usage.record({v:1,kind:'picard-call',comparisonId:'sample',ref:'f'.repeat(64)}),'saved');
 assert.equal(usage.record({v:1,kind:'picard-call',comparisonId:'sample',ref:'f'.repeat(64)}),'duplicate');
 pair=usage.list().find(row=>row.id===withPicard.id).comparison;
 assert.equal(pair.assisted.workflow.complete,false);assert.equal(pair.assisted.workflow.picardCalls,2);
 assert.equal(pair.assisted.workflow.totalTokens,null);
 assert.equal(usage.overview().rolling.sampleCount,0);
 assert.equal(usage.overview().rolling.excluded.incomplete,1);
 const other=store.openCodexUsage('other');
 other.record(root);other.record(withPicard);other.record(preparation);other.record(scope('assisted'));other.record(scope('baseline'));
 const hidden=other.list().find(row=>row.id===withPicard.id).comparison.assisted.workflow;
 assert.equal(hidden.complete,false);assert.equal(hidden.totalTokens,null);assert.equal(hidden.picardTokens,null);
 assert.equal(hidden.calls[0].state,'unavailable');
 assert.equal(other.overview().rolling.sampleCount,0);
});

function fullPair(usage,index,baselineInput,assistedInput,{model='gpt-6.1-sol',scope=true}={}){
 const comparisonId='rolling-'+index;
 const id=side=>createHash('sha256').update(comparisonId+side).digest('hex');
 const baseline={...run,id:id('baseline'),comparisonId,model,inputTokens:baselineInput,cachedInputTokens:0,outputTokens:0,recordedAt:index*10};
 const withPicard={...baseline,id:id('assisted'),variant:'assisted',tools:['prepare_context'],inputTokens:assistedInput,recordedAt:index*10+1};
 for(const row of [baseline,withPicard])assert.equal(usage.record(row),'saved');
 if(scope)for(const variant of ['baseline','assisted'])assert.equal(usage.record({v:1,kind:'workflow',comparisonId,variant,preparationIds:[],picardRefs:[] }),'saved');
 return {baseline,withPicard};
}

test('rolling savings weights complete totals, retains increases and survives restart with owner isolation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'picard-rolling-'));
 const dbPath=join(directory,'relay.sqlite');let store=createRelayStore({dbPath});
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
 let usage=store.openCodexUsage('owner');
 fullPair(usage,1,20000,10000); // 1 versus 0.5 credits: 50% saved.
 fullPair(usage,2,2000000,2200000); // 100 versus 110: 10% more.
 fullPair(usage,3,1000,500,{scope:false});
 fullPair(usage,4,1000,500,{model:'unknown-model'});
 const incomplete=fullPair(usage,5,1000,500,{scope:false});
 usage.record({v:1,kind:'workflow',comparisonId:incomplete.baseline.comparisonId,variant:'baseline',preparationIds:['f'.repeat(64)],picardRefs:[]});
 const expected=usage.overview().rolling;
 assert.equal(expected.sampleCount,2);assert.equal(expected.baselineCredits,101);assert.equal(expected.assistedCredits,110.5);
 assert.equal(expected.savedCredits,-9.5);assert(Math.abs(expected.savedPercent-(-9.5/101*100))<1e-10);
 assert.equal(expected.increasedCount,1);assert.deepEqual(expected.excluded,{legacy:1,incomplete:1,unpriced:1});
 assert.equal(store.openCodexUsage('other').overview().rolling.sampleCount,0);
 store.close();store=createRelayStore({dbPath});usage=store.openCodexUsage('owner');
 assert.deepEqual(usage.overview().rolling,expected);
});

test('rolling window uses twenty comparisons beyond the twelve rows and updates an old root once for a fix',t=>{
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());const usage=store.openCodexUsage('owner');
 const first=fullPair(usage,1,1000000,1000000);
 for(let i=2;i<=22;i++)fullPair(usage,i,20000,10000);
 // Newer unpaired activity fills all twelve visible rows without changing the wider window.
 for(let i=0;i<15;i++)usage.record({...run,id:createHash('sha256').update('unpaired'+i).digest('hex'),comparisonId:null,variant:null,recordedAt:1000+i});
 let snapshot=usage.overview();
 assert.equal(snapshot.runs.length,12);assert(snapshot.runs.every(row=>!row.comparison));
 assert.equal(snapshot.rolling.sampleCount,20);assert.equal(snapshot.rolling.eligibleCount,22);
 assert.equal(snapshot.rolling.baselineCredits,20);assert.equal(snapshot.rolling.assistedCredits,10);
 assert.equal(snapshot.rolling.fromRecordedAt,31);
 const fix={...run,id:'f'.repeat(64),comparisonId:null,variant:null,model:'gpt-6.1-sol',recordedAt:2000,inputTokens:20000,cachedInputTokens:0,outputTokens:0,followUpTo:first.withPicard.id};
 assert.equal(usage.record(fix),'saved');assert.equal(usage.record(fix),'duplicate');
 snapshot=usage.overview();
 assert.equal(snapshot.rolling.sampleCount,20);assert.equal(snapshot.rolling.eligibleCount,22);
 assert.equal(snapshot.rolling.baselineCredits,69);assert.equal(snapshot.rolling.assistedCredits,60.5);
 assert.equal(snapshot.rolling.toRecordedAt,2000);assert.equal(snapshot.runs[0].id,first.withPicard.id);
 assert.equal(snapshot.runs[0].comparison.assisted.workflow.followUpCount,1);
});

test('empty rolling history exposes unknown savings rather than zero',t=>{
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());
 const rolling=store.openCodexUsage('owner').overview().rolling;
 assert.equal(rolling.sampleCount,0);
 for(const key of ['baselineCredits','assistedCredits','savedCredits','savedPercent','fromRecordedAt','toRecordedAt'])assert.equal(rolling[key],null);
});

test('coverage never silently treats absent or double-counted preparation and provider usage as zero',t=>{
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());const usage=store.openCodexUsage('owner');
 usage.record(run);usage.record(assisted);
 const scope={v:1,kind:'workflow',comparisonId:'sample',variant:'assisted',preparationIds:[assisted.id,'c'.repeat(64)],picardRefs:['d'.repeat(64)]};
 assert.equal(usage.record(scope),'saved');
 const w=usage.list().find(row=>row.id===assisted.id).comparison.assisted.workflow;
 assert.equal(w.complete,false);assert.equal(w.totalTokens,null);assert.equal(w.preparationTokens,0);
 assert.deepEqual(w.missing,['preparation','picard']);
 assert.equal(usage.record({...scope,variant:'baseline'}),'invalid');
 assert.equal(usage.record({...scope,preparationIds:[assisted.id,assisted.id]}),'invalid');
 assert.equal(usage.record({...scope,privateSource:'not allowed'}),'invalid');
});

test('usage is immutable, persistent and compared only for matched runs',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'picard-usage-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const dbPath=join(directory,'relay.sqlite');
 let store=createRelayStore({dbPath}),usage=store.openCodexUsage('owner');
 try{
  assert.equal(usage.record(assisted),'saved');
  assert.equal(usage.list()[0].savedTokens,null);
  assert.equal(usage.record(run),'saved');
  assert.equal(usage.record(run),'duplicate');
  assert.equal(usage.record({...run,inputTokens:9000}),'conflict');
  assert.equal(usage.record({...run,id:'c'.repeat(64)}),'conflict');
  assert.equal(usage.record({...run,tools:['compute_ci_status']}),'invalid');
  assert.equal(usage.record({...assisted,tools:[]}),'invalid');
  assert.equal(usage.record({...run,prompt:'private data'}),'invalid');
  assert.equal(usage.list()[0].savedTokens,4000);
  assert.equal(usage.list()[0].baselineFreshTokens,4000);
  const changed={...assisted,id:'d'.repeat(64),comparisonId:'different-model',model:'other-model'};
  assert.equal(usage.record(changed),'saved');
  assert.equal(usage.record({...run,id:'e'.repeat(64),comparisonId:changed.comparisonId}),'saved');
  assert.equal(usage.list().find(value=>value.id===changed.id).savedTokens,null);
  assert.deepEqual(store.openCodexUsage('another-owner').list(),[]);
  store.close();
  store=createRelayStore({dbPath});usage=store.openCodexUsage('owner');
  assert.equal(usage.list().find(value=>value.id===assisted.id).baselineTokens,12000);
 }finally{store.close();}
});

test('a later baseline can name a standalone Picard run without changing either record',t=>{
 const store=createRelayStore({dbPath:':memory:'});
 t.after(()=>store.close());
 const usage=store.openCodexUsage('owner'),other=store.openCodexUsage('other');
 const original={...assisted,comparisonId:null,variant:null};
 const baseline={...run,recordedAt:3000,comparisonId:original.id};
 assert.equal(usage.record(original),'saved');
 assert.equal(other.record(baseline),'saved');
 assert.equal(usage.list()[0].baselineTokens,null);
 assert.equal(usage.record(baseline),'saved');
 const [savedBaseline,savedOriginal]=usage.list();
 assert.equal(savedBaseline.baselineTokens,null);
 assert.equal(savedOriginal.baselineTokens,12000);
 assert.equal(savedOriginal.baselineFreshTokens,4000);
 assert.equal(savedOriginal.savedTokens,4000);
 assert.equal(savedOriginal.comparisonId,null);
 assert.equal(savedOriginal.variant,null);
 assert.equal(usage.record(original),'duplicate');
 assert.equal(usage.record(baseline),'duplicate');
});

test('late pairing respects model, effort, run order and existing explicit pair IDs',t=>{
 const store=createRelayStore({dbPath:':memory:'});
 t.after(()=>store.close());
 const cases=[{model:'other'},{effort:'high'},{recordedAt:1999},{}];
 for(const [i,patch] of cases.entries()){
  const usage=store.openCodexUsage('owner-'+i);
  const original={...assisted,comparisonId:null,variant:null};
  const baseline={...run,recordedAt:3000,comparisonId:original.id,...patch};
  assert.equal(usage.record(original),'saved');
  assert.equal(usage.record(baseline),'saved');
  if(i===cases.length-1)
   assert.equal(usage.record({...assisted,id:'c'.repeat(64),comparisonId:original.id}),'saved');
  assert.equal(usage.list().find(value=>value.id===original.id).baselineTokens,null);
 }
});

test('comparison totals include linked turns on either side without rewriting usage',t=>{
 const store=createRelayStore({dbPath:':memory:'});
 t.after(()=>store.close());
 const usage=store.openCodexUsage('owner'),other=store.openCodexUsage('other');
 const fix={...run,id:'c'.repeat(64),recordedAt:3000,comparisonId:null,variant:null,
  inputTokens:300,cachedInputTokens:200,outputTokens:50};
 const manual={...fix,id:'d'.repeat(64),recordedAt:4000,inputTokens:400};
 const baselineFix={...fix,id:'e'.repeat(64),followUpTo:run.id};
 assert.equal(usage.record({...fix,followUpTo:assisted.id}),'saved');
 assert.equal(usage.record({...fix,followUpTo:assisted.id}),'duplicate');
 assert.equal(usage.record(manual),'saved');
 assert.equal(usage.record(baselineFix),'saved');
 assert.equal(usage.record(assisted),'saved');
 assert.equal(usage.record(run),'saved');
 assert.equal(usage.attach({id:manual.id,followUpTo:manual.id}),'invalid');
 assert.equal(other.attach({id:manual.id,followUpTo:assisted.id}),'conflict');
 assert.equal(usage.attach({id:manual.id,followUpTo:assisted.id}),'saved');
 assert.equal(usage.attach({id:manual.id,followUpTo:assisted.id}),'duplicate');
 assert.equal(usage.attach({id:manual.id,followUpTo:run.id}),'conflict');
 assert.equal(usage.record({...fix,followUpTo:run.id}),'conflict');
 assert.equal(usage.record(fix),'duplicate');
 assert.equal(usage.record(assisted),'duplicate');
 const measured=usage.list().find(row=>row.id===assisted.id);
 assert.equal(measured.totalTokens,8000);
 assert.equal(measured.baselineTokens,12000);
 assert.deepEqual(measured.comparison,{
  id:'sample',baseline:{totalTokens:12350,inputTokens:10300,cachedInputTokens:8200,outputTokens:2050,standardCredits:null,freshTokens:4150,followUpTokens:350,followUpCount:1,lastRecordedAt:3000},
  assisted:{totalTokens:8800,inputTokens:8200,cachedInputTokens:5900,outputTokens:600,standardCredits:null,freshTokens:2900,followUpTokens:800,followUpCount:2,lastRecordedAt:4000}
 });
});

test('Standard credit estimates expose a cache regression and count corrections on both sides', t=>{
 const store=createRelayStore({dbPath:':memory:'});t.after(()=>store.close());
 const usage=store.openCodexUsage('owner');
 const baseline={...run,model:'gpt-6.1-sol',inputTokens:17352,cachedInputTokens:12288,outputTokens:985};
 const withPicard={...assisted,model:'gpt-6.1-sol',inputTokens:16500,cachedInputTokens:7168,outputTokens:921};
 usage.record(baseline);usage.record(withPicard);
 let pair=usage.list().find(row=>row.id===withPicard.id).comparison;
 assert.equal(pair.baseline.standardCredits,.53017);
 assert.equal(pair.assisted.standardCredits,.71477);
 assert(pair.assisted.totalTokens<pair.baseline.totalTokens);
 assert(pair.assisted.standardCredits>pair.baseline.standardCredits);
 for(const [id,original] of [['c',baseline],['d',withPicard]])usage.record({...original,id:id.repeat(64),recordedAt:3000,
  comparisonId:null,variant:null,tools:[],inputTokens:100,cachedInputTokens:40,outputTokens:20,followUpTo:original.id});
 pair=usage.list().find(row=>row.id===withPicard.id).comparison;
 assert(Math.abs(pair.baseline.standardCredits-(.53017+.0081))<1e-12);
 assert(Math.abs(pair.assisted.standardCredits-(.71477+.0081))<1e-12);
 assert.equal(pair.assisted.followUpCount,1);
 usage.record({...withPicard,id:'e'.repeat(64),recordedAt:4000,comparisonId:null,variant:null,model:'unknown-model',followUpTo:withPicard.id});
 assert.equal(usage.list().find(row=>row.id===withPicard.id).comparison.assisted.standardCredits,null);
});

test('Codex callback projects only completed turn usage and successful Picard tool names',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'picard-codex-trace-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'trace.jsonl'),turnId='current';
 const event=(type,payload)=>({type,payload});
 const usage=(input_tokens,cached_input_tokens,output_tokens)=>event('event_msg',
  {type:'token_count',info:{total_token_usage:{input_tokens,cached_input_tokens,output_tokens}}});
 const entries=[
  usage(32000,25000,400),
  event('event_msg',{type:'task_started',turn_id:turnId}),
  event('turn_context',{turn_id:turnId,model:'test-model',effort:'low',cwd:'private path'}),
  event('event_msg',{type:'mcp_tool_call_end',invocation:{server:'picard',tool:'compute_ci_status'},result:{Ok:{content:[]}}}),
  event('event_msg',{type:'mcp_tool_call_end',invocation:{server:'picard',tool:'compute_get'},result:{Ok:{isError:true}}}),
  event('response_item',{type:'message',content:[{text:'private text'}]}),
  usage(39000,27000,500),usage(40000,30500,900),
  event('event_msg',{type:'task_complete',turn_id:turnId,completed_at:12345,last_agent_message:'private text'}),
  usage(50000,31500,1100)
 ];
 await writeFile(path,entries.map(row=>JSON.stringify(row)).join('\n'));
 assert.deepEqual(await readCompletedCodexUsage(path,turnId),{
  model:'test-model',effort:'low',recordedAt:12345000,
  inputTokens:8000,cachedInputTokens:5500,outputTokens:500,tools:['compute_ci_status']
 });
 assert.equal(await readCompletedCodexUsage(path,'absent'),null);
 const execPath=join(directory,'exec.jsonl');
 const execEvents=[
  {type:'thread.started',thread_id:'test-thread'},
  {type:'turn.started'},
  {type:'item.completed',item:{type:'mcp_tool_call',server:'picard',tool:'compute_list',status:'completed'}},
  {type:'item.completed',item:{type:'mcp_tool_call',server:'picard',tool:'compute_get',status:'failed'}},
  {type:'turn.completed',usage:{input_tokens:8000,cached_input_tokens:5500,output_tokens:500}}
 ];
 await writeFile(execPath,execEvents.map(row=>JSON.stringify(row)).join('\n'));
 const totals={inputTokens:8000,cachedInputTokens:5500,outputTokens:500};
 assert.deepEqual(await readCodexExecTools(execPath,'test-thread',totals,'picard'),['compute_list']);
 assert.equal(await readCodexExecTools(execPath,'wrong-thread',totals,'picard'),null);
 assert.equal(await readCodexExecTools(execPath,'test-thread',{...totals,outputTokens:499},'picard'),null);
 const threadId='11111111-1111-7111-8111-111111111111',first='22222222-2222-7222-8222-222222222222';
 await writeFile(path,[event('event_msg',{type:'task_complete',turn_id:first}),...entries].map(row=>JSON.stringify(row)).join('\n'));
 const followup=await readCompletedCodexUsage(path,turnId,{threadId});
 assert.deepEqual(followup,{...totals,model:'test-model',effort:'low',recordedAt:12345000,tools:['compute_ci_status'],
  followUpTo:createHash('sha256').update(threadId+'\n'+first).digest('hex')});
});

test('native writes require the dedicated token and only the console owner can read runs',async t=>{
 const store=createRelayStore({dbPath:':memory:'});
 const token='f'.repeat(64),session='z'.repeat(43);
 const server=createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
 const address='127.0.0.1:'+server.address().port,origin='https://'+address;
 const handler=createConsoleHandler({
  enabled:true,origins:[origin],auth:{authenticate:value=>value===session},getSnapshot:()=>({v:1}),
  codexUsage:store.openCodexUsage('owner'),codexUsageKey:createHash('sha256').update(token).digest()
 });
 server.on('request',async(req,res)=>{if(!await handler(req,res))res.writeHead(404).end();});
 const send=(path,options,body)=>new Promise((resolve,reject)=>{
  const req=request('http://'+address+path,options,res=>{
   const chunks=[];
   res.on('data',chunk=>chunks.push(chunk));
   res.on('error',reject);
   res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks))}));
  });
  req.on('error',reject);
  req.end(body);
 });
 const push=(authorization,extra,body=run)=>send('/codex/usage',{
  method:'POST',headers:{'content-type':'application/json',authorization,...extra}
 },JSON.stringify(body));
 assert.equal((await push('Bearer '+'0'.repeat(64))).status,401);
 assert.equal((await push('Bearer '+token,{origin})).status,403);
 assert.equal((await push('Bearer '+token)).status,201);
 assert.equal((await push('Bearer '+token)).status,200);
 const read=headers=>send('/status',{headers});
 assert.equal((await read({authorization:'Bearer '+token})).status,401);
 assert.equal((await read({})).status,401);
 const response=await read({cookie:'__Host-PicardSession='+session});
 assert.equal(response.status,200);
 assert.equal(response.data.codexUsage.runs[0].totalTokens,12000);
 assert.equal(response.data.codexUsage.rolling.sampleCount,0);
 const fix={...run,id:'c'.repeat(64),comparisonId:null,variant:null,recordedAt:3000,inputTokens:30,cachedInputTokens:15,outputTokens:10};
 const link={id:fix.id,followUpTo:assisted.id};
 assert.equal((await push('Bearer '+token,{},assisted)).status,201);
 assert.equal((await push('Bearer '+token,{},fix)).status,201);
 assert.equal((await push('Bearer '+'0'.repeat(64),{},link)).status,401);
 assert.equal((await push('Bearer '+token,{},link)).status,201);
 assert.equal((await push('Bearer '+token,{},link)).status,200);
 const updated=await read({cookie:'__Host-PicardSession='+session});
 assert.equal(updated.data.codexUsage.runs.find(row=>row.id===assisted.id).comparison.assisted.totalTokens,8040);
});
