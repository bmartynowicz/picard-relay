import assert from 'node:assert/strict';
import {CONSOLE_HTML as html} from '../src/oracle-service.mjs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const script=html.match(/<script>\n([\s\S]*?)<\/script>/)[1],style=html.match(/<style>([\s\S]*?)<\/style>/)[1];
assert.equal(createHash('sha256').update(script).digest('hex'),"a8d39667dfaee353f6a2d0b5f4c62af42073d333f9ab01c8d25145ab3166f7e5");
assert.equal(createHash('sha256').update(html.match(/id="logo" aria-hidden="true">([\s\S]*?)<\/pre>/)[1]).digest('hex'),"632fc5b24f76003e80bc7299ba9e404b3d8e01f7ab31563a492ae9b6421a0ca4");
assert.ok(!/localStorage|sessionStorage|document\.cookie|innerHTML|setInterval/.test(script));assert.ok(!/src=|@import|url\(/i.test(html.replace(/url\(#picard-metal-(?:face|recess)\)/g,'')));assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]),['https://github.com/bmartynowicz/picard-relay/blob/main/docs/README.md']);assert.match(html,/<a id="documentation"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*referrerpolicy="no-referrer"/);assert.ok(html.includes('<div id="private" hidden>'));assert.ok(html.includes('prefers-reduced-motion'));assert.ok(!html.includes('NCC-1701'));
for(const id of ['setup-code','new-password','confirm-password','login-password'])assert.match(html,new RegExp('id="'+id+'" type="password"'));
const health={v:1,observedAt:'2026-10-30T16:00:00Z',service:{ready:true,providerReady:false,resultRecoveryReady:true,acceptingNewWork:false,draining:false},jobs:{queued:0,invoking:0,completed:2,uncertain:0},release:{hash:'a'.repeat(64),version:null},updater:{state:'unknown'}};
const ok=body=>({ok:true,status:200,json:async()=>body}),bad=(status,error)=>({ok:false,status,json:async()=>({error})});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(handler,{jobsHandler,clock=Date}={}){
 const animations=[];const element=()=>({_text:'',get textContent(){return this._text+this.children.map(n=>n.textContent).join('')},set textContent(v){this._text=String(v);this.children=[]},children:[],value:'',className:'',hidden:true,disabled:false,dataset:{},listeners:{},attrs:{},classList:{items:new Set(),toggle(n,v){v?this.items.add(n):this.items.delete(n)}},setAttribute(n,v){this.attrs[n]=v},addEventListener(n,fn){this.listeners[n]=fn},append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this._text='';this.children=nodes},animate(frames,options){const a={frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.()}};animations.push(a);return a}});
 const els=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,element()]));
 const dl={},wl={},ml={},pref={matches:false,addEventListener:(n,fn)=>ml[n]=fn};
 const document={visibilityState:'visible',getElementById:id=>{assert.ok(els.has(id));return els.get(id)},createElement:()=>element(),addEventListener:(n,fn)=>dl[n]=fn};
 const window={matchMedia:()=>pref,addEventListener:(n,fn)=>wl[n]=fn};let count=0;const requests=[],timers=new Map();
 vm.runInNewContext(script,{document,window,TextEncoder,AbortController,Date:clock,queueMicrotask,setTimeout:fn=>{timers.set(++count,fn);return count},clearTimeout:id=>timers.delete(id),fetch:async(path,options)=>{assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(['/auth/state','/auth/setup','/auth/login','/auth/logout','/status','/updates'].includes(path)||path==='/jobs'||path.startsWith('/jobs?cursor='));if(options.method==='POST')assert.equal(options.headers['Content-Type'],'application/json');requests.push({path,options});return path.startsWith('/jobs')?(jobsHandler?jobsHandler(path,options):ok({v:1,rows:[],nextCursor:null,observedAt:health.observedAt})):handler(path,options)}});
 return {get:id=>els.get(id),els,requests,timers,wl,dl,ml,pref,document,animations,async submit(id){await els.get(id).listeners.submit({preventDefault(){}})},async click(id){await els.get(id).listeners.click()}};
}
let h=harness(async path=>path==='/auth/state'?ok({enrolled:false}):path==='/auth/setup'?ok({ok:true}):ok(health));await flush();assert.equal(h.get('setup-form').hidden,false);assert.equal(h.get('private').hidden,true);assert.deepEqual(h.requests.map(x=>x.path),['/auth/state']);
h.get('new-password').value='x'.repeat(7);h.get('confirm-password').value='x'.repeat(7);h.get('setup-code').value='private-test-code';await h.submit('setup-form');assert.equal(h.requests.length,1);assert.match(h.get('auth-message').textContent,/8 and 128 UTF-8 bytes/);
h.get('new-password').value='correct-test-password';h.get('confirm-password').value='mismatch';await h.submit('setup-form');assert.equal(h.requests.length,1);
h.get('new-password').value='😀'.repeat(33);h.get('confirm-password').value=h.get('new-password').value;await h.submit('setup-form');assert.equal(h.requests.length,1);
h.get('new-password').value='correct-test-password';h.get('confirm-password').value='correct-test-password';await h.submit('setup-form');assert.deepEqual(h.requests.map(x=>x.path),['/auth/state','/auth/setup','/status','/jobs']);assert.equal(h.get('private').hidden,false);assert.equal(h.get('completed').textContent,'2');for(const id of ['setup-code','new-password','confirm-password'])assert.equal(h.get(id).value,'');assert.equal(h.get('auth').hidden,true);
// Exact byte limits apply equally to setup and login, without character-mix rules.
assert.ok(html.includes('8–128 UTF-8 bytes. Most ordinary characters use one byte; no character-mix rules.'));
for(const [password,accepted] of [['a'.repeat(7),false],['aaaaaaaa',true],['12345678',true],['é'.repeat(3)+'a',false],['é'.repeat(4),true],['😀abc',false],['😀'.repeat(2),true],['x'.repeat(128),true],['x'.repeat(129),false],['é'.repeat(64),true],['é'.repeat(64)+'a',false],['😀'.repeat(32),true],['😀'.repeat(33),false]]){
 for(const setup of [true,false]){
  let signedIn=false;
  const boundary=harness(async path=>path==='/auth/state'?ok({enrolled:!setup}):path==='/status'?signedIn?ok(health):bad(401,'auth_failed'):(signedIn=true,ok({ok:true})));
  await flush();boundary.get(setup?'new-password':'login-password').value=password;
  if(setup){boundary.get('confirm-password').value=password;boundary.get('setup-code').value='private-test-code';}
  await boundary.submit(setup?'setup-form':'login-form');
  assert.equal(boundary.requests.some(request=>request.path===(setup?'/auth/setup':'/auth/login')),accepted);
  if(accepted)assert.equal(boundary.get('private').hidden,false);else assert.match(boundary.get('auth-message').textContent,/8 and 128 UTF-8 bytes/);
 }
}
// Existing session resumes without asking for a password; expiry removes every private value.
let expired=false;h=harness(async path=>path==='/auth/state'?ok({enrolled:true}):expired?bad(401,'auth_failed'):ok(health));await flush();assert.equal(h.get('private').hidden,false);expired=true;await h.click('refresh');assert.equal(h.get('private').hidden,true);assert.equal(h.get('completed').textContent,'—');assert.equal(h.get('fingerprint').textContent,'No verified observation');assert.equal(h.get('login-form').hidden,false);
// Login success, generic failed credentials and rate limiting; no server error text reflected.
let loginStatus='bad';h=harness(async path=>path==='/auth/state'?ok({enrolled:true}):path==='/status'?loginStatus==='ok'?ok(health):bad(401,'auth_failed'):loginStatus==='bad'?bad(401,'PRIVATE_INTERNAL_SENTINEL'):loginStatus==='limited'?bad(429,'rate_limited'):ok({ok:true}));await flush();h.get('login-password').value='correct-test-password';await h.submit('login-form');assert.equal(h.get('login-password').value,'');assert.match(h.get('auth-message').textContent,/Sign-in failed/);assert.ok(!h.get('auth-message').textContent.includes('PRIVATE_INTERNAL'));loginStatus='limited';h.get('login-password').value='correct-test-password';await h.submit('login-form');assert.match(h.get('auth-message').textContent,/Too many/);loginStatus='ok';h.get('login-password').value='correct-test-password';await h.submit('login-form');assert.equal(h.get('private').hidden,false);
// Sign-out hides prior values before the network resolves, and does not falsely confirm on failure.
let resolveLogout;h=harness(async path=>path==='/auth/state'?ok({enrolled:true}):path==='/status'?ok(health):new Promise(resolve=>resolveLogout=resolve));await flush();const logoutPromise=h.click('logout');assert.equal(h.get('private').hidden,true);assert.equal(h.get('completed').textContent,'—');resolveLogout(bad(503,'auth_unavailable'));await logoutPromise;assert.match(h.get('auth-message').textContent,/may still be active/);
h=harness(async path=>path==='/auth/state'?ok({enrolled:true}):path==='/status'?ok(health):ok({ok:true}));await flush();await h.click('logout');assert.equal(h.get('private').hidden,true);assert.equal(h.get('auth-message').textContent,'Signed out.');assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),{});
// Corrupt/missing auth state never falls back to setup.
for(const response of [bad(503,'auth_unavailable'),ok({}),ok({enrolled:null})]){h=harness(async()=>response);await flush();assert.equal(h.get('setup-form').hidden,true);assert.equal(h.get('login-form').hidden,true);assert.equal(h.get('retry-auth').hidden,false);assert.equal(h.requests.length,1);}
// One flight, inputs cleared before awaiting server, already-enrolled setup requires explicit state retry.
let resolveSetup;h=harness(async path=>path==='/auth/state'?ok({enrolled:false}):new Promise(resolve=>resolveSetup=resolve));await flush();h.get('setup-code').value='private-test-code';h.get('new-password').value='correct-test-password';h.get('confirm-password').value='correct-test-password';const setup=h.submit('setup-form');assert.equal(h.get('setup-code').value,'');assert.equal(h.get('new-password').value,'');await h.submit('setup-form');assert.equal(h.requests.length,2);resolveSetup(bad(409,'setup_unavailable'));await setup;assert.equal(h.get('retry-auth').hidden,false);assert.equal(h.get('setup-form').hidden,true);
// Motion, BFCache safety and pagehide clearing.
h=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok(health));await flush();assert.equal(h.get('logo-wrap').classList.items.has('running'),true);await h.click('motion');assert.equal(h.get('logo-wrap').classList.items.has('running'),false);await h.click('motion');h.pref.matches=true;h.ml.change();assert.equal(h.get('motion').disabled,true);assert.equal(h.get('logo-wrap').classList.items.has('running'),false);h.pref.matches=false;h.ml.change();h.document.visibilityState='hidden';h.dl.visibilitychange();assert.equal(h.get('logo-wrap').classList.items.has('running'),false);h.wl.pagehide();assert.equal(h.get('private').hidden,true);assert.equal(h.get('completed').textContent,'—');assert.equal(h.requests.at(-1).options.signal.aborted,true);h.wl.pageshow({persisted:true});await flush();assert.equal(h.get('private').hidden,false);assert.equal(h.requests.filter(r=>r.path==='/auth/state').length,2);
const hash=value=>createHash('sha256').update(value).digest('base64');const checks={htmlSha256:createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html),scriptSrc:`'sha256-${hash('\n'+script)}'`,styleSrc:`'sha256-${hash(style)}'`,passed:['exact logo','password masking','UTF-8 bounds','confirmation','public shell','state fail closed','existing session','setup/login','cleared inputs','no browser tokens','generic errors','rate limit','single-flight','logout confirmed/uncertain','401 clears private data','reduced motion','hidden tab','pagehide and BFCache']};console.log('PASS '+checks.passed.join('; '));console.log(JSON.stringify(checks));
// First-bundle history, stale data, action labels and counter-motion behavior.
const job={ref:'a'.repeat(64),state:'uncertain',createdAt:1000,updatedAt:2000,resultAvailable:false,reasonCode:'outcome_uncertain'};
const page=(rows=[job],nextCursor=null)=>({v:1,rows,nextCursor,observedAt:health.observedAt});
for(const status of [401,403])for(const route of ['status','jobs']){
 let lost=false,count=2;const p=harness(async path=>path==='/auth/state'?ok({enrolled:true}):lost&&route==='status'?bad(status,'PRIVATE_AUTH_SENTINEL'):ok({...health,jobs:{...health.jobs,completed:count}}),{jobsHandler:async()=>lost&&route==='jobs'?bad(status,'PRIVATE_AUTH_SENTINEL'):ok(page())});
 await flush();assert.equal(p.get('jobs-list').children.length,1);count=3;await p.click('refresh');assert.equal(p.get('completed').textContent,'3');assert.equal(p.animations.length,1);lost=true;await p.click(route==='jobs'?'jobs-refresh':'refresh');
 assert.equal(p.get('private').hidden,true);assert.equal(p.get('completed').textContent,'—');for(const id of ['queued','invoking','completed','uncertain'])assert.equal(p.get(id).attrs['aria-label'],'Unknown');assert.equal(p.get('jobs-list').children.length,0);assert.equal(p.get('fingerprint').textContent,'No verified observation');assert.equal(p.get('jobs-observed').textContent,'Not checked');assert.equal(p.get('jobs-more').hidden,true);assert.equal(p.animations[0].cancelled,true);
 assert.equal(JSON.stringify([...p.els.values()]).includes('PRIVATE_AUTH_SENTINEL'),false);
}
let staleStatus=false,staleJobs=false;
let p=harness(async path=>path==='/auth/state'?ok({enrolled:true}):staleStatus?bad(503,'PRIVATE_STATUS_SENTINEL'):ok(health),{jobsHandler:async()=>staleJobs?bad(503,'PRIVATE_JOBS_SENTINEL'):ok(page())});await flush();
staleStatus=true;await p.click('refresh');assert.equal(p.get('completed').textContent,'2');assert.match(p.get('notice').textContent,/previous observation/);assert.match(p.get('notice').textContent,/Current health is unknown/);assert.equal(p.get('jobs-list').children.length,1);
staleJobs=true;await p.click('jobs-refresh');assert.equal(p.get('jobs-list').children.length,1);assert.match(p.get('jobs-notice').textContent,/previous observation/);assert.equal(JSON.stringify([...p.els.values()]).includes('PRIVATE_'),false);
const cursor=Buffer.from(JSON.stringify({v:1,createdAt:1000,ref:job.ref})).toString('base64url');let resolveHistory,hold=false;
p=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok(health),{jobsHandler:async path=>hold?new Promise(resolve=>{resolveHistory=resolve;}):ok(path.includes('?')?page([{...job,ref:'b'.repeat(64),state:'completed',resultAvailable:true,reasonCode:'completed'}]):page([job],cursor))});await flush();assert.equal(p.get('jobs-more').hidden,false);await p.click('jobs-more');assert.equal(p.get('jobs-list').children.length,2);assert.equal(p.get('jobs-more').hidden,true);await p.get('jobs-list').children[0].children[0].listeners.click();assert.match(p.get('detail-reason').textContent,/Do not retry/);assert.equal(p.get('detail-ref').textContent,job.ref);
hold=true;const refreshHistory=p.click('jobs-refresh');await p.click('jobs-refresh');assert.equal(p.requests.filter(r=>r.path==='/jobs').length,2);resolveHistory(ok(page()));await refreshHistory;assert.equal(p.get('jobs-list').children.length,1);
for(const rows of [[{...job,body:'PRIVATE_HTML_SENTINEL',headers:{Authorization:'PRIVATE_HTML_SENTINEL'}}],[{...job,reasonCode:'<img src=x>'}],[job,job]]){
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok(health),{jobsHandler:async()=>ok(page(rows))});await flush();assert.equal(JSON.stringify([...q.els.values()]).includes('PRIVATE_HTML_SENTINEL'),false);assert.equal(q.get('jobs-list').children.length,rows[0].reasonCode===job.reasonCode&&rows.length===1?1:0);
}
let value=2;p=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,jobs:{...health.jobs,completed:value}}));await flush();assert.equal(p.animations.length,0);value=3;await p.click('refresh');assert.equal(p.animations.length,1);assert.equal(p.get('completed').textContent,'3');assert.equal(p.animations[0].options.duration,520);
p.pref.matches=true;p.ml.change();assert.equal(p.animations[0].cancelled,true);value=4;await p.click('refresh');assert.equal(p.animations.length,1);p.pref.matches=false;p.ml.change();await p.click('motion');value=5;await p.click('refresh');assert.equal(p.animations.length,1);await p.click('motion');value=6;await p.click('refresh');assert.equal(p.animations.length,2);p.document.visibilityState='hidden';p.dl.visibilitychange();assert.equal(p.animations[1].cancelled,true);value=7;await p.click('refresh');assert.equal(p.animations.length,2);p.wl.pagehide();assert.equal(p.get('completed').textContent,'—');assert.equal(p.get('jobs-list').children.length,0);
let clockNow=100000;class Clock extends Date{constructor(...args){super(...(args.length?args:[clockNow]));}static now(){return clockNow;}}
p=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,observedAt:new Date(100000).toISOString()}),{clock:Clock});await flush();assert.equal(p.get('notice').hidden,true);clockNow=160001;for(const callback of [...p.timers.values()])callback();assert.match(p.get('notice').textContent,/over a minute old/);
const future=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,observedAt:new Date(clockNow+10000).toISOString()}),{clock:Clock});await flush();assert.match(future.get('notice').textContent,/ahead of this device/);assert.match(future.get('notice').textContent,/unknown/);
assert.match(future.get('health-heading').textContent,/Current health unknown.*clock mismatch/);assert.equal(future.get('health-heading').dataset.tone,'unknown');assert.match(p.get('checked').textContent,/minutes ago/);
console.log('PASS bundle UI: 401/403 clears counters/history/cursors/motion; stale observations retain actual values; history paging/single-flight/redaction; bounded rolling counters respect reduced motion/visibility; stale/future clocks truthful.');
for(const reset of ['logout','401','403','pagehide']){
 let rejected=null;const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):path==='/status'?rejected?bad(rejected,'auth_failed'):ok({...health,jobs:{queued:7,invoking:5,completed:37,uncertain:3}}):ok({ok:true}));await flush();assert.equal(q.get('completed').attrs['aria-label'],'37');
 if(reset==='logout')await q.click('logout');else if(reset==='pagehide')q.wl.pagehide();else{rejected=Number(reset);await q.click('refresh');}
 assert.equal(q.get('private').hidden,true);for(const id of ['queued','invoking','completed','uncertain']){assert.equal(q.get(id).textContent,'—');assert.equal(q.get(id).attrs['aria-label'],'Unknown',reset+' '+id);}
}
console.log('PASS privacy correction: logout,401,403,pagehide clear all numeric counter aria-labels as well as visible text.');

