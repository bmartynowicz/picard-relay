import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {workspaceFixture} from '../../../test/fixtures/workspace-fixture.mjs';
import {CONSOLE_HTML} from '../src/oracle-service.mjs';
import {admissionConsoleHtml} from '../src/admission-ui.mjs';
const html=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true}),script=html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const flush=()=>new Promise(r=>setImmediate(r));
async function harness(t){
 const f=await workspaceFixture({realMarkers:false});t.after(()=>f.close());const created=[],downloads=[],urls=new Map(),listeners={},windowListeners={},mediaListeners={},timers=new Map();let timerId=0,signedIn=true,failReads=false,holdRead=null;
 const element=(tag='div')=>{const n={tag,children:[],attrs:{},dataset:{},listeners:{},value:'',hidden:true,disabled:false,_text:'',get textContent(){return this._text+this.children.map(x=>x.textContent).join('');},set textContent(v){this._text=String(v);this.children=[];},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=String(v);},addEventListener(k,fn){this.listeners[k]=fn;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this._text='';this.children=nodes;},focus(){},remove(){},click(){if(this.tag==='a')downloads.push({name:this.download,url:this.href});else return this.listeners.click?.();},animate(){return {cancel(){}};}};created.push(n);return n;};
 const els=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,element()]));
 els.get('request-purpose').value='sanitized-source-proposal';els.get('request-template').value='custom';els.get('jobs-filter').value='all';
 const document={visibilityState:'visible',body:element('body'),getElementById:id=>{assert(els.has(id),'missing '+id);return els.get(id);},createElement:element,addEventListener:(k,fn)=>{(listeners[k]??=[]).push(fn);}};
 const pref={matches:false,addEventListener:(k,fn)=>mediaListeners[k]=fn},location={hash:'#requests'},window={location,history:{pushState(_s,_t,h){location.hash=h;},replaceState(_s,_t,h){location.hash=h;}},matchMedia:()=>pref,addEventListener:(k,fn)=>windowListeners[k]=fn};
 const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const calls=[];
 const fetch=async(url,options)=>{
  calls.push({url,method:options.method});assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  if(url==='/auth/state')return response(200,{enrolled:true});
  if(url==='/auth/logout'){signedIn=false;return response(200,{ok:true});}
  if(!signedIn)return response(401,{error:'auth_failed'});
  if(url==='/status')return response(200,{v:1,observedAt:new Date().toISOString(),service:{ready:true,providerReady:true,resultRecoveryReady:true,acceptingNewWork:true,draining:false},jobs:{queued:0,claimed:0,invoking:0,completed:0,failed:0,blocked:0,cancelled:0,uncertain:0},release:{hash:'a'.repeat(64),version:null},updater:{state:'unknown'}});
  if(url.startsWith('/workspace/requests/')&&holdRead)await holdRead;
  if(options.signal?.aborted)throw Error('aborted');
  if(failReads&&options.method==='GET'&&url.startsWith('/workspace/requests/'))throw Error('synthetic_read_failure');
  const r=await f.request(url,{method:options.method,body:options.body===undefined?undefined:JSON.parse(options.body)});return response(r.status,r.body);
 };
 const context=vm.createContext({document,window,TextEncoder,AbortController,Date,queueMicrotask,crypto:{randomUUID},Blob,URL:{createObjectURL:b=>{const id='blob:'+randomUUID();urls.set(id,b);return id;},revokeObjectURL:id=>urls.delete(id)},navigator:{clipboard:{writeText:async text=>{context.copied=text;}}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),fetch});
 vm.runInContext(script.replace('motion();void boot();','globalThis.workspaceTest={get draft(){return workDraft;},get result(){return workResult;},get ref(){return workRef;},get poll(){return workTimer;},loadWorkspace,readWorkspaceRequest,newWorkspaceRequest};motion();void boot();'),context);
 for(let i=0;i<12;i++)await flush();
 return {f,context,els,created,downloads,urls,calls,pref,document,listeners,mediaListeners,windowListeners,get:id=>els.get(id),click:async id=>await els.get(id).listeners.click(),submit:async()=>await els.get('request-form').listeners.submit({preventDefault(){}}),async brief(){els.get('request-title').value='Browser fixture task';els.get('request-text').value='Propose a useful status helper.';await this.submit();},setFailReads:v=>failReads=v,setHoldRead:p=>holdRead=p};
}
test('v1 UI: ordinary brief, approval, result formatting, exact downloads and local review',async t=>{
 const h=await harness(t);assert.doesNotMatch(script,/innerHTML|localStorage|sessionStorage|document\.cookie/);await h.brief();assert(h.context.workspaceTest.draft);assert.equal(h.f.calls,0);assert.equal(h.get('request-approve').disabled,false);
 await h.click('request-approve');assert.equal(h.get('request-approve').hidden,true);await h.f.dispatcher.runOnce();await h.click('request-check');assert.equal(h.get('request-original').textContent,h.f.output);assert.equal(h.get('request-result').hidden,false);assert.equal(h.get('request-state').textContent,'Completed · awaiting your review');assert.equal(h.created.some(n=>n.tag==='unsafe-tag'),false);
 await h.click('request-copy');assert.equal(h.context.copied,h.f.output);await h.click('request-download');await h.click('request-handoff');const code=h.created.filter(n=>n.tag==='button'&&n.textContent==='Download code');assert.equal(code.length,1);await code[0].click();
 assert.equal(h.downloads.length,3);const answer=h.downloads.find(d=>d.name.endsWith('.md')),handoff=h.downloads.find(d=>d.name.endsWith('.json')),source=h.downloads.find(d=>d.name.endsWith('.js'));
 assert.equal(await h.urls.get(answer.url).text(),h.f.output);const exported=JSON.parse(await h.urls.get(handoff.url).text());assert.equal(exported.result.body,h.f.output);assert.equal(exported.provenance.maxOutputTokens,4096);assert.match(await h.urls.get(source.url).text(),/export function statusLabel/);
 h.get('request-review-note').value='Please check the boundary.';await h.click('request-changes');assert.match(h.get('request-review-summary').textContent,/Changes requested/);assert.equal(h.context.workspaceTest.result.review.revision,1);assert.equal(h.get('request-review-note').value,'');assert.equal(h.f.calls,1);
});
test('failed status read disables review and preserves the original saved answer',async t=>{
 const h=await harness(t);await h.brief();await h.click('request-approve');await h.f.dispatcher.runOnce();await h.click('request-check');const text=h.get('request-original').textContent;h.setFailReads(true);await h.click('request-check');assert.equal(h.get('request-original').textContent,text);assert.equal(h.get('request-accept').disabled,true);assert.match(h.get('request-notice').textContent,/status is unknown/);assert.equal(h.f.calls,1);
});
test('sign-out clears private forms, results, reviews and generated download URLs',async t=>{
 const h=await harness(t);await h.brief();await h.click('request-approve');await h.f.dispatcher.runOnce();await h.click('request-check');assert.equal(h.get('request-original').textContent,h.f.output);await h.click('request-download');assert.equal(h.urls.size,1);h.get('request-review-note').value='PRIVATE_REVIEW_SENTINEL';await h.click('logout');
 for(const id of ['request-title','request-text','request-context','request-task','request-review-note'])assert.equal(h.get(id).value,'');for(const id of ['request-original','request-exact-text','request-sheet-title'])assert.equal(h.get(id).textContent,'');assert.equal(h.get('request-output').children.length,0);assert.equal(h.urls.size,0);assert.equal(h.context.workspaceTest.result,null);
});
test('pause/reduced motion apply to the workspace reveal and hidden tabs stop workspace polling',async t=>{
 const h=await harness(t);await h.brief();await h.click('motion');assert.equal(h.get('request-sheet').dataset.motion,'off');h.pref.matches=true;h.mediaListeners.change();assert.equal(h.get('motion').disabled,true);assert.notEqual(h.context.workspaceTest.poll,null);h.document.visibilityState='hidden';for(const fn of h.listeners.visibilitychange)fn();assert.equal(h.context.workspaceTest.poll,null);assert.equal(h.f.calls,0);
});
test('late status response cannot replace a newly opened empty composer',async t=>{
 const h=await harness(t);await h.brief();let release;h.setHoldRead(new Promise(r=>release=r));const pending=h.click('request-check');await flush();await h.click('request-new');release();await pending;
 assert.equal(h.context.workspaceTest.ref,null);assert.equal(h.get('request-sheet').hidden,true);assert.equal(h.get('request-compose').hidden,false);assert.equal(h.get('request-text').value,'');assert.equal(h.f.calls,0);
});
test('material future observation keeps saved text readable but disables review',async t=>{
 const h=await harness(t);await h.brief();await h.click('request-approve');await h.f.dispatcher.runOnce();await h.click('request-check');assert.equal(h.get('request-accept').disabled,false);h.f.advance(120000);await h.click('request-check');assert.equal(h.get('request-original').textContent,h.f.output);assert.equal(h.get('request-accept').disabled,true);assert.match(h.get('request-notice').textContent,/stale or ahead/);
});
test('uncertain submission response offers status recovery without automatic replacement',async t=>{
 const h=await harness(t);await h.brief();const original=h.context.workspaceTest.draft;h.f.loseResponse();await h.click('request-approve');assert.equal(h.get('request-approve').disabled,true);assert.match(h.get('request-notice').textContent,/Submission was not confirmed/);h.f.loseResponse(false);await h.click('request-check');assert.equal(h.context.workspaceTest.ref,original.payload.eventId);assert.equal(h.context.workspaceTest.result.state,'queued');assert.equal(h.f.calls,0);await h.f.dispatcher.runOnce();assert.equal(h.f.calls,1);
});
