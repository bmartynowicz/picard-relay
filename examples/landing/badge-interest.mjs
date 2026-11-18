export const BADGE_MARKUP="<div class=\"badge-offer\"><figure class=\"badge-prize\" aria-label=\"Rotating Picard desk badge concept\"><div class=\"badge-body\" aria-hidden=\"true\"><span class=\"badge-shell\"></span><span class=\"badge-shell\"></span><span class=\"badge-shell\"></span><div class=\"badge-face\"><small>PICARD RELAY</small><img src=\"./mark.svg\" alt=\"\"><small>MAKE IT SO.</small></div><div class=\"badge-back\">PICARD</div></div></figure><div><p>A little Picard for your desk.</p><p class=\"landing-muted\">A physical badge, still a prototype.</p><p class=\"badge-count\" data-badge-count>Checking interest…</p><div class=\"guide-actions\"><button type=\"button\" class=\"request-primary\" data-badge-vote disabled>I’d want one</button><button type=\"button\" data-badge-check hidden>Check my vote</button></div></div></div><p class=\"badge-note\" role=\"status\" aria-live=\"polite\"></p><details class=\"badge-privacy\"><summary>About this vote</summary><p>No signup, contact details or payment. This is interest, not a preorder or a promise of availability. A random browser token helps avoid duplicate votes; the relay stores its hash, not your name or IP address. Clearing storage or using another browser can count again, so this is not a verified count of people.</p></details>";
const origin='https://picard-relay.141-148-50-78.sslip.io',key='picard-badge-interest-v1';
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export function createBadgeInterestClient({fetchImpl=globalThis.fetch,storage=globalThis.localStorage,makeId=()=>crypto.randomUUID(),relayOrigin=origin,locks=globalThis.navigator?.locks}={}){
 let id=null;try{const saved=storage.getItem(key);if(validId(saved))id=saved;}catch{}
 async function read(path,body){
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),8000);
  try{
   const r=await fetchImpl(relayOrigin+'/public/badge-interest'+path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:control.signal});
   const v=await r.json();if(!r.ok)throw Error(v.error??'unavailable');
   if(v.v!==1||!Number.isInteger(v.count)||v.count<0||v.count>4096||typeof v.accepting!=='boolean'||typeof v.voted!=='boolean')throw Error('unexpected_badge_status');
   return {count:v.count,accepting:v.accepting,voted:v.voted};
  }finally{clearTimeout(timer);}
 }
 return {
  status:()=>read(id?'/status':'',id?{voteId:id}:undefined),
  async vote(){
   const remember=()=>{try{const saved=storage.getItem(key);if(validId(saved))id=saved;
    if(!id){const fresh=makeId();if(!validId(fresh))throw Error();id=fresh;}
    storage.setItem(key,id);if(storage.getItem(key)!==id)throw Error();
   }catch{throw Error('storage_required');}};
   if(locks?.request)await locks.request(key,remember);else remember();
   return read('',{voteId:id});
  }
 };
}
export function mountBadgeInterest(container,{client=null}={}){
 container.innerHTML=BADGE_MARKUP;
 if(!document.getElementById('badge-interest-style')){const css=document.createElement('link');css.id='badge-interest-style';css.rel='stylesheet';css.href=new URL('./badge-interest.css',import.meta.url);document.head.append(css);}
 const button=container.querySelector('[data-badge-vote]'),check=container.querySelector('[data-badge-check]'),count=container.querySelector('[data-badge-count]'),note=container.querySelector('[role=status]');
 let disposed=false,pending=false;
 try{client??=createBadgeInterestClient();}catch{note.textContent='Voting is unavailable in this browser.';button.disabled=true;return ()=>{};}
 function render(v){count.textContent=v.count.toLocaleString()+' interest '+(v.count===1?'vote':'votes');button.disabled=v.voted||!v.accepting;button.textContent=v.voted?'Interest saved ✓':"I’d want one";check.hidden=true;note.textContent=v.voted?'Thanks. Your interest is saved.':v.accepting?'': 'Voting is paused.';}
 async function act(vote){
  if(pending||disposed)return;pending=true;button.disabled=true;check.disabled=true;
  try{const v=await(vote?client.vote():client.status());if(!disposed)render(v);}
  catch(e){if(!disposed){note.textContent=e.message==='storage_required'?'Enable browser storage to save one vote.':'Could not confirm. Check your vote before trying again.';check.hidden=false;button.disabled=true;}}
  finally{pending=false;if(!disposed)check.disabled=false;}
 }
 button.addEventListener('click',()=>void act(true));check.addEventListener('click',()=>void act(false));void act(false);
 return ()=>{disposed=true;};
}