// App navigation uses the existing private data surface; it creates no endpoint,
// provider request or admission authority. Filters operate only on loaded rows.
const completedJob={...job,ref:'b'.repeat(64),state:'completed',resultAvailable:true,reasonCode:'completed'};
const activeJob={...job,ref:'c'.repeat(64),state:'invoking',reasonCode:'invoking'};
let appLost=false;
const app=harness(async path=>path==='/auth/state'?ok({enrolled:true}):appLost?bad(401,'auth_failed'):ok(health),{jobsHandler:async()=>appLost?bad(401,'auth_failed'):ok(page([job,completedJob,activeJob]))});await flush();
assert.equal(app.get('navigation').hidden,false);assert.equal(app.get('view-overview').hidden,false);
const requestsBeforeNavigation=app.requests.length;
for(const name of ['jobs','groq','system','overview']){
 await app.click('nav-'+name);
 for(const other of ['overview','jobs','groq','system']){assert.equal(app.get('view-'+other).hidden,other!==name);assert.equal(app.get('nav-'+other).attrs['aria-current'],other===name?'page':'false');}
}
assert.deepEqual(app.requests.slice(requestsBeforeNavigation).map(r=>({path:r.path,method:r.options.method})),[{path:"/updates",method:"GET"}]);await app.click('open-jobs');assert.equal(app.get('view-jobs').hidden,false);
await app.get('jobs-list').children[0].children[0].listeners.click();assert.equal(app.get('detail-ref').textContent,job.ref);assert.equal(app.get('job-details').hidden,false);assert.match(app.get('detail-reason').textContent,/Do not retry/);
for(const [filter,expected] of [['completed',1],['active',1],['attention',1],['all',3]]){app.get('jobs-filter').value=filter;app.get('jobs-filter').listeners.change();assert.equal(app.get('jobs-list').children.length,expected);assert.equal(app.get('job-details').hidden,true);assert.equal(app.get('detail-ref').textContent,'-');}
assert.deepEqual(app.requests.slice(requestsBeforeNavigation).map(r=>({path:r.path,method:r.options.method})),[{path:"/updates",method:"GET"}]);assert.equal(app.get('activity-list').children.length,3);
assert.equal(app.get('groq-availability').textContent,'Not available for new work');assert.match(app.get('groq-blocking').textContent,/unavailable|not supplied|not reported/i);
assert.ok(html.includes('This console cannot submit or approve a request.'));assert.ok(html.includes('Filters apply to loaded rows only.'));assert.match(html,/<details class="technical"><summary>Request limits and safeguards<\/summary>/);assert.equal((html.match(/<details/g)||[]).length,2);assert.match(html,/<details class="console-info"><summary aria-label="About status and privacy">/);

