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

const run={
 v:1,id:'a'.repeat(64),model:'test-model',effort:'low',recordedAt:1000,
 inputTokens:10000,cachedInputTokens:8000,outputTokens:2000,tools:[],comparisonId:'sample',variant:'baseline'
};
const assisted={...run,id:'b'.repeat(64),recordedAt:2000,inputTokens:7500,cachedInputTokens:5500,outputTokens:500,
 tools:['compute_ci_status'],variant:'assisted'};

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
