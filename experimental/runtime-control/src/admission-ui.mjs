// Compose the owner workspace only when server-side admission is enabled.
// No external library, resource, credential, HTML interpolation of private data.
export function admissionConsoleHtml(base,{activationEnabled=false}={}){
 if(activationEnabled!==true)return base;
 const replace=(old,value)=>{if(base.split(old).length!==2)throw Error('admission_document_invalid');base=base.replace(old,value);};
 replace('<button id="nav-groq"','<button id="nav-requests" type="button" aria-controls="view-requests"><span class="nav-index" aria-hidden="true">03</span>Requests</button><button id="nav-groq"');
 replace('03</span>Groq','04</span>Groq');replace('04</span>System','05</span>System');
 replace('const views=[\'overview\',\'jobs\',\'groq\',\'system\'];',"const views=['overview','jobs','requests','groq','system'];");
 replace("if(focus)$('heading-'+view).focus?.();","if(focus)$('heading-'+view).focus?.();if(view==='requests'&&authenticated)void loadAdmissionCatalogue();");
 replace('function clearPrivate(){','function clearPrivate(){\n clearAdmission();');
 replace('This console cannot submit or approve a request.','Use Requests to approve one exact enrolled input.');
 replace('</style>',String.raw`
.admission-workspace{display:grid;grid-template-columns:minmax(190px,1fr) minmax(0,2fr);gap:32px;align-items:start}.admission-choice{padding:18px 0;border-bottom:1px solid var(--line,#35413f)}.admission-review{border-left:1px solid var(--line,#35413f);padding-left:28px;min-width:0}.admission-review pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,monospace;max-height:420px;overflow:auto}.admission-review label{display:block;margin:18px 0 8px}.admission-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:24px 0}.admission-result{margin-top:32px;border-top:1px solid var(--line,#35413f);padding-top:24px}.admission-result pre{max-height:600px}.admission-workspace select{width:100%;max-width:100%;min-height:44px}.admission-approve{min-height:44px}.admission-review p{overflow-wrap:anywhere}@media(max-width:720px){.admission-workspace{grid-template-columns:1fr;gap:20px}.admission-review{border-left:0;padding-left:0}.admission-review pre{max-height:320px}}
</style>`);
 replace('<section id="view-groq"',String.raw`<section id="view-requests" aria-labelledby="heading-requests" hidden>
<div class="view-head"><div><h1 id="heading-requests" tabindex="-1">Requests</h1><p>Review one enrolled input, approve it, then follow its saved result.</p></div><button id="admission-refresh" type="button">Refresh requests</button></div>
<p id="admission-notice" role="status" aria-live="polite">Not checked</p>
<div class="admission-workspace"><div class="admission-choice"><label for="admission-entry">Approved inputs</label><select id="admission-entry"><option value="">Choose an input</option></select><p class="muted">Groq only. Free-only enrollment, $0 budget, 512 output tokens, one call. No tools, retries or paid fallback.</p></div>
<div class="admission-review"><h2 id="admission-title">Choose an input to review</h2><pre id="admission-input"></pre><p id="admission-context" class="muted"></p><label for="admission-slot">Request slot</label><select id="admission-slot"><option value="">Choose a slot</option></select>
<div class="admission-actions"><button id="admission-approve" class="admission-approve" type="button" disabled>Approve and queue</button><button id="admission-check" type="button" disabled>Check saved result</button></div><p id="admission-state" role="status" aria-live="polite">No request selected.</p>
<div id="admission-result" class="admission-result" hidden><h2>Saved result</h2><pre id="admission-output"></pre><p class="muted">Text proposal only. Nothing here has been executed.</p></div></div></div></section>
<section id="view-groq"`);
 replace('motion();void boot();',ADMISSION_SCRIPT+'\nmotion();void boot();');
 return base;
}