for(const event of ['logout','401','403','pagehide']){
 let lost=false;const code=event==='403'?403:401;
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):path==='/auth/logout'?ok({ok:true}):lost?bad(code,'auth_failed'):ok(health),{jobsHandler:async()=>lost?bad(code,'auth_failed'):ok(page([job]))});await flush();await q.click('nav-jobs');await q.get('jobs-list').children[0].children[0].listeners.click();assert.equal(q.get('detail-ref').textContent,job.ref);
 if(event==='pagehide')q.wl.pagehide();else if(event==='logout')await q.click('logout');else{lost=true;await q.click('jobs-refresh');}
 assert.equal(q.get('navigation').hidden,true);assert.equal(q.get('private').hidden,true);assert.equal(q.get('view-overview').hidden,false);assert.equal(q.get('view-jobs').hidden,true);assert.equal(q.get('activity-list').children.length,0);assert.equal(q.get('job-details').hidden,true);
 for(const id of ['detail-ref','detail-state','detail-created','detail-updated','detail-result'])assert.equal(q.get(id).textContent,'-');assert.equal(q.get('detail-reason').textContent,'');assert.equal(q.get('jobs-filter').value,'all');assert.equal(q.get('groq-availability').textContent,'Availability unknown');assert.equal(JSON.stringify([...q.els.values()]).includes(job.ref),false);
}
console.log('PASS console redesign: four peer views, System reads only update status, loaded-row filters, metadata inspector, activity projection, truthful Groq state, no disclosures; logout/401/403/pagehide clear every added private field.');

