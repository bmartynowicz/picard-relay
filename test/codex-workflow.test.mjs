import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareWorkflow,WORKFLOW_DEFAULTS,focusedResult} from '../tools/codex-workflow.mjs';
import {readCompletedCodexUsage} from '../tools/codex-usage-notify.mjs';
const hash=t=>createHash('sha256').update(t).digest('hex');
const body='[doc] Measured fact.\n[doc] Historical notice; verify fresh dates.\nUnrelated detail.';
const saved={state:'completed',resultAvailable:true,ref:'a'.repeat(64),result:{kind:'information',body,sha256:hash(body)}};
const task={brief:'Produce the plan.',acceptanceCriteria:'Keep limits and dates.',outputStructure:'Three short sections; at most 300 words.',sourceContext:'A large original source with its limits. '.repeat(200),savedResult:saved,
 requiredEvidence:[{sourceId:'doc',url:'https://example.com/doc',quote:'A large original source with its limits.'}]};
test('defaults keep the model explicit and do not retry',()=>assert.deepEqual(WORKFLOW_DEFAULTS,{model:'gpt-6.1-sol',effort:'low',serviceTier:'default',automaticRetries:0}));
test('matched prompts preserve criteria and structure, and exact UTF8 proof',()=>{
 const p=prepareWorkflow(task);assert.equal(p.assisted.mode,'preloaded');
 for(const side of ['baseline','assisted']){assert(p[side].prompt.includes(task.acceptanceCriteria));assert(p[side].prompt.includes(task.outputStructure));}
 assert.equal(p.proof.promptSha256,hash(Buffer.from(p.assisted.prompt,'utf8')));
 assert.equal(p.proof.receipts[0].sha256,saved.result.sha256);
});
test('focused evidence keeps original receipt and cannot insert an invented fact',()=>{
 const selection=[{sourceId:'doc',url:'https://example.com/doc',lines:['[doc] Measured fact.','[doc] Historical notice; verify fresh dates.']}];
 const before=JSON.stringify(saved),p=prepareWorkflow({...task,selection});
 assert(p.assisted.prompt.includes('Historical notice'));assert(!p.assisted.prompt.includes('Unrelated detail'));
 assert.equal(p.proof.receipts[0].sha256,saved.result.sha256);assert.equal(JSON.stringify(saved),before);
 assert.throws(()=>focusedResult(saved,[{...selection[0],lines:['Invented claim']}]),/exact saved lines/);
 assert.throws(()=>focusedResult({...saved,result:{...saved.result,sha256:'b'.repeat(64)}},selection),/verified/);
});
test('missing, rejected and insufficient reductions remain direct without assisted proof',()=>{
 for(const replacement of [null,{...saved,state:'failed'},{...saved,review:{latest:{decision:'changes_requested'}}}]){
  const p=prepareWorkflow({...task,savedResult:replacement});assert.equal(p.assisted.mode,'direct');assert.equal(p.proof,null);
 }
 assert.equal(prepareWorkflow({...task,sourceContext:'short',requiredEvidence:[{sourceId:'doc',url:'https://example.com/doc',quote:'short'}]}).assisted.mode,'direct');
 assert.throws(()=>prepareWorkflow({...task,outputStructure:''}),/outputStructure/);
});
test('reference preparation requires reviewed facts and retains them even when the summary omits them',()=>{
 const quote='Visibility changes pause decorative work; runtime coverage unverified.';
 const sourceContext=JSON.stringify({source:quote,other:'Long source. '.repeat(400)});
 const requiredEvidence=[{sourceId:'visibility',url:'https://example.com/script.js',quote}];
 const p=prepareWorkflow({...task,sourceContext,requiredEvidence});
 for(const side of ['baseline','assisted'])assert(p[side].prompt.includes(quote));
 assert.throws(()=>prepareWorkflow({...task,requiredEvidence:[]}),/required source facts/);
 assert.throws(()=>prepareWorkflow({...task,requiredEvidence:[{...requiredEvidence[0],quote:'Invented claim'}]}),/exact source passages/);
});
test('preloaded usage requires the exact native prompt and keeps earlier-turn correction identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'picard-focused-proof-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'trace.jsonl'),text='Task\nExact evidence é',turn='second',threadId='11111111-1111-7111-8111-111111111111',first='22222222-2222-7222-8222-222222222222';
 const events=[{type:'event_msg',payload:{type:'task_complete',turn_id:first}},
  {type:'event_msg',payload:{type:'task_started',turn_id:turn}},
  {type:'turn_context',payload:{turn_id:turn,model:'gpt-6.1-sol',effort:'low'}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}},
  {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:40,output_tokens:10}}}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:turn,completed_at:123}}];
 await writeFile(path,events.map(e=>JSON.stringify(e)).join('\n'));
 const usage=await readCompletedCodexUsage(path,turn,{threadId,preparedPromptSha256:hash(text)});
 assert.deepEqual(usage.tools,['prepare_context']);assert.equal(usage.inputTokens,100);
 assert.equal(usage.followUpTo,hash(threadId+'\n'+first));
 assert.equal(await readCompletedCodexUsage(path,turn,{preparedPromptSha256:hash(text.replaceAll('\n','\r\n'))}),null);
 assert.equal(await readCompletedCodexUsage(path,turn,{preparedPromptSha256:hash('unrelated')}),null);
});
test('CLI preparation freezes runnable defaults and UTF8 proof, and refuses overwrite',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'picard-workflow-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=join(dir,'task.json'),out=join(dir,'run');
 await writeFile(input,JSON.stringify({...task,brief:'Write a plan é.\nKeep dates.',comparison:'example-pair'}));
 const script=fileURLToPath(new URL('../tools/codex-workflow.mjs',import.meta.url));
 await promisify(execFile)(process.execPath,[script,'--task',input,'--out',out]);
 const metadata=JSON.parse(await readFile(join(out,'prepared.json'),'utf8'));
 const proof=JSON.parse(await readFile(join(out,'proof.json'),'utf8'));
 assert.equal(metadata.model,WORKFLOW_DEFAULTS.model);assert.equal(metadata.effort,'low');assert.equal(metadata.comparison,'example-pair');
 const bytes=await readFile(join(out,'assisted-prompt.txt'));assert.equal(hash(bytes),proof.promptSha256);
 assert(!bytes.includes(13));
 await assert.rejects(promisify(execFile)(process.execPath,[script,'--task',input,'--out',out]));
 assert.equal(hash(await readFile(join(out,'assisted-prompt.txt'))),proof.promptSha256);
});