export const ADMISSION_SCRIPT=String.raw`
let admissionData=null,admissionEntry=null,admissionSlot=null,admissionBusy=false,admissionGeneration=0,admissionPoll=null,admissionPollUntil=0,admissionRead=null,admissionReadVersion=0;
const admissionControllers=new Set();
const admissionStates=['available','queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain','unknown'];
function clearAdmission(){
 admissionGeneration++;cancelAdmissionRead();admissionPollUntil=0;for(const c of admissionControllers)c.abort();admissionControllers.clear();admissionData=null;admissionEntry=null;admissionSlot=null;admissionBusy=false;
 for(const id of ['admission-input','admission-context','admission-output','admission-state'])$(id).textContent='';$('admission-title').textContent='Choose an input to review';$('admission-notice').textContent='Not checked';$('admission-result').hidden=true;
 for(const id of ['admission-entry','admission-slot']){$(id).replaceChildren();$(id).value='';}for(const id of ['admission-approve','admission-check'])$(id).disabled=true;
}
function admissionMessage(text){if(authenticated)$('admission-notice').textContent=text;}
function admissionCanonical(value){return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])));}
async function admissionRequest(path,body,{controller=new AbortController()}={}){
 const generation=admissionGeneration;admissionControllers.add(controller);const timer=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:admissionCanonical(body)})});
  if(response.status===401||response.status===403){showAuth('login','Please sign in to view private requests.');throw Error('auth');}
  const value=await response.json();if(controller.signal.aborted||generation!==admissionGeneration||!authenticated)throw Error('aborted');if(!response.ok){const e=Error('request');e.status=response.status;throw e;}return value;
 }finally{clearTimeout(timer);admissionControllers.delete(controller);}
}
function admissionProject(data){
 if(!data||data.v!==1||!['enabled','synthetic-integration-only'].includes(data.mode)||typeof data.admissionReady!=='boolean'||!Array.isArray(data.entries)||data.entries.length>8||!/^[a-f0-9]{64}$/.test(data.catalogueSha256??''))throw Error('catalogue');
 const entries=[],ids=new Set(),refs=new Set();let total=0;
 for(const e of data.entries){if(!/^[a-z0-9-]{1,50}$/.test(e?.entryId??'')||ids.has(e.entryId)||typeof e.requestText!=='string'||!e.requestText||e.requestText.length>4000||!/^[a-f0-9]{64}$/.test(e.inputSha256??'')||!e.taskContext||['title','nextAction','latestFinding'].some(k=>typeof e.taskContext[k]!=='string')||!Array.isArray(e.slots))throw Error('catalogue');ids.add(e.entryId);
  const slots=[];for(const s of e.slots){if(++total>8||!/^[a-z0-9-]{1,50}$/.test(s?.slotId??'')||!/^[a-f0-9]{64}$/.test(s.ref??'')||refs.has(s.ref)||!admissionStates.includes(s.state))throw Error('catalogue');refs.add(s.ref);slots.push({slotId:s.slotId,ref:s.ref,state:s.state});}
  entries.push({entryId:e.entryId,requestText:e.requestText,inputSha256:e.inputSha256,taskContext:{title:e.taskContext.title,nextAction:e.taskContext.nextAction,latestFinding:e.taskContext.latestFinding},slots});
 }
 return {entries,admissionReady:data.admissionReady,mode:data.mode,legacyReviewRequired:data.blockingCode==='legacy_review_required'};
}
function admissionOption(value,text){const node=document.createElement('option');node.value=value;node.textContent=text;return node;}
function admissionButtons(){const available=authenticated&&!admissionBusy&&!admissionRead&&admissionData?.admissionReady===true&&admissionSlot?.state==='available'&&admissionSlot.statusKnown!==false;$('admission-approve').disabled=!available;$('admission-check').disabled=!authenticated||admissionBusy||!!admissionRead||!admissionSlot;for(const id of ['admission-entry','admission-slot','admission-refresh'])$(id).disabled=admissionBusy;}
function cancelAdmissionRead(){admissionReadVersion++;if(admissionRead)admissionRead.controller.abort();admissionRead=null;clearTimeout(admissionPoll);admissionPoll=null;}
function selectAdmissionSlot(){
 cancelAdmissionRead();admissionSlot=admissionEntry?.slots.find(s=>s.slotId===$('admission-slot').value)??null;$('admission-result').hidden=true;$('admission-output').textContent='';$('admission-state').textContent=admissionSlot?(admissionSlot.statusKnown===false?'Current status unknown. Last observed: '+admissionSlot.state+'.':'State: '+admissionSlot.state):'No request selected.';admissionButtons();
}
function selectAdmissionEntry(){
 admissionEntry=admissionData?.entries.find(e=>e.entryId===$('admission-entry').value)??null;$('admission-title').textContent=admissionEntry?.taskContext.title??'Choose an input to review';$('admission-input').textContent=admissionEntry?.requestText??'';$('admission-context').textContent=admissionEntry?[admissionEntry.taskContext.nextAction,admissionEntry.taskContext.latestFinding].filter(Boolean).join('\n'):'';
 $('admission-slot').replaceChildren(...(admissionEntry?.slots??[]).map(s=>admissionOption(s.slotId,s.slotId+' — '+s.state)));$('admission-slot').value=admissionEntry?.slots[0]?.slotId??'';selectAdmissionSlot();
}
async function loadAdmissionCatalogue(){
 if(!authenticated||admissionBusy)return;cancelAdmissionRead();admissionBusy=true;admissionButtons();const generation=admissionGeneration;
  try{const data=admissionProject(await admissionRequest('/request-catalogue'));if(generation!==admissionGeneration)return;admissionData=data;$('admission-entry').replaceChildren(...data.entries.map(e=>admissionOption(e.entryId,e.taskContext.title)));$('admission-entry').value=data.entries[0]?.entryId??'';selectAdmissionEntry();admissionMessage(data.legacyReviewRequired?'Historical job evidence needs review before new work. Saved results can still be checked.':!data.entries.length?'No approved requests are enrolled.':data.admissionReady?'Review the exact input before approving one call.':'New requests are unavailable. Saved results can still be checked.');}
 catch{if(generation===admissionGeneration)admissionMessage(admissionData?'Requests could not be checked. Showing the previous observation; current availability is unknown.':'Requests could not be checked.');if(admissionData)admissionData.admissionReady=false;}
 finally{if(generation===admissionGeneration){admissionBusy=false;admissionButtons();}}
}
function readAdmissionResult({poll=false}={}){
 if(!authenticated||!admissionSlot)return Promise.resolve();if(admissionRead)return admissionRead.promise;
 clearTimeout(admissionPoll);admissionPoll=null;const generation=admissionGeneration,slot=admissionSlot,ref=slot.ref,version=++admissionReadVersion,controller=new AbortController();
 const current=()=>generation===admissionGeneration&&version===admissionReadVersion&&slot===admissionSlot;
 const read={controller,promise:null};admissionRead=read;admissionButtons();
 read.promise=(async()=>{try{const value=await admissionRequest('/requests/'+ref,undefined,{controller});if(!current())return;if(value?.v!==1||value.ref!==ref||!admissionStates.includes(value.state)||typeof value.resultAvailable!=='boolean')throw Error('result');
   if(value.state==='completed'&&value.resultAvailable&&(typeof value.result?.body!=='string'||value.result.body.length>4000||!['information','question'].includes(value.result.kind)))throw Error('result');
   if(['completed','failed','blocked','cancelled','uncertain'].includes(slot.state)&&value.state!==slot.state)throw Error('state_regression');
   slot.state=value.state;slot.statusKnown=true;$('admission-state').textContent=value.state==='uncertain'?'Uncertain. This request is spent. Do not retry it.':value.state==='failed'&&value.reasonCode==='output_incomplete'?'Output incomplete. This request is spent. Do not retry it.':'State: '+value.state;
   if(value.state==='completed'&&value.resultAvailable){$('admission-output').textContent=value.result.body;$('admission-result').hidden=false;}
   admissionMessage(value.state==='completed'?'Saved result ready.':'Saved status checked. No request was resubmitted.');
   if(poll&&['queued','claimed','invoking'].includes(value.state)&&Date.now()<admissionPollUntil&&document.visibilityState!=='hidden')admissionPoll=setTimeout(()=>{if(current()&&authenticated&&Date.now()<admissionPollUntil)void readAdmissionResult({poll:true});},2000);
  }catch{if(current()){slot.statusKnown=false;$('admission-state').textContent='Current status unknown. Last observed: '+slot.state+'.';admissionMessage('Saved status could not be checked. Current status is unknown; showing the last observation. No request will be resubmitted.');}}
  finally{if(current()&&admissionRead===read){admissionRead=null;admissionButtons();}}
 })();return read.promise;
}
async function approveAdmission(){
 if($('admission-approve').disabled||!admissionEntry||!admissionSlot)return;admissionBusy=true;admissionButtons();const generation=admissionGeneration,entry=admissionEntry,slot=admissionSlot;
 try{const proof=await admissionRequest('/request-approvals',{entryId:entry.entryId,slotId:slot.slotId});
  if(proof.existing===true){slot.state=proof.state;await readAdmissionResult();return;}
  if(proof.entryId!==entry.entryId||proof.slotId!==slot.slotId||proof.approvedInputSha256!==entry.inputSha256||!/^[A-Za-z0-9_-]{43}$/.test(proof.nonce??''))throw Error('approval');
  const receipt=await admissionRequest('/requests',{entryId:entry.entryId,slotId:slot.slotId,nonce:proof.nonce,approvedInputSha256:entry.inputSha256,approve:true});if(generation!==admissionGeneration)return;
  if(receipt.ref!==slot.ref||!admissionStates.includes(receipt.state))throw Error('receipt');slot.state=receipt.state;$('admission-state').textContent='State: '+receipt.state;admissionMessage('Registered once. Following this request; it will not be resubmitted.');admissionPollUntil=Date.now()+60000;await readAdmissionResult({poll:true});
 }catch{if(generation===admissionGeneration){slot.state='unknown';admissionMessage('Submission was not confirmed. Check this slot’s saved status. No retry or replacement was sent.');}}
 finally{if(generation===admissionGeneration){admissionBusy=false;admissionButtons();}}
}
$('admission-entry').addEventListener('change',selectAdmissionEntry);$('admission-slot').addEventListener('change',selectAdmissionSlot);$('admission-refresh').addEventListener('click',loadAdmissionCatalogue);$('admission-approve').addEventListener('click',approveAdmission);$('admission-check').addEventListener('click',()=>{if(!$('admission-check').disabled)return readAdmissionResult();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(admissionPoll);admissionPoll=null;}});
`;