// Independent review regression: a stale timer from the last good read must
// never replace a later failure warning or make current health look operational.
for(const failure of ['http503','invalid-json','network']){
 let failed=false,time=100000;
 class FreshnessClock extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):failed?(failure==='http503'?bad(503,'PRIVATE_READ_ERROR'):failure==='invalid-json'?ok({v:1}):Promise.reject(Error('PRIVATE_NETWORK_ERROR'))):ok({...health,observedAt:new Date(time).toISOString()}),{clock:FreshnessClock});
 await flush();const oldTimers=[...q.timers.values()];assert.equal(q.get('health-heading').textContent,'Relay reachable - new work blocked');failed=true;await q.click('refresh');
 assert.equal(q.get('health-heading').textContent,'Current health unknown');assert.equal(q.get('health-heading').dataset.tone,'unknown');const failureNotice=q.get('notice').textContent;
 time+=61000;for(const callback of oldTimers)await callback();for(const callback of [...q.timers.values()])await callback();
 assert.equal(q.get('notice').textContent,failureNotice);assert.match(failureNotice,/Current health is unknown/);assert.equal(q.get('completed').textContent,'2');assert.equal(q.get('groq-availability').textContent,'Current availability unknown');assert.equal(JSON.stringify([...q.els.values()]).includes('PRIVATE_'),false);
 failed=false;await q.click('refresh');assert.equal(q.get('health-heading').textContent,'Relay reachable - new work blocked');assert.equal(q.get('notice').hidden,true);
}
console.log('PASS independent freshness regression: stale timers preserve failed/unknown status after503, invalid projection or network error, with recovery only after a successful read.');

