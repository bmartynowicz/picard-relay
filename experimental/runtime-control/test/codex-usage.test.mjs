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
 const push=(authorization,extra)=>send('/codex/usage',{
  method:'POST',headers:{'content-type':'application/json',authorization,...extra}
 },JSON.stringify(run));
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
});
