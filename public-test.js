import {SAMPLE_REQUEST} from './learning-guide.js';
export const PUBLIC_RELAY_ORIGIN='https://picard-relay.141-148-50-78.sslip.io';
const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id??'');
// Only result reads are polled. An uncertain/lost POST is never resubmitted.
export function createPublicTestClient({fetchImpl=globalThis.fetch,origin=PUBLIC_RELAY_ORIGIN,makeId=()=>crypto.randomUUID()}={}){
 let id=null,status=null;
 async function read(path,body){
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),10000);
  try{const r=await fetchImpl(origin+'/public-test/'+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:control.signal});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error??'unavailable'),{code:v.error});return v;}finally{clearTimeout(timer);}
 }
 return {
  get requestId(){return id;},restore(value){if(validId(value))id=value;},reset(){id=null;},
  async availability(){const v=await read('status');if(v?.v!==1||v.requestText!==SAMPLE_REQUEST||!/^([a-f0-9]{64})$/.test(v.inputSha256??'')||v.provider!=='Groq'||v.model!=='openai/gpt-oss-20b'||v.maxOutputTokens!==512||v.tools!==false||v.retries!==0||v.paidFallback!==false||!Number.isInteger(v.remaining)||v.remaining<0)throw Error('unexpected_public_policy');status=v;return v;},
  async submit(){if(id||!status?.ready)throw Error('review_required');id=makeId();if(!validId(id))throw Error('invalid_request_id');return read('requests',{requestId:id,inputSha256:status.inputSha256,approve:true});},
  result(){if(!validId(id))throw Error('no_saved_request');return read('results/'+id);}
 };
}
export function mountPublicTest(container,{client=createPublicTestClient(),storage=null}={}){
 const section=container.querySelector('#public-trial'),note=section.querySelector('[role="status"]'),answer=section.querySelector('pre'),start=section.querySelector('[data-live-start]'),check=section.querySelector('[data-live-check]'),reset=section.querySelector('[data-live-reset]');
 section.querySelector('blockquote').textContent=SAMPLE_REQUEST;
 const key='picard-public-trial-v1';try{storage??=globalThis.sessionStorage;client.restore(storage.getItem(key));}catch{}
 let pending=false,disposed=false,timer=null,reads=0;
 function remember(){try{if(client.requestId)storage.setItem(key,client.requestId);else storage.removeItem(key);}catch{}}
 function render(result){
  if(disposed)return;
  if(result?.resultAvailable===true&&result.state==='completed'&&typeof result.answer==='string'&&result.answer.length<=16000){answer.textContent=result.answer;answer.hidden=false;note.textContent='Saved answer · reopening makes no new call.';return;}
  if(['uncertain','failed','blocked','cancelled'].includes(result?.state)){note.textContent='This attempt stopped. It will not be retried. You can keep exploring the practice guide.';return;}
  if(['queued','claimed','invoking'].includes(result?.state)){
   note.textContent=result.state==='queued'?'Queued. Your result will stay here.':'Working. Your result will stay here.';
   if(!document.hidden&&reads<10)timer=setTimeout(()=>void recover(),3000);
  }else note.textContent='The result is not confirmed. Check the saved result; do not resend it.';
 }
 async function recover(){if(disposed||pending)return;clearTimeout(timer);pending=true;reads++;try{render(await client.result());}catch(e){note.textContent=e.code==='not_registered'?'No saved request was found. You can review a new test.':'Could not check the saved result. Check again later; the request will not be resent.';}finally{pending=false;}}
 start.addEventListener('click',async()=>{
  if(pending||client.requestId)return;pending=true;start.disabled=true;
  try{
   const status=await client.availability();if(disposed)return;
   if(start.dataset.ready!=='true'){
    note.textContent=status.ready?status.remaining+' shared tests remain. This sends the exact request above; the answer is public.':status.remaining===0?'Live tests are used up. The practice guide is still available.':status.busy?'The relay is busy. Try again later.':'The live trial is off. The practice guide is still available.';
    start.dataset.ready=String(status.ready);start.textContent=status.ready?'Run one Free test':'Check availability';return;
   }
   if(!status.ready){start.dataset.ready='false';start.textContent='Check availability';note.textContent='No live slot is available right now.';return;}
   const promise=client.submit();remember();check.hidden=false;reset.hidden=false;start.hidden=true;render(await promise);
  }catch{if(client.requestId){remember();check.hidden=false;reset.hidden=false;start.hidden=true;note.textContent='Could not confirm the request. Check the saved result; it will not be resent.';}else note.textContent='Live testing is unavailable. You can still use the practice guide.';}
  finally{pending=false;if(!disposed)start.disabled=false;}
 });
 check.addEventListener('click',()=>{reads=0;void recover();});
 reset.addEventListener('click',()=>{if(pending)return;clearTimeout(timer);client.reset();remember();answer.hidden=true;answer.textContent='';check.hidden=true;reset.hidden=true;start.hidden=false;start.dataset.ready='false';start.textContent='Check availability';note.textContent='Review the fixed request above before sending another test.';});
 if(client.requestId){start.hidden=true;check.hidden=false;reset.hidden=false;note.textContent='A previous test is saved in this tab. Check its result without sending it again.';}
 return ()=>{disposed=true;clearTimeout(timer);};
}