// F05: real activity data is projected separately from release identity.
const activityTime=10000;
class ActivityClock extends Date{constructor(...args){super(...(args.length?args:[activityTime]));}static now(){return activityTime;}}
const activity={state:'enabled',reasonCode:'none',configured:true,timerActive:true,observedAt:new Date(activityTime).toISOString(),lastAttemptAt:new Date(500000).toISOString(),lastFinishedAt:new Date(510000).toISOString(),lastOutcome:'check_succeeded'};
for(const [state,reason,label] of [['enabled','none','Enabled'],['held','hold_present','On hold'],['disabled','policy_disabled','Disabled'],['checking','check_in_progress','Checking'],['error','fetch_failed','Error']]){
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,observedAt:activity.observedAt,updater:{...activity,state,reasonCode:reason}}),{clock:ActivityClock});await flush();await q.click('nav-system');assert.equal(q.get('updater-state').textContent,label);assert.match(q.get('updater-attempt').textContent,/1969|1970/);assert.match(q.get('updater-outcome').textContent,/succeeded/);assert.equal(q.get('updater-timer').textContent,'Running');q.wl.pagehide();for(const id of ['updater-state','updater-configured','updater-timer','updater-attempt','updater-outcome','updater-observed'])assert.equal(q.get(id).textContent,'Not checked');
}
for(const offset of [-180001,5001]){
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,observedAt:activity.observedAt,updater:{...activity,observedAt:new Date(activityTime+offset).toISOString()}}),{clock:ActivityClock});await flush();assert.equal(q.get('updater-state').textContent,'Unknown');assert.match(q.get('updater-explanation').textContent,/unknown/);
}
let activityFailed=false;const activityFailure=harness(async path=>path==='/auth/state'?ok({enrolled:true}):activityFailed?bad(503,'PRIVATE'):ok({...health,observedAt:activity.observedAt,updater:activity}),{clock:ActivityClock});await flush();activityFailed=true;await activityFailure.click('refresh');assert.equal(activityFailure.get('updater-state').textContent,'Unknown');assert.match(activityFailure.get('updater-explanation').textContent,/unknown/);
console.log('PASS updater activity: enabled, held, disabled, running and failed states; dated outcome; stale/future/failure unknown; pagehide clears every activity field.');

