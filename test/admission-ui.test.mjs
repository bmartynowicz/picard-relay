import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CONSOLE_HTML} from '../experimental/runtime-control/src/oracle-service.mjs';
import {admissionConsoleHtml,REVIEWED_REGRESSION_RESULT} from '../experimental/runtime-control/src/admission-ui.mjs';
const html=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true}),script=html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const state={v:1,observedAt:new Date().toISOString(),service:{ready:true,providerReady:true,resultRecoveryReady:true,acceptingNewWork:true,draining:false},jobs:{queued:0,invoking:0,completed:0,uncertain:0},release:{version:null,hash:null},updater:{state:'unknown'}};
const ref='a'.repeat(64),inputSha256='b'.repeat(64),privateText='SYNTHETIC_PRIVATE_INPUT <script>never_execute()</script>';
function harness({cataloguePatch={},savedBody='SYNTHETIC_SAVED_RESULT <img src=x>',initialHash='',jobs=[],requestRef=ref,inputHash=inputSha256}={}){
 const ref=requestRef,inputSha256=inputHash;
 let authenticated=true,lost=null,unavailable=false,job='available',hold=null,empty=false,legacyReview=false;
 const timers=new Map(),requests=[],events={document:{},window:{}},els=new Map(),heldReads=[];let seq=0;
 function element(tagName=''){return {tagName,textContent:'',children:[],value:'',hidden:true,disabled:false,dataset:{},attrs:{},listeners:{},className:'',classList:{items:new Set(),toggle(k,v){v?this.items.add(k):this.items.delete(k);}},setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;this.textContent='';},addEventListener(k,v){this.listeners[k]=v;},focus(){},animate(){return {cancel(){}}}};}
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))els.set(id,element());
 const add=(kind,name,fn)=>{(events[kind][name]??=[]).push(fn);};
 const document={visibilityState:'visible',getElementById:id=>{assert.ok(els.has(id),id);return els.get(id);},createElement:element,addEventListener:(n,fn)=>add('document',n,fn)};
 const location={hash:initialHash},history=[initialHash];let historyIndex=0;
 const window={location,history:{pushState(_a,_b,hash){history.splice(historyIndex+1);history.push(hash);historyIndex++;location.hash=hash;},replaceState(_a,_b,hash){history[historyIndex]=hash;location.hash=hash;}},matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener:(n,fn)=>add('window',n,fn)};
 const json=(data,status=200)=>({ok:status===200||status===201,status,json:async()=>data});
 const catalogue=()=>({v:1,mode:'synthetic-integration-only',admissionReady:true,catalogueSha256:'c'.repeat(64),entries:[{entryId:'literal',requestText:privateText,inputSha256,taskContext:{title:'Synthetic approval',nextAction:'Review only',latestFinding:'No provider'},slots:[{slotId:'slot-0',ref,state:job}]}],...cataloguePatch});
 const saved=state=>({v:1,ref,state,resultAvailable:state==='completed',reasonCode:state==='failed'?'output_incomplete':state,...(state==='completed'?{result:{kind:'information',body:savedBody}}:{})});
 async function fetch(path,options){requests.push({path,options});assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');if(options.signal.aborted)throw Error('aborted');
  if(path==='/auth/state')return json({enrolled:true});if(path==='/auth/logout'){authenticated=false;return json({ok:true});}
  if(!authenticated||lost)return json({error:'auth_failed'},lost??401);
  if(path==='/status')return json(state);if(path==='/jobs')return json({v:1,observedAt:state.observedAt,rows:jobs,nextCursor:null});
  if(unavailable)return json({error:'PRIVATE_BACKEND_EXCEPTION'},503);
  if(path==='/request-catalogue')return json(legacyReview?{...catalogue(),admissionReady:false,blockingCode:'legacy_review_required'}:empty?{...catalogue(),entries:[],admissionReady:false}:catalogue());
  if(path==='/request-approvals'){if(hold)await hold;return json({v:1,entryId:'literal',slotId:'slot-0',nonce:'N'.repeat(43),approvedInputSha256:inputSha256});}
  if(path==='/requests'){const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['approve','approvedInputSha256','entryId','nonce','slotId']);assert.equal(body.approve,true);job='completed';return json({v:1,ref,state:'queued',duplicate:false},201);}
  if(path==='/requests/'+ref){const held=heldReads.shift();return held?held:json(saved(job));}
  throw Error('unexpected_path:'+path);
 }
 vm.runInNewContext(script,{document,window,fetch,TextEncoder,AbortController,Date,queueMicrotask,setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id)});
 return {els,requests,timers,get:id=>els.get(id),document,window,async click(id){await els.get(id).listeners.click();await flush();},async fire(kind,name,value){for(const fn of events[kind][name]??[])fn(value);await flush();},async back(){if(historyIndex>0){location.hash=history[--historyIndex];await this.fire('window','popstate');}},async forward(){if(historyIndex<history.length-1){location.hash=history[++historyIndex];await this.fire('window','popstate');}},lose:code=>lost=code,fail:()=>unavailable=true,recover:()=>unavailable=false,setEmpty:()=>empty=true,setLegacyReview:()=>legacyReview=true,setJob:value=>job=value,hold:promise=>hold=promise,deferRead(){let release;heldReads.push(new Promise(resolve=>release=resolve));return state=>release(json(saved(state)));}};
}
test('disabled owner UI is byte-identical; enabled view compiles without execution controls outside Requests',()=>{
 assert.equal(admissionConsoleHtml(CONSOLE_HTML),CONSOLE_HTML);new vm.Script(script);assert.ok(html.includes('id="nav-requests"'));assert.ok(html.includes('id="admission-approve"'));
 const noDisplayStorage=script.replace(/localStorage\.(?:getItem\(stealthPreference\)|setItem\(stealthPreference,String\(stealthFlags\)\))/g,'');
 assert.doesNotMatch(noDisplayStorage,/localStorage|sessionStorage|document\.cookie|innerHTML|eval\(/);
 assert.equal([...html.matchAll(/aria-label="Picard Relay brass rank insignia"/g)].length,1);
});

test('empty catalogue has a truthful empty state and no approval action',async()=>{
 const h=harness();await flush();h.setEmpty();await h.click('nav-requests');assert.equal(h.get('admission-notice').textContent,'No approved requests are enrolled.');assert.equal(h.get('admission-approve').disabled,true);assert.equal(h.get('admission-entry').children.length,0);await h.click('admission-approve');assert.equal(h.requests.some(r=>r.options.method==='POST'),false);
});

test('legacy review stop explains the prerequisite without offering approval or hiding saved results',async()=>{
 const h=harness();await flush();h.setLegacyReview();await h.click('nav-requests');assert.equal(h.get('admission-notice').textContent,'Historical job evidence needs review before new work. Saved results can still be checked.');assert.equal(h.get('admission-approve').disabled,true);await h.click('admission-approve');assert.equal(h.requests.some(r=>r.options.method==='POST'),false);h.setJob('completed');await h.click('admission-check');assert.match(h.get('admission-output').textContent,/SYNTHETIC_SAVED_RESULT/);
});
test('owner reviews fixed input then queues one exact approval and reads the durable plaintext result',async()=>{
 const h=harness();await flush();assert.equal(h.requests.some(r=>r.path==='/request-catalogue'),false);await h.click('nav-requests');assert.equal(h.get('admission-input').textContent,privateText);assert.equal(h.get('admission-approve').disabled,false);
 await h.click('admission-approve');assert.equal(h.requests.filter(r=>r.path==='/requests'&&r.options.method==='POST').length,1);assert.equal(h.get('admission-output').textContent,'SYNTHETIC_SAVED_RESULT <img src=x>');assert.equal(h.get('admission-result').hidden,false);assert.equal(h.get('admission-approve').disabled,true);await h.click('admission-approve');assert.equal(h.requests.filter(r=>r.path==='/requests'&&r.options.method==='POST').length,1);
});
test('concurrent clicks stay single-flight and cannot change the displayed selection while approving',async()=>{
 const h=harness();await flush();await h.click('nav-requests');let release;h.hold(new Promise(resolve=>release=resolve));const first=h.get('admission-approve').listeners.click();await flush();assert.equal(h.get('admission-entry').disabled,true);assert.equal(h.get('admission-slot').disabled,true);await h.get('admission-approve').listeners.click();assert.equal(h.requests.filter(r=>r.path==='/request-approvals').length,1);release();await first;assert.equal(h.requests.filter(r=>r.path==='/requests'&&r.options.method==='POST').length,1);
});

test('concurrent saved-status clicks share one flight and cannot regress a completed read',async()=>{
 const h=harness();await flush();h.setJob('queued');await h.click('nav-requests');const release=h.deferRead(),first=h.get('admission-check').listeners.click();await flush();assert.equal(h.get('admission-check').disabled,true);assert.equal(h.get('admission-approve').disabled,true);
 await h.get('admission-check').listeners.click();assert.equal(h.requests.filter(r=>r.path==='/requests/'+ref).length,1);release('completed');await first;assert.equal(h.get('admission-state').textContent,'State: completed');assert.match(h.get('admission-output').textContent,/SYNTHETIC_SAVED_RESULT/);
});

test('older queued response arriving after refresh and completion cannot overwrite current state or result',async()=>{
 const h=harness();await flush();h.setJob('queued');await h.click('nav-requests');const release=h.deferRead(),old=h.get('admission-check').listeners.click();await flush();
 h.setJob('completed');await h.click('admission-refresh');await h.click('admission-check');assert.equal(h.get('admission-state').textContent,'State: completed');const result=h.get('admission-output').textContent;
 release('queued');await old;assert.equal(h.get('admission-state').textContent,'State: completed');assert.equal(h.get('admission-output').textContent,result);assert.equal(h.get('admission-result').hidden,false);
});

test('failed saved-status read disables approval of last-known available slot until fresh catalogue',async()=>{
 const h=harness();await flush();await h.click('nav-requests');assert.equal(h.get('admission-approve').disabled,false);h.fail();await h.click('admission-check');assert.equal(h.get('admission-approve').disabled,true);assert.match(h.get('admission-state').textContent,/Current status unknown.*available/);assert.match(h.get('admission-notice').textContent,/Current status is unknown/);
 await h.click('admission-approve');assert.equal(h.requests.some(r=>r.options.method==='POST'),false);h.recover();await h.click('admission-refresh');assert.equal(h.get('admission-approve').disabled,false);
});

test('late saved result after pagehide cannot repopulate private state',async()=>{
 const h=harness();await flush();h.setJob('queued');await h.click('nav-requests');const release=h.deferRead(),old=h.get('admission-check').listeners.click();await flush();await h.fire('window','pagehide');release('completed');await old;
 assert.equal(h.get('admission-output').textContent,'');assert.equal(h.get('admission-input').textContent,'');assert.equal(h.get('admission-state').textContent,'');assert.equal(h.get('admission-result').hidden,true);
});

test('terminal result never silently regresses to queued on a later inconsistent response',async()=>{
 const h=harness();await flush();h.setJob('completed');await h.click('nav-requests');await h.click('admission-check');h.setJob('queued');await h.click('admission-check');assert.match(h.get('admission-state').textContent,/unknown.*completed/);assert.match(h.get('admission-output').textContent,/SYNTHETIC_SAVED_RESULT/);assert.equal(h.get('admission-approve').disabled,true);
});
for(const event of ['logout','401','403','pagehide'])test('owner request input/result/options and pending polls clear on '+event,async()=>{
 const h=harness();await flush();await h.click('nav-requests');await h.click('admission-approve');assert.ok(h.get('admission-output').textContent);
 if(event==='logout')await h.click('logout');else if(event==='pagehide')await h.fire('window','pagehide');else{h.lose(Number(event));await h.click('admission-check');}
 for(const id of ['admission-input','admission-context','admission-output','admission-state'])assert.equal(h.get(id).textContent,'',id);for(const id of ['admission-entry','admission-slot']){assert.equal(h.get(id).children.length,0);assert.equal(h.get(id).value,'');}
 assert.equal(h.get('admission-result').hidden,true);assert.equal(h.get('private').hidden,true);assert.equal(h.get('admission-formatted').children.length,0);assert.equal(h.get('admission-identity').textContent,'');assert.equal(h.get('admission-capability').textContent,'');assert.equal(JSON.stringify([...h.els.values()]).includes('SYNTHETIC_PRIVATE_'),false);
});
test('late approval response after pagehide cannot repopulate private fields or send a submission',async()=>{
 const h=harness();await flush();await h.click('nav-requests');let release;h.hold(new Promise(resolve=>release=resolve));const first=h.get('admission-approve').listeners.click();await flush();await h.fire('window','pagehide');release();await first;assert.equal(h.requests.filter(r=>r.path==='/requests'&&r.options.method==='POST').length,0);assert.equal(h.get('admission-output').textContent,'');assert.equal(h.get('admission-input').textContent,'');
});
test('503 preserves last actual result but disables approval and says current availability is unknown',async()=>{
 const h=harness();await flush();await h.click('nav-requests');await h.click('admission-approve');h.fail();await h.click('admission-refresh');assert.equal(h.get('admission-output').textContent,'SYNTHETIC_SAVED_RESULT <img src=x>');assert.match(h.get('admission-notice').textContent,/current availability is unknown/);assert.equal(h.get('admission-approve').disabled,true);assert.equal(JSON.stringify([...h.els.values()]).includes('PRIVATE_BACKEND_EXCEPTION'),false);
});
for(const state of ['uncertain','failed'])test('terminal '+state+' reads never offer a retry or new grant',async()=>{
 const h=harness();await flush();h.setJob(state);await h.click('nav-requests');assert.equal(h.get('admission-approve').disabled,true);await h.click('admission-check');assert.match(h.get('admission-state').textContent,/spent.*Do not retry/);assert.equal(h.requests.some(r=>r.options.method==='POST'&&r.path==='/requests'),false);
});

test('saved result does not replace the persistent availability reason',async()=>{
 const h=harness({cataloguePatch:{admissionReady:false,blockingCode:'allowance_unavailable'}});await flush();h.setJob('completed');await h.click('nav-requests');const reason=h.get('admission-capability').textContent;assert.match(reason,/allowance|spent|used/i);await h.click('admission-check');assert.equal(h.get('admission-capability').textContent,reason);assert.equal(h.get('admission-notice').textContent,'Saved result ready.');assert.equal(h.get('admission-approve').disabled,true);
});

test('spent console examples have no prominent slot warning and cannot submit work',async()=>{
 const h=harness();await flush();h.setJob('completed');await h.click('nav-requests');assert.equal(h.get('admission-capability').hidden,true);assert.equal(h.get('admission-approve').disabled,true);assert.equal(h.get('admission-capability').textContent.includes('No available enrolled slots'),false);await h.click('admission-check');assert.equal(h.get('admission-result').hidden,false);assert.equal(h.requests.some(r=>r.options.method==='POST'),false);
});
test('duplicate task titles retain distinct input labels and hashes',async()=>{
 const entry=(entryId,ref)=>({entryId,requestText:entryId,inputSha256,taskContext:{title:'Same task',nextAction:'',latestFinding:''},slots:[{slotId:'slot',ref,state:'completed'}]});
 const h=harness({cataloguePatch:{entries:[entry('function',ref),entry('regression','d'.repeat(64))]}});await flush();await h.click('nav-requests');const labels=h.get('admission-entry').children.map(n=>n.textContent);assert.equal(new Set(labels).size,2);assert.match(labels[0],/function/);assert.match(labels[1],/regression/);assert.match(h.get('admission-identity').textContent,new RegExp(inputSha256));
});
test('formatted code and tables use inert nodes and preserve the exact original',async()=>{
 const body='# Review\n```js\n<img src=x onerror=alert(1)>\n```\n| Case | Result |\n| --- | --- |\n| **Exact limit** | `valid` |\n<script>alert(1)</script>';
 const h=harness({savedBody:body});await flush();h.setJob('completed');await h.click('nav-requests');await h.click('admission-check');assert.equal(h.get('admission-output').textContent,body);
 const walk=n=>[n,...n.children.flatMap(walk)],nodes=walk(h.get('admission-formatted'));assert.ok(nodes.some(n=>n.tagName==='table'));assert.ok(nodes.some(n=>n.tagName==='code'&&n.textContent.includes('<img')));assert.equal(nodes.some(n=>['script','img','a'].includes(n.tagName)),false);assert.ok(nodes.some(n=>n.tagName==='strong'));
 await h.click('logout');assert.equal(h.get('admission-formatted').children.length,0);assert.equal(h.get('admission-identity').textContent,'');assert.equal(h.get('admission-capability').textContent,'');
});
test('completed job opens its matching result and requests destination survives reload',async()=>{
 const h=harness({jobs:[{ref,state:'completed',createdAt:1000,updatedAt:2000,resultAvailable:true,reasonCode:'completed'}]});await flush();h.setJob('completed');await h.click('nav-jobs');await h.get('jobs-list').children[0].children[0].listeners.click();assert.equal(h.window.location.hash,'#jobs/'+ref);assert.equal(h.get('job-open-result').hidden,false);await h.click('job-open-result');assert.equal(h.get('view-requests').hidden,false);assert.equal(h.window.location.hash,'#requests/'+ref);assert.equal(h.get('admission-result').hidden,false);assert.equal(h.requests.some(r=>r.options.method==='POST'),false);
 const restored=harness({initialHash:h.window.location.hash});restored.setJob('completed');await flush();assert.equal(restored.get('view-requests').hidden,false);assert.equal(restored.get('admission-result').hidden,false);await restored.click('nav-system');assert.equal(restored.window.location.hash,'#system');restored.window.location.hash='#requests/'+ref;await restored.fire('window','popstate');assert.equal(restored.get('view-requests').hidden,false);await restored.click('logout');assert.equal(restored.window.location.hash,'#overview');
});
test('a result outside the current catalogue never displays a different request instead',async()=>{
 const h=harness({initialHash:'#requests/'+'f'.repeat(64)});await flush();assert.equal(h.get('admission-slot').value,'');assert.equal(h.get('admission-result').hidden,true);assert.match(h.get('admission-notice').textContent,/not in the current enrolled catalogue/);assert.equal(h.get('admission-approve').disabled,true);assert.equal(h.requests.some(r=>r.path.startsWith('/requests/')),false);
});

test('Back restores a selected completed job even after a conflicting review filter',async()=>{
 const h=harness({jobs:[{ref,state:'completed',createdAt:1000,updatedAt:2000,resultAvailable:true,reasonCode:'completed'}]});await flush();
 await h.click('nav-jobs');await h.get('jobs-list').children[0].children[0].listeners.click();await h.click('nav-system');await h.click('nav-jobs');
 h.get('jobs-filter').value='attention';h.get('jobs-filter').listeners.change();assert.equal(h.get('jobs-list').children.length,0);assert.equal(h.get('job-details').hidden,true);
 await h.back();assert.equal(h.window.location.hash,'#system');await h.back();
 assert.equal(h.window.location.hash,'#jobs/'+ref);assert.equal(h.get('jobs-filter').value,'all');assert.equal(h.get('jobs-list').children.length,1);assert.equal(h.get('detail-ref').textContent,ref);assert.equal(h.get('job-open-result').hidden,false);
 await h.forward();assert.equal(h.window.location.hash,'#system');await h.forward();assert.equal(h.window.location.hash,'#jobs');assert.equal(h.get('job-details').hidden,true);
 assert.equal(h.requests.some(r=>r.options.method==='POST'),false);
});

test('only the exact reviewed proposal displays its correction, preserving original text and clearing on selection/logout',async()=>{
 const reviewed=REVIEWED_REGRESSION_RESULT;
 for(const patch of [{},{entryId:'another-entry'},{inputSha256:'e'.repeat(64)},{ref:'e'.repeat(64)},{body:reviewed.body+' altered'}]){
  const value={...reviewed,...patch},entry={entryId:value.entryId,inputSha256:value.inputSha256,requestText:'Synthetic review binding',taskContext:{title:'Review fixture',nextAction:'',latestFinding:''},slots:[{slotId:'approved-once',ref:value.ref,state:'completed'}]};
  const h=harness({requestRef:value.ref,inputHash:value.inputSha256,savedBody:value.body,initialHash:'#requests/'+value.ref,cataloguePatch:{entries:[entry]}});h.setJob('completed');await flush();
  assert.equal(h.get('admission-result').hidden,false);assert.equal(h.get('admission-output').textContent,value.body);assert.equal(h.get('admission-review-note').hidden,Object.keys(patch).length!==0);
  h.get('admission-slot').listeners.change();assert.equal(h.get('admission-review-note').hidden,true);await h.click('admission-check');
  await h.click('logout');assert.equal(h.get('admission-review-note').hidden,true);assert.equal(h.get('admission-output').textContent,'');
  assert.equal(h.requests.some(r=>r.options.method==='POST'&&r.path!=='/auth/logout'),false);
 }
 assert.match(html,/referrerpolicy="no-referrer"/);assert.match(html,/fb0d442c1713a4aa2f287eb46dd9b1a1882ad167\/examples\/form-limit-regression-cases.json/);
});
