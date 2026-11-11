import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {preparePair,executePair,parseReview,comparisonScopes,reviewPrompt} from '../tools/codex-workflow-pair.mjs';
const id=s=>createHash('sha256').update(s).digest('hex'),body='[source] A fact with a material exception.';
const task={comparison:'paired-example',brief:'Write the brief.',acceptanceCriteria:'Keep the exception and unknowns.',outputStructure:'At most 200 words.',sourceContext:'A fact with a material exception. '.repeat(300),
 requiredEvidence:[{sourceId:'source',url:'https://example.com/source',quote:'A fact with a material exception.'}],
 savedResult:{ref:id('provider'),state:'completed',resultAvailable:true,result:{body,sha256:id(body),kind:'information'}},
 workflow:{v:1,preparationIds:{baseline:[id('shared')],assisted:[id('shared')]},picardRefs:[id('provider')]}};
const measurement=label=>({runId:id(label),fixedHash:id('fixed-context'),model:'gpt-6.1-sol',effort:'low'});
async function fixture(t){
 const parent=await mkdtemp(join(tmpdir(),'picard-pair-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const input=join(parent,'pair');await preparePair(task,input);return input;
}
function nativeFixture(input,calls,{failAssistedReview=false}={}){
 return async({variant,preparation,deliverOnly})=>{
  const label=preparation?'preparation-'+preparation:variant;calls.push({label,deliverOnly});
  if(deliverOnly)return;
  await writeFile(join(input,label+'-events.jsonl'),'native fixture evidence\n',{flag:'wx'});
  await writeFile(join(input,label+'-measurement.json'),JSON.stringify(measurement(label)),{flag:'wx'});
  const fail=preparation&&variant==='assisted'&&failAssistedReview;
  await writeFile(join(input,label+'-answer.txt'),preparation?JSON.stringify(fail?{passed:false,issues:[{problem:'Material exception omitted.',requiredFix:'Preserve the source exception.'}]}:{passed:true,issues:[]}):'A fact with a material exception.',{flag:'wx'});
 };
}
test('paid reviews on both sides join full coverage even when a review fails; resume never repeats model work',async t=>{
 const input=await fixture(t),calls=[],delivered=[];
 const options={input,runNative:nativeFixture(input,calls,{failAssistedReview:true}),deliverScope:async p=>delivered.push(JSON.parse(await readFile(p,'utf8')))};
 const first=await executePair(options);
 assert.equal(first.state,'needs_correction');assert.equal(first.automaticRetries,0);assert.equal(calls.length,4);
 assert(calls.every(c=>!c.deliverOnly));assert.equal(delivered.length,2);
 for(const scope of delivered){assert.deepEqual(scope.preparationIds,[id('shared'),id('preparation-review-'+scope.variant)]);assert.deepEqual(scope.picardRefs,scope.variant==='assisted'?[id('provider')]:[]);}
 assert.equal(await executePair(options).then(r=>r.state),'needs_correction');
 assert(calls.slice(4).every(c=>c.deliverOnly));assert.equal(calls.filter(c=>!c.deliverOnly).length,4);
});
test('changed frozen inputs and uncertain attempts stop before another paid stage',async t=>{
 const input=await fixture(t),calls=[];
 await writeFile(join(input,'baseline-events.jsonl'),'uncertain native attempt\n');
 await assert.rejects(executePair({input,runNative:nativeFixture(input,calls),deliverScope:()=>{}}),/uncertain_attempt_no_retry/);assert.equal(calls.length,0);
 await writeFile(join(input,'baseline-prompt.txt'),'changed');
 await assert.rejects(executePair({input,runNative:nativeFixture(input,calls),deliverScope:()=>{}}),/frozen_pair_input_changed/);assert.equal(calls.length,0);
});
test('reviews must report concrete failures and cannot pass malformed or contradictory JSON',()=>{
 for(const value of ['not JSON','{"passed":true,"issues":[{"problem":"x","requiredFix":"y"}]}','{"passed":false,"issues":[]}',JSON.stringify({passed:true,issues:[],extra:'unknown'})])assert.equal(parseReview(value).passed,false);
 assert.deepEqual(parseReview('{"passed":true,"issues":[]}'),{passed:true,issues:[]});
 assert.match(reviewPrompt(task,'answer'),/factual meaning/);assert.match(reviewPrompt(task,'answer'),/No tools or external actions/);
});
test('coverage rejects duplicate charging, missing review IDs and unmatched contexts',()=>{
 const roots={baseline:measurement('baseline'),assisted:measurement('assisted')},reviews={baseline:measurement('review-b'),assisted:measurement('review-a')};
 assert.throws(()=>comparisonScopes(task,roots,{...reviews,baseline:{...reviews.baseline,runId:'invalid'}}),/invalid_workflow_coverage/);
 assert.throws(()=>comparisonScopes(task,roots,{...reviews,assisted:{...reviews.assisted,effort:'xhigh'}}),/unmatched_review_defaults/);
 assert.throws(()=>comparisonScopes({...task,workflow:{...task.workflow,preparationIds:{...task.workflow.preparationIds,baseline:[id('review-b')]}}},roots,reviews),/invalid_workflow_coverage/);
 assert.throws(()=>comparisonScopes(task,{...roots,assisted:{...roots.assisted,fixedHash:id('different')}},reviews),/unmatched_native_context/);
});