// Small server/device differences are tolerated consistently by health and
// updater freshness checks. Material future observations must stay unknown.
for(const [age,label,unknown] of [[-5001,'age unknown',true],[-5000,'0 seconds ago',false],[-1,'0 seconds ago',false],[0,'0 seconds ago',false],[1000,'1 seconds ago',false],[60000,'1 minutes ago',true]]){
 const now=100000,observedAt=new Date(now-age).toISOString();
 class SkewClock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const q=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,observedAt,updater:{...activity,observedAt}}),{clock:SkewClock});await flush();
 assert.ok(q.get('checked').textContent.endsWith(label));assert.ok(q.get('updater-observed').textContent.endsWith(label));assert.equal(q.get('notice').hidden,!unknown);
 if(age< -5000)assert.match(q.get('health-heading').textContent,/clock mismatch/);
}
console.log('PASS fresh observation: tolerated skew displays zero age; material future and stale observations retain their warnings.');

// Live updates read only current status/history. Owner totals, failures and
// provider activity must stay aligned, and private data clears on auth loss.
let liveCompleted=13,liveFailure=false,liveAuthLost=false;
const live=harness(async path=>path==='/auth/state'?ok({enrolled:true}):liveAuthLost?bad(401,'auth_failed'):liveFailure?bad(503,'PRIVATE_LIVE_ERROR'):ok({...health,scope:'owner',observedAt:new Date().toISOString(),jobs:{...health.jobs,claimed:1,invoking:2,completed:liveCompleted,failed:1,uncertain:3}}),{jobsHandler:async()=>ok(page([completedJob,job]))});
await flush();assert.equal(live.get('completed').textContent,'13');assert.equal(live.get('failed').textContent,'1');assert.equal(live.get('invoking').textContent,'3');assert.equal(live.get('groq-completed').textContent,'13');assert.equal(live.get('groq-failed').textContent,'1');assert.match(live.get('data-scope').textContent,/across approved tasks/);assert.equal(live.get('live-feed').textContent,'Live · 15s');assert.match(live.get('live-feed').attrs['aria-label'],/every 15 seconds/);assert.equal(live.get('live-feed').dataset.connection,'live');assert.equal(live.get('groq-activity').children.length,2);
async function tickLive(h){const timer=[...h.timers].find(([,fn])=>fn.name==='refreshLive');assert.ok(timer,'a bounded live refresh is scheduled');h.timers.delete(timer[0]);await timer[1]();await flush();}
liveCompleted=14;await tickLive(live);assert.equal(live.get('completed').textContent,'14');assert.equal(live.get('groq-completed').textContent,'14');assert.ok(live.requests.every(r=>r.options.method==='GET'));assert.ok(live.requests.filter(r=>r.path==='/status').length===2);
live.document.visibilityState='hidden';live.dl.visibilitychange();assert.equal([...live.timers.values()].some(fn=>fn.name==='refreshLive'),false);live.document.visibilityState='visible';live.dl.visibilitychange();await tickLive(live);
liveFailure=true;await tickLive(live);assert.equal(live.get('completed').textContent,'14');assert.equal(live.get('groq-completed').textContent,'14');assert.equal(live.get('live-feed').textContent,'Offline');assert.match(live.get('live-feed').attrs['aria-label'],/connection unavailable/);assert.match(live.get('health-heading').textContent,/unknown/);assert.equal(JSON.stringify([...live.els.values()]).includes('PRIVATE_LIVE_ERROR'),false);
liveFailure=false;liveCompleted=15;await tickLive(live);assert.equal(live.get('completed').textContent,'15');assert.equal(live.get('groq-completed').textContent,'15');
liveAuthLost=true;await tickLive(live);assert.equal(live.get('private').hidden,true);assert.equal(live.get('failed').textContent,'—');assert.equal(live.get('groq-failed').textContent,'—');assert.equal(live.get('groq-activity').children.length,0);assert.equal([...live.timers.values()].some(fn=>fn.name==='refreshLive'),false);
console.log('PASS live data: current owner totals/failures match Groq activity; bounded read-only polling; hidden-tab pause/resume; failure stays unknown; recovery after actual read; auth loss clears data and timers.');

// Mechanical counters show only actual target text, bound work to digit count,
// cancel an interrupted roll, and clear old decorative glyphs with auth state.
let rollingValue=9;
const roll=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok({...health,jobs:{...health.jobs,completed:rollingValue}}));
await flush();assert.equal(roll.get('completed').textContent,'9');assert.equal(roll.animations.length,0);
rollingValue=10;await roll.click('refresh');assert.equal(roll.get('completed').textContent,'10');assert.equal(roll.get('completed').attrs['aria-label'],'10');assert.equal(roll.animations.length,2);
assert.ok(roll.animations.every(a=>a.frames[0].transform==='translateY(100%)'&&a.options.duration+a.options.delay<=660));
const carryAnimations=[...roll.animations];await roll.click('refresh');assert.equal(roll.animations.length,2);assert.ok(carryAnimations.every(a=>!a.cancelled));
rollingValue=8;await roll.click('refresh');assert.ok(carryAnimations.every(a=>a.cancelled));assert.equal(roll.get('completed').textContent,'8');assert.equal(roll.animations.at(-1).frames[0].transform,'translateY(-100%)');
rollingValue=10000;await roll.click('refresh');assert.equal(roll.get('completed').textContent,'10000');assert.ok(roll.animations.length<=10);
await roll.click('motion');assert.ok(roll.animations.every(a=>a.cancelled));assert.equal(roll.get('completed').textContent,'10000');assert.ok(roll.get('completed').children.every(w=>w.children[0].dataset.from===undefined));
rollingValue=null;await roll.click('refresh');assert.equal(roll.get('completed').textContent,'—');assert.equal(roll.get('completed').attrs['aria-label'],'Unknown');assert.equal(roll.get('completed').children.length,0);
rollingValue=Number.MAX_SAFE_INTEGER;await roll.click('refresh');assert.equal(roll.get('completed').textContent,'—');assert.equal(roll.get('completed').attrs['aria-label'],'Unknown');
roll.wl.pagehide();assert.equal(roll.get('completed').textContent,'—');assert.equal(roll.get('completed').children.length,0);assert.equal(roll.get('completed').dataset.counterValue,undefined);
console.log('PASS mechanical counters: carry, decrease, unchanged read, interrupt, bounded large jump, exact accessible value, pause, unknown and auth clearing.');

let skyNow=100000;class SkyClock extends Date{constructor(...args){super(...(args.length?args:[skyNow]));}static now(){return skyNow;}}
const sky=harness(async path=>path==='/auth/state'?ok({enrolled:true}):ok(health),{clock:SkyClock});await flush();const skyReads=sky.requests.length,skyTimers=sky.timers.size;
for(let i=0;i<4;i++)await sky.click('logo-wrap');assert.notEqual(sky.get('console-surface').dataset.starfield,'true');await sky.click('logo-wrap');assert.equal(sky.get('console-surface').dataset.starfield,'true');assert.equal(sky.get('logo-wrap').attrs['aria-pressed'],'true');
for(let i=0;i<4;i++)await sky.click('logo-wrap');skyNow+=5001;await sky.click('logo-wrap');assert.equal(sky.get('console-surface').dataset.starfield,'true');for(let i=0;i<4;i++)await sky.click('logo-wrap');assert.equal(sky.get('console-surface').dataset.starfield,'false');assert.equal(sky.get('logo-wrap').attrs['aria-pressed'],'false');assert.equal(sky.requests.length,skyReads);assert.equal(sky.timers.size,skyTimers);
await sky.click('motion');assert.equal(sky.get('console-surface').dataset.motion,'off');await sky.click('motion');sky.pref.matches=true;sky.ml.change();assert.equal(sky.get('console-surface').dataset.motion,'off');sky.pref.matches=false;sky.ml.change();sky.document.visibilityState='hidden';sky.dl.visibilitychange();assert.equal(sky.get('console-surface').dataset.motion,'off');
console.log('PASS starfield: five deliberate activations toggle it, spaced clicks reset, no network/timers, and pause/reduced-motion/hidden-tab controls apply.');

const updateValue=state=>({v:1,enabled:true,state,requestedAt:null,finishedAt:null,retryAt:null});
let updateOutcome='idle',updatePosts=0;
const updates=harness(async(path,options)=>path==='/auth/state'?ok({enrolled:true}):path==='/updates'?(options.method==='POST'?(updatePosts++,ok(updateValue(updateOutcome='checking'))):ok(updateValue(updateOutcome))):ok(health));
await flush();await updates.click('nav-system');await flush();assert.equal(updates.get('update-check').disabled,false);
await updates.click('update-check');assert.equal(updatePosts,1);assert.equal(updates.get('update-check').disabled,true);assert.match(updates.get('update-request-state').textContent,/Checking for updates/);
updateOutcome='up_to_date';await updates.click('refresh');assert.equal(updates.get('update-request-state').textContent,'You’re up to date.');assert.equal(updatePosts,1);
updateOutcome='held';await updates.click('refresh');assert.equal(updates.get('update-check').disabled,true);assert.match(updates.get('update-request-state').textContent,/Operator review/);
await updates.click('logout');assert.equal(updates.get('update-request-state').textContent,'Not checked');assert.equal(updates.get('update-check').disabled,true);
let lostPosts=0;const lostUpdate=harness(async(path,options)=>path==='/auth/state'?ok({enrolled:true}):path==='/updates'?(options.method==='POST'?(lostPosts++,Promise.reject(Error('synthetic lost response'))):ok(updateValue('idle'))):ok(health));
await flush();await lostUpdate.click('nav-system');await flush();await lostUpdate.click('update-check');assert.equal(lostPosts,1);assert.equal(lostUpdate.get('update-check').textContent,'Check saved status');await lostUpdate.click('update-check');assert.equal(lostPosts,1);assert.equal(lostUpdate.requests.at(-1).options.method,'GET');
console.log('PASS owner updates: authenticated read and one POST, checking/outcome/hold, auth clearing and read-only recovery after lost response.');
