// Local candidate only. Linux/Node 24; no listener, enrollment side effects or host configuration.
import * as ownerAuthCrypto from 'node:crypto';
import * as ownerAuthUtil from 'node:util';
import * as ownerAuthFs from 'node:fs/promises';
import {constants as ownerAuthFsConstants} from 'node:fs';
import * as ownerAuthPath from 'node:path';
const ownerAuthCore=(()=>{
const {randomBytes,createHash,timingSafeEqual,scrypt:cryptoScrypt}=ownerAuthCrypto;
const {promisify}=ownerAuthUtil,fs=ownerAuthFs,constants=ownerAuthFsConstants,path=ownerAuthPath;
const scrypt=promisify(cryptoScrypt);
const HOUR=3600000, SESSION_MS=8*HOUR, WINDOW_MS=60000, MAX_ATTEMPTS=5, MAX_FILE=4096;
const PARAMS=Object.freeze({N:16384,r:8,p:1,maxmem:32*1024*1024});
const ERROR_CODES=new Set(['auth_failed','setup_unavailable','rate_limited','auth_unavailable']);
const deny=(code='auth_unavailable')=>Object.assign(new Error(code),{code});
const normalize=e=>ERROR_CODES.has(e?.code)?deny(e.code):deny();
const requestCheck=ok=>{if(!ok)throw deny('auth_failed');};
const check=ok=>{if(!ok)throw deny();};
const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const keys=(o,wanted)=>record(o)&&Object.keys(o).sort().join(',')===[...wanted].sort().join(',');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function encoded(s,n){return typeof s==='string'&&s.length===Math.ceil(n*8/6)&&/^[A-Za-z0-9_-]+$/.test(s)&&Buffer.from(s,'base64url').length===n&&Buffer.from(s,'base64url').toString('base64url')===s;}
function passwordBytes(password){requestCheck(typeof password==='string'&&password.length<=128);const bytes=Buffer.from(password,'utf8');requestCheck(bytes.length>=8&&bytes.length<=128&&bytes.toString('utf8')===password);return bytes;}
function validate(state,at){
 check(integer(at)&&keys(state,['v','phase','revision','lastSeenAt','rate',state?.phase==='bootstrap'?'bootstrap':'password',...(state?.phase==='enrolled'?['enrolledAt','session']:[])]));
 check(state.v===1&&['bootstrap','enrolled'].includes(state.phase)&&integer(state.revision)&&integer(state.lastSeenAt)&&state.lastSeenAt<=at);
 check(keys(state.rate,['windowStartedAt','attempts'])&&integer(state.rate.windowStartedAt)&&state.rate.windowStartedAt<=at&&integer(state.rate.attempts)&&state.rate.attempts<=MAX_ATTEMPTS);
 if(state.phase==='bootstrap'){
  const b=state.bootstrap;check(keys(b,['codeHash','createdAt','expiresAt'])&&hex(b.codeHash)&&integer(b.createdAt)&&integer(b.expiresAt)&&b.createdAt<=state.lastSeenAt&&b.expiresAt>b.createdAt&&b.expiresAt-b.createdAt<=HOUR);
 }else{
  check(integer(state.enrolledAt)&&state.enrolledAt<=state.lastSeenAt);
  const p=state.password;check(keys(p,['algorithm','N','r','p','salt','hash'])&&p.algorithm==='scrypt'&&p.N===PARAMS.N&&p.r===PARAMS.r&&p.p===PARAMS.p&&encoded(p.salt,16)&&encoded(p.hash,32));
  if(state.session!==null){const s=state.session;check(keys(s,['hash','createdAt','expiresAt'])&&hex(s.hash)&&integer(s.createdAt)&&integer(s.expiresAt)&&s.createdAt>=state.enrolledAt&&s.createdAt<=state.lastSeenAt&&s.expiresAt-s.createdAt===SESSION_MS);}
 }
 return state;
}
/** Pure administrator-side state builder; does not generate a code or write anything. */
function createBootstrapState({code,createdAt,expiresAt}){
 check(encoded(code,32));const state={v:1,phase:'bootstrap',revision:0,lastSeenAt:createdAt,rate:{windowStartedAt:createdAt,attempts:0},bootstrap:{codeHash:digest(code),createdAt,expiresAt}};
 return validate(state,createdAt);
}
function createOwnerAuth({stateDir,expectedUid=process.getuid?.(),now=Date.now}={}){
 check(process.platform==='linux'&&typeof stateDir==='string'&&path.isAbsolute(stateDir)&&path.resolve(stateDir)===stateDir&&integer(expectedUid)&&typeof now==='function');
 let inFlight=false;
 async function directory(){
  const pre=await fs.lstat(stateDir);check(pre.isDirectory()&&!pre.isSymbolicLink()&&pre.uid===expectedUid&&(pre.mode&0o777)===0o700&&await fs.realpath(stateDir)===stateDir);
  const dir=await fs.open(stateDir,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const st=await dir.stat();check(st.isDirectory()&&st.uid===expectedUid&&(st.mode&0o777)===0o700&&st.ino===pre.ino&&st.dev===pre.dev);return {dir,base:`/proc/self/fd/${dir.fd}`};}catch(e){await dir.close();throw e;}
 }
 async function read(ctx,at){
  const file=await fs.open(ctx.base+'/auth-state.json',constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const st=await file.stat({bigint:true});check(st.isFile()&&st.uid===BigInt(expectedUid)&&(st.mode&0o777n)===0o600n&&st.nlink===1n&&st.size<=BigInt(MAX_FILE));
   const buffer=Buffer.alloc(MAX_FILE+1);let total=0;
   while(total<buffer.length){const {bytesRead}=await file.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}
   const after=await file.stat({bigint:true});check(total<=MAX_FILE&&BigInt(total)===st.size&&st.size===after.size&&st.mtimeNs===after.mtimeNs&&st.ctimeNs===after.ctimeNs);
   return validate(JSON.parse(buffer.subarray(0,total).toString('utf8')),at);
  }finally{await file.close();}
 }
 async function persist(ctx,state,at){
  state.lastSeenAt=at;state.revision++;validate(state,at);
  const tmp=ctx.base+'/.auth-tmp-'+randomBytes(16).toString('hex');let made=false;
  try{const f=await fs.open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);made=true;try{await f.chmod(0o600);await f.writeFile(JSON.stringify(state));await f.sync();}finally{await f.close();}await fs.rename(tmp,ctx.base+'/auth-state.json');made=false;await ctx.dir.sync();}
  finally{if(made)await fs.unlink(tmp).catch(()=>{});}
 }
 async function locked(fn){
  if(inFlight)throw deny('rate_limited');inFlight=true;let ctx,locked=false;
  try{ctx=await directory();await fs.mkdir(ctx.base+'/.auth-lock',{mode:0o700});locked=true;const at=now();const state=await read(ctx,at);return await fn(ctx,state,at);}
  catch(e){throw normalize(e);}
  finally{if(locked)await fs.rmdir(ctx.base+'/.auth-lock').catch(()=>{});if(ctx)await ctx.dir.close();inFlight=false;}
 }
 async function attempt(ctx,state,at){
  if(at-state.rate.windowStartedAt>=WINDOW_MS)state.rate={windowStartedAt:at,attempts:0};
  if(state.rate.attempts>=MAX_ATTEMPTS)throw deny('rate_limited');state.rate.attempts++;await persist(ctx,state,at);
 }
 function session(state,at){const token=randomBytes(32).toString('base64url');state.session={hash:digest(token),createdAt:at,expiresAt:at+SESSION_MS};return {token,expiresAt:state.session.expiresAt};}
 function matches(state,token,at){return state.phase==='enrolled'&&encoded(token,32)&&state.session!==null&&state.session.createdAt<=at&&at<state.session.expiresAt&&equal(digest(token),state.session.hash);}
 async function publicRead(fn){let ctx;try{ctx=await directory();const at=now();return await fn(await read(ctx,at),at);}catch(e){throw normalize(e);}finally{if(ctx)await ctx.dir.close();}}
 return Object.freeze({
  async readPublicState(){return publicRead((state,at)=>{if(state.phase==='bootstrap'&&at>=state.bootstrap.expiresAt)throw deny('setup_unavailable');return {enrolled:state.phase==='enrolled'};});},
  async setup(input){
   let bytes,code;try{requestCheck(keys(input,['code','password']));code=input.code;bytes=passwordBytes(input.password);requestCheck(encoded(code,32));}catch(e){if(bytes)bytes.fill(0);throw normalize(e);}
   try{return await locked(async(ctx,state,at)=>{
    if(state.phase!=='bootstrap'||at>=state.bootstrap.expiresAt)throw deny('setup_unavailable');await attempt(ctx,state,at);requestCheck(equal(digest(code),state.bootstrap.codeHash));
    const salt=randomBytes(16),derived=await scrypt(bytes,salt,32,PARAMS);
    const completedAt=now();check(integer(completedAt)&&completedAt>=at);if(completedAt>=state.bootstrap.expiresAt)throw deny('setup_unavailable');
    state.phase='enrolled';state.password={algorithm:'scrypt',N:PARAMS.N,r:PARAMS.r,p:PARAMS.p,salt:salt.toString('base64url'),hash:derived.toString('base64url')};derived.fill(0);delete state.bootstrap;state.enrolledAt=completedAt;
    const result=session(state,completedAt);await persist(ctx,state,completedAt);return result;
   });}finally{bytes.fill(0);}
  },
  async login(input){
   let bytes;try{requestCheck(keys(input,['password']));bytes=passwordBytes(input.password);}catch(e){if(bytes)bytes.fill(0);throw normalize(e);}
   try{return await locked(async(ctx,state,at)=>{
    if(state.phase!=='enrolled')throw deny('auth_failed');await attempt(ctx,state,at);
    const derived=await scrypt(bytes,Buffer.from(state.password.salt,'base64url'),32,PARAMS);let valid;try{valid=equal(derived.toString('base64url'),state.password.hash);}finally{derived.fill(0);}requestCheck(valid);
    const completedAt=now();check(integer(completedAt)&&completedAt>=at);const result=session(state,completedAt);await persist(ctx,state,completedAt);return result;
   });}finally{bytes.fill(0);}
  },
  async authenticate(token,{fresh=false}={}){if(!encoded(token,32))return false;try{return await publicRead((state,at)=>matches(state,token,at)&&(!fresh||at-state.session.createdAt<300000));}catch{return false;}},
  async logout(token){if(!encoded(token,32))return false;return locked(async(ctx,state,at)=>{if(!matches(state,token,at))return false;state.session=null;await persist(ctx,state,at);return true;});},
 });
}

return {createOwnerAuth,createBootstrapState};
})();
export const createOwnerAuth=ownerAuthCore.createOwnerAuth;
export const createBootstrapState=ownerAuthCore.createBootstrapState;

import {createRuntimeControl,createUpdateRequestBridge,AVAILABILITY_CODES,readUpdaterActivity} from './runtime-control.mjs';
import {groqReplacementId,groqReplacementKey} from './admission-runtime.mjs';
// In tribute to Sir Patrick Stewart. Make it so.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,openSync,readSync,closeSync,fstatSync,constants as fsConstants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRelayStore,JOB_REASON_CODES} from './relay-store.mjs';
import {createReceiver,healthDiagnostics} from './receiver.mjs';
import {createSelectedAssistantAdapter} from './selected-assistant.mjs';
import {createDispatcher} from './dispatcher.mjs';
import {validConfig} from './protocol.mjs';
import {fetchContributorCredits} from './https-fetch.mjs';

// Opt-in console is protected by the administrator's HTTPS reverse proxy.
// It exposes only a projection, never the ledger/control object or credentials.
// Fixed, bounded public-kernel reads; no process list, agent, subprocess or timer.
function readVmProc(kind){
 const cpu=kind==='cpu',file=cpu?'/proc/stat':'/proc/meminfo',limit=cpu?1024:16384;
 const fd=openSync(file,'r');
 try{const buffer=Buffer.alloc(limit+1),bytes=readSync(fd,buffer,0,buffer.length,0),text=buffer.subarray(0,bytes).toString('ascii');
  if(cpu){const end=text.indexOf('\n');if(end<0)throw Error('cpu_sample');return text.slice(0,end);}
  if(bytes>limit)throw Error('memory_sample');return text;
 }finally{closeSync(fd);}
}
export function parseVmCpu(text){
 if(typeof text!=='string'||text.length>1024||!/^cpu[ \t]+\d+(?:[ \t]+\d+){7,9}[ \t]*$/.test(text))return null;
 const values=text.trim().split(/[ \t]+/).slice(1).map(Number);
 if(!values.every(n=>Number.isSafeInteger(n)&&n>=0))return null;
 // Guest ticks are already included in user/nice. Count the first eight once.
 const ticks=values.slice(0,8),total=ticks.reduce((a,b)=>a+b,0),idle=ticks[3]+ticks[4];
 return Number.isSafeInteger(total)&&Number.isSafeInteger(idle)?{ticks,total,idle}:null;
}
export function parseVmMemory(text){
 if(typeof text!=='string'||text.length>16384)return null;
 const read=name=>{const matches=[...text.matchAll(new RegExp('^'+name+':[ \\t]+(\\d+)[ \\t]+kB[ \\t]*$','gm'))];return matches.length===1?Number(matches[0][1])*1024:NaN;};
 const total=read('MemTotal'),available=read('MemAvailable');
 return Number.isSafeInteger(total)&&total>0&&Number.isSafeInteger(available)&&available>=0&&available<=total?{memoryUsedBytes:total-available,memoryTotalBytes:total}:null;
}
export function createVmTelemetry({now=Date.now,monotonic=()=>Number(process.hrtime.bigint()/1000000n),readProc=readVmProc,readRss=()=>process.memoryUsage.rss()}={}){
 let previous=null,cached=null,lastAttempt=null;
 return ()=>{
  const at=now(),tick=monotonic(),integer=n=>Number.isSafeInteger(n)&&n>=0;
  if(!integer(at)||!integer(tick))return null;
  if(cached&&lastAttempt!==null&&tick>=lastAttempt&&tick-lastAttempt<15000)return cached;
  let cpu=null,memory=null,rss=null,cpuPercent=null;
  try{cpu=parseVmCpu(readProc('cpu'));}catch{}
  try{memory=parseVmMemory(readProc('memory'));}catch{}
  try{const value=readRss();if(integer(value)&&(memory===null||value<=memory.memoryTotalBytes))rss=value;}catch{}
  if(cpu&&previous&&tick>previous.tick&&tick-previous.tick<60000&&cpu.ticks.every((value,i)=>value>=previous.cpu.ticks[i])){
   const total=cpu.total-previous.cpu.total,idle=cpu.idle-previous.cpu.idle;
   if(total>0&&idle>=0&&idle<=total)cpuPercent=Math.round((total-idle)/total*1000)/10;
  }
  previous=cpu?{cpu,tick}:null;lastAttempt=tick;
  cached=Object.freeze({v:1,scope:'vm',observedAtMs:at,cpuPercent,memoryUsedBytes:memory?.memoryUsedBytes??null,memoryTotalBytes:memory?.memoryTotalBytes??null,relayMemoryBytes:rss});
  return cached;
 };
}
// Generated through Picard; reviewed to reject arrays and preserve unknowns.
export function summarizeVmPower(sample,nowMs){
 const integer=n=>Number.isSafeInteger(n)&&n>=0,unknown=()=>({state:'unknown',label:'VM CPU',value:null,memoryPercent:null});
 if(!integer(nowMs)||sample===null||typeof sample!=='object'||Array.isArray(sample))return unknown();
 const {observedAtMs,cpuPercent,memoryUsedBytes,memoryTotalBytes}=sample;
 if(!integer(observedAtMs)||nowMs-observedAtMs< -5000||nowMs-observedAtMs>=60000||typeof cpuPercent!=='number'||!Number.isFinite(cpuPercent)||cpuPercent<0||cpuPercent>100)return unknown();
 const memoryPercent=integer(memoryUsedBytes)&&integer(memoryTotalBytes)&&memoryTotalBytes>0&&memoryUsedBytes<=memoryTotalBytes?Math.round(memoryUsedBytes/memoryTotalBytes*100):null;
 return {state:'ready',label:'VM CPU',value:Math.round(cpuPercent),memoryPercent};
}
export function consoleSnapshot(health,rows,now=new Date(),scope='task',resources=null,groqKeyExpiresAt){
 const flag=name=>typeof health?.[name]==='boolean'?health[name]:null;
 const diagnostic=healthDiagnostics({rows,runtimeHealth:health});
 const jobs=Object.fromEntries(['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].map(state=>[state,diagnostic.ledgerStateCounts?.[state]??null]));
 const verified=health?.updateReady===true&&diagnostic.release.hash!==null;
 const version=verified&&typeof health?.releaseVersion==='string'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(health.releaseVersion)?health.releaseVersion:null;
 const sequence=verified&&Number.isSafeInteger(health?.releaseSequence)&&health.releaseSequence>0?health.releaseSequence:null;
 const sourceCommit=verified&&typeof health?.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(health.sourceCommit)?health.sourceCommit:null;
 const blockingCode=AVAILABILITY_CODES.includes(health?.blockingCode)?health.blockingCode:'unknown';
 const result={v:1,scope:scope==='owner'?'owner':'task',service:{ready:flag('serviceReady'),resultRecoveryReady:flag('resultRecoveryReady'),providerReady:flag('providerReady'),acceptingNewWork:flag('acceptingNewWork'),draining:flag('draining'),blockingCode},jobs,release:{hash:diagnostic.release.hash,version,sequence,sourceCommit},updater:readUpdaterActivity({now:now.getTime()}),observedAt:now.toISOString()};
 if(groqKeyExpiresAt!==undefined){
  const known=flag('serviceReady')===true&&!['configuration_unavailable','catalogue_unavailable'].includes(blockingCode);
  result.groqKeyExpiresAt=known&&Number.isSafeInteger(groqKeyExpiresAt)&&groqKeyExpiresAt>=0&&groqKeyExpiresAt<=8640000000000000?groqKeyExpiresAt:null;
 }
 if(resources?.v===1&&resources.scope==='vm'){
  const integer=n=>Number.isSafeInteger(n)&&n>=0;
  result.resources={v:1,scope:'vm',observedAtMs:integer(resources.observedAtMs)?resources.observedAtMs:null,cpuPercent:typeof resources.cpuPercent==='number'&&Number.isFinite(resources.cpuPercent)&&resources.cpuPercent>=0&&resources.cpuPercent<=100?resources.cpuPercent:null};
  for(const name of ['memoryUsedBytes','memoryTotalBytes','relayMemoryBytes'])result.resources[name]=integer(resources[name])?resources[name]:null;
 }
 return result;
}
export function consoleJobsSnapshot(page,now=new Date()){
 const unavailable=()=>{throw Error('job_history_unavailable');};
 if(!page||!Array.isArray(page.rows)||page.rows.length>50||!(page.nextCursor===null||typeof page.nextCursor==='string'&&page.nextCursor.length<=256&&/^[A-Za-z0-9_-]+$/.test(page.nextCursor)))unavailable();
 const states=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain','unknown'];
 const rows=page.rows.map(row=>{if(!row||!/^[a-f0-9]{64}$/.test(row.ref??'')||!states.includes(row.state)||typeof row.resultAvailable!=='boolean'||!JOB_REASON_CODES.includes(row.reasonCode))unavailable();const time=value=>value===null||Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?value:null;return {ref:row.ref,state:row.state,createdAt:time(row.createdAt),updatedAt:time(row.updatedAt),resultAvailable:row.resultAvailable,reasonCode:row.reasonCode};});
 if(new Set(rows.map(row=>row.ref)).size!==rows.length)unavailable();const result={v:1,rows,nextCursor:page.nextCursor,observedAt:now.toISOString()};if(Buffer.byteLength(JSON.stringify(result))>16384)unavailable();return result;
}
function recognitionSummary(credits){
 if(!credits||Object.keys(credits).sort().join(',')!=='captures,kills')return null;
 const {kills,captures}=credits;
 if(![kills,captures].every(ids=>Array.isArray(ids)&&ids.length<=100&&ids.every(id=>Number.isSafeInteger(id)&&id>0)))return null;
 const ids=[...kills,...captures];
 if(new Set(ids).size!==ids.length)return null;
 if(!ids.length)return '';
 return kills.length+' Kill'+(kills.length===1?'':'s')+' · '+captures.length+' Capture'+(captures.length===1?'':'s');
}

export function contributionRecognition(value){
 if(typeof value!=='string'||value.length>4096)return '';
 try{return recognitionSummary(JSON.parse(value))??'';}catch{return '';}
}

// Status reads can start a check, but always return immediately from local memory.
export function createContributionRecognition({login,lookup=fetchContributorCredits,now=()=>performance.now()}){
 const lifetime=new AbortController();
 const interval=10*60*1000;
 let nextCheck=0,pending=false,summary='';
 async function refresh(){
  try{
   const verified=recognitionSummary(await lookup(login,{signal:lifetime.signal}));
   if(verified!==null&&!lifetime.signal.aborted)summary=verified;
  }catch{/* Keep the last complete GitHub observation. */}
  finally{pending=false;}
 }
 return {
  read(){
   const at=now();
   if(!lifetime.signal.aborted&&!pending&&at>=nextCheck){
    nextCheck=at+interval;
    pending=true;
    void refresh();
   }
   return summary;
  },
  close(){lifetime.abort();}
 };
}

function codexUsageTokenHash(path){
 const fd=openSync(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.size<64||stat.size>66||(process.getuid&&(stat.uid!==process.getuid()||(stat.mode&0o077))))throw Error('codex_usage_token_invalid');
  const bytes=Buffer.alloc(67);
  try{
   const token=bytes.subarray(0,readSync(fd,bytes)).toString('utf8').trimEnd();
   if(!/^[a-f0-9]{64}$/.test(token))throw Error('codex_usage_token_invalid');
   return createHash('sha256').update(token).digest();
  }finally{bytes.fill(0);}
 }finally{closeSync(fd);}
}

export function createConsoleHandler({enabled=false,html='',getSnapshot,getRecentJobs,auth=null,origins=[],updates=createUpdateRequestBridge(),groqReplacement=null,recognition='',codexUsage=null,codexUsageKey=null}={}){
 if(typeof html!=='string'||Buffer.byteLength(html)>166912)throw Error('console_document_invalid');
 const hash=s=>"'sha256-"+createHash('sha256').update(s).digest('base64')+"'";
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>hash(m[1]));
 const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>hash(m[1]));
 const csp="default-src 'none'; script-src "+(scripts.join(' ')||"'none'")+"; style-src "+(styles.join(' ')||"'none'")+"; connect-src 'self'; img-src 'none'; font-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
 const headers={'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp,'Cross-Origin-Resource-Policy':'same-origin'};
 const allowed=new Set(Array.isArray(origins)?origins.filter(value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password;}catch{return false;}}):[]);
 const tokenFrom=req=>{const raw=req.headers.cookie;if(typeof raw!=='string'||raw.length>4096)return null;const matches=raw.split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-PicardSession='));if(matches.length!==1)return null;const token=matches[0].slice('__Host-PicardSession='.length);return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;};
 const cookie=(token,seconds)=>`__Host-PicardSession=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
 return async(req,res)=>{
  const path=req.url;
   const jobsPath=typeof path==='string'&&path.length<=1024&&/^\/jobs(?:\?[^#]*)?$/.test(path);
   const usageWrite=path==='/codex/usage'&&req.method==='POST'&&codexUsage&&codexUsageKey;
   if(!enabled||!(usageWrite||(req.method==='GET'&&(['/','/status','/auth/state','/updates','/groq/key'].includes(path)||jobsPath))||(req.method==='POST'&&['/auth/setup','/auth/login','/auth/logout','/updates','/groq/key'].includes(path))))return false;
  const reply=(status,body,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(body));return true;};
  let origin=null;try{const host=req.headers.host;if(typeof host==='string'){const u=new URL('https://'+host);if(u.host===host&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password)origin=u.origin;}}catch{}
  if(!origin||!allowed.has(origin))return reply(403,{error:'auth_failed'});
  if(usageWrite){
   if(req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined)return reply(403,{error:'auth_failed'});
   const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??'');
   if(!match||!ownerAuthCrypto.timingSafeEqual(createHash('sha256').update(match[1]).digest(),codexUsageKey))return reply(401,{error:'auth_failed'});
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(400,{error:'request_invalid'});
   const parts=[];let size=0;
   try{
    for await(const chunk of req){size+=chunk.length;if(size>4096)return reply(413,{error:'request_invalid'});parts.push(chunk);}
    let record;try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{return reply(400,{error:'request_invalid'});}
    const state=codexUsage.record(record);
    return reply({saved:201,duplicate:200,invalid:400,conflict:409}[state],{state});
   }catch{return reply(503,{error:'codex_usage_unavailable'});}
  }
  if(req.method==='POST'&&(req.headers.origin!==origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])))return reply(403,{error:'auth_failed'});
  if(path==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(html);return true;}
  if(!auth)return reply(503,{error:'auth_unavailable'});
  try{
   if(path==='/auth/state'){const state=await auth.readPublicState();if(typeof state?.enrolled!=='boolean')throw Error('auth_unavailable');return reply(200,{enrolled:state.enrolled});}
   if(path==='/status'){
    if(!await auth.authenticate(tokenFrom(req)))return reply(401,{error:'auth_failed'});
    const snapshot=getSnapshot();
    const display=typeof recognition==='function'?recognition():recognition;
    const keyReplacement=groqReplacement?.status();
    let usage;
    if(codexUsage){try{usage={state:'ready',runs:codexUsage.list()};}catch{usage={state:'unavailable',runs:[]};}}
    return reply(200,{...snapshot,...(display?{recognition:display}:{}),...(keyReplacement?.enabled?{keyReplacement}:{}),...(usage?{codexUsage:usage}:{})});
   }
   if(path==='/updates'){
    if(!await auth.authenticate(tokenFrom(req)))return reply(401,{error:'auth_failed'});
    if(req.headers.origin!==undefined&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'auth_failed'});
    if(req.method==='GET')return reply(200,updates.status());
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(400,{error:'request_invalid'});
    let bytes=0,parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>64)return reply(413,{error:'request_invalid'});parts.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply(400,{error:'request_invalid'});}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return reply(400,{error:'request_invalid'});
    try{return reply(202,updates.request());}catch(e){const code=['update_not_connected','update_checking','update_unknown','update_held','update_cooldown'].includes(e.code)?e.code:'update_not_connected';return reply(code==='update_cooldown'?429:code==='update_not_connected'?503:409,{error:code});}
   }
   if(path==='/groq/key'){
    const token=tokenFrom(req);
    if(!await auth.authenticate(token))return reply(401,{error:'auth_failed'});
    if((req.headers.origin!==undefined&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'auth_failed'});
    const status=groqReplacement?.status()??{v:1,enabled:false,project:'',state:'unavailable',id:null};
    if(req.method==='GET')return reply(200,{...status,recent:status.enabled&&await auth.authenticate(token,{fresh:true})});
    if(!status.enabled)return reply(503,{error:'key_replacement_unavailable'});
    if(!await auth.authenticate(token,{fresh:true}))return reply(428,{error:'key_replacement_sign_in'});
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(400,{error:'request_invalid'});
    let bytes=0;const parts=[];
    for await(const chunk of req){
     bytes+=chunk.length;if(bytes>1024){for(const part of parts)part.fill(0);return reply(413,{error:'request_invalid'});}
     parts.push(Buffer.from(chunk));
    }
    let body;const raw=Buffer.concat(parts);
    try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{return reply(400,{error:'request_invalid'});}
    finally{raw.fill(0);for(const part of parts)part.fill(0);}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='free,id,key'
     ||body.free!==true||!groqReplacementId(body.id)||!groqReplacementKey(body.key))return reply(400,{error:'request_invalid'});
    try{return reply(202,await groqReplacement.request(body));}
    catch(e){const code=['key_replacement_unavailable','key_replacement_busy'].includes(e.message)?e.message:'key_replacement_unknown';return reply(code==='key_replacement_busy'?409:503,{error:code});}
   }
    if(jobsPath){
     if(!await auth.authenticate(tokenFrom(req)))return reply(401,{error:'auth_failed'});
     if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin!==undefined&&req.headers.origin!==origin)return reply(403,{error:'auth_failed'});
     const query=new URL(path,'https://console.invalid').searchParams;
     if([...query.keys()].some(key=>!['limit','cursor'].includes(key))||query.getAll('limit').length>1||query.getAll('cursor').length>1||query.has('limit')&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.get('limit'))||query.has('cursor')&&(!/^[A-Za-z0-9_-]+$/.test(query.get('cursor'))||query.get('cursor').length>256))return reply(400,{error:'history_query_invalid'});
     try{return reply(200,consoleJobsSnapshot(await getRecentJobs({limit:query.has('limit')?Number(query.get('limit')):25,cursor:query.get('cursor')})));}catch{return reply(503,{error:'job_history_unavailable'});}
    }
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(400,{error:'auth_failed'});
   let size=0,parts=[];for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>1024)return reply(413,{error:'auth_failed'});parts.push(bytes);}
   let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{return reply(400,{error:'auth_failed'});}
   const fields=path==='/auth/setup'?['password','setupCode']:path==='/auth/login'?['password']:[];
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!==fields.join(',')||fields.some(k=>typeof body[k]!=='string'))return reply(400,{error:'auth_failed'});
   if(path==='/auth/logout'){await auth.logout(tokenFrom(req));return reply(200,{ok:true},{'Set-Cookie':cookie('',0)});}
   const result=path==='/auth/setup'?await auth.setup({code:body.setupCode,password:body.password}):await auth.login({password:body.password});
   if(!result||!/^[A-Za-z0-9_-]{43}$/.test(result.token??'')||!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=Date.now())throw Error('auth_unavailable');
   return reply(200,{ok:true},{'Set-Cookie':cookie(result.token,Math.min(28800,Math.floor((result.expiresAt-Date.now())/1000)))});
  }catch(error){const code=['auth_failed','setup_unavailable','rate_limited'].includes(error?.code)?error.code:'auth_unavailable';return reply(code==='auth_failed'?401:code==='setup_unavailable'?409:code==='rate_limited'?429:503,{error:code});}
 };
}
// Buildless console; published source contains no configuration or credentials.
// Counter glyphs are decoration. Expose the observed value immediately.
// A job restored from its route stays visible across filters.
// Only exposed cockpit glass retracts the deck, preserving drafts and results.
const CONSOLE_SHELL_HTML="<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"color-scheme\" content=\"dark\"><title>Picard Relay — Console</title>\n<style>:root{color-scheme:dark;--bg:#101416;--side:#161c1f;--surface:#1b2225;--line:#303b3f;--text:#eeefe9;--muted:#a5b0b3;--accent:#dec387;--good:#a6d5bd;--warn:#efc185}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}button,input,select{font:inherit}button{color:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}button{border:1px solid var(--line);border-radius:4px;background:transparent;padding:9px 14px;min-height:44px}button:hover:not(:disabled){background:#ffffff08;border-color:#758084}h1,h2,h3,p{margin:0}h1{font-size:32px;line-height:1.2;font-weight:600;letter-spacing:-.035em}h2{font-size:20px;font-weight:500;letter-spacing:-.02em}h3{font-size:14px;font-weight:550}.brand{display:flex;align-items:center;gap:13px}.brand p{font-weight:600;letter-spacing:-.02em;font-size:18px}.brand small,.muted,.subtle{color:var(--muted);font-size:13px}.logo-wrap{width:36px;flex:none;perspective:200px}.logo{display:block;margin:0;font:1.2px/1.7px ui-monospace,Consolas,monospace;white-space:pre;color:var(--accent);transform-origin:center;animation:turn 18s linear infinite;animation-play-state:paused}.logo-wrap.running .logo{animation-play-state:running}.motion{margin-top:auto;text-align:left;font-size:13px;color:var(--muted);padding:9px 12px;border:0}.workspace{min-width:0;padding:24px 40px 28px;max-width:1320px;width:100%;margin:0 auto}.eyebrow{color:var(--muted);font:11px ui-monospace,Consolas,monospace;letter-spacing:.13em;text-transform:uppercase}.refresh{background:var(--accent);color:#172023;border-color:var(--accent);font-size:13px;font-weight:550}.refresh:hover:not(:disabled){background:#e8d19f;color:#172023}.view-head{margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.view-head p{color:var(--muted);margin-top:8px;font-size:13px}.signal{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:22px 0 12px;border-top:1px solid var(--line)}.signal h2{font-size:17px;font-weight:550}.signal h2:before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);margin:0 9px 2px 0}.signal h2[data-tone=good]:before{background:var(--good)}.signal h2[data-tone=warn]:before{background:var(--warn)}.signal p{font-size:13px;color:var(--muted)}.readiness{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:6px 0 22px}.readiness dt,dt{color:var(--muted);font-size:13px}.readiness dd{font-size:13px;margin:6px 0 0}.good{color:var(--good)}.notice{font-size:13px;color:var(--warn);margin:16px 0}.blocking{border-left:2px solid var(--accent);padding:10px 14px;background:#dec38707;color:var(--warn);font-size:13px;margin:0 0 24px;max-width:900px}.counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0 0 28px;padding:21px 0 24px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.counts div{padding-left:25px;border-left:1px solid var(--line)}.counts div:first-child{padding-left:0;border:0}.counts dd{font:46px/1.3 ui-monospace,Consolas,monospace;margin:6px 0 0;letter-spacing:-.06em;overflow:hidden}.counts .unknown{color:var(--muted)}.section-title{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:15px}.section-title p{font-size:13px;color:var(--muted)}.activity{list-style:none;margin:0;padding:0}.activity li{padding:14px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;font-size:13px}.activity-ref,.job-ref{font:14px/1.5 system-ui,sans-serif;color:var(--text);min-width:0;overflow-wrap:anywhere}.activity-state{font-size:13px;color:var(--muted);flex-shrink:0}.scope-note{color:var(--muted);font-size:13px;margin:14px 0 25px}.section-action{font-size:13px;color:var(--accent);border:0;padding:0}.jobs-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:17px}.jobs-toolbar label{font-size:13px;color:var(--muted)}select{max-width:100%;background:var(--side);color:var(--text);padding:8px 10px;border:1px solid var(--line);border-radius:4px}.jobs-toolbar .muted{margin-left:auto;font-size:13px}.jobs-workspace{display:grid;grid-template-columns:minmax(0,1fr) 258px;gap:26px}.job-columns,.job-row{display:grid;grid-template-columns:minmax(0,1fr) 115px 150px;gap:12px;align-items:center}.job-columns{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.1em;padding:10px 12px;border-bottom:1px solid var(--line)}.job-list{list-style:none;margin:0;padding:0}.job-list li{border-bottom:1px solid var(--line)}.job-row{width:100%;border:0;border-radius:0;text-align:left;padding:16px 12px;font-size:13px}.job-row[aria-pressed=true]{background:#dec3870d;box-shadow:inset 2px 0 var(--accent)}.job-list [data-state=uncertain] .job-state{color:var(--warn)}.job-time{font-size:13px;color:var(--muted);text-align:right}.job-inspector{border-left:1px solid var(--line);padding-left:24px;min-width:0}.job-inspector h3{margin-bottom:12px}.job-inspector p{color:var(--muted);font-size:13px;margin-bottom:18px}.metadata{margin:0;display:grid;grid-template-columns:1fr;gap:6px}.metadata dd{margin:0 0 12px;overflow-wrap:anywhere;font-size:13px}.full-ref{font:13px/1.6 ui-monospace,Consolas,monospace}.empty{padding:20px 0;color:var(--muted);font-size:13px}.policy{display:grid;grid-template-columns:170px 1fr;gap:18px 30px;padding:23px 0;border-top:1px solid var(--line);margin:0}.policy dd{margin:0;font-size:13px;min-width:0;overflow-wrap:anywhere}.policy dt{font-size:13px}.policy p{font-size:13px;color:var(--muted);margin-top:5px}.groq-status{display:flex;gap:12px;align-items:center;margin:0 0 25px}.status-mark{width:8px;height:8px;background:var(--accent);border-radius:50%}.system-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px}.system-grid .policy{grid-template-columns:100px 1fr;gap:16px}.fingerprint{font:13px/1.8 ui-monospace,Consolas,monospace;overflow-wrap:anywhere;color:var(--muted);padding:18px 0}.technical{margin-top:32px;border-top:1px solid var(--line);padding-top:19px}.technical h3{margin-bottom:8px}.footer{border-top:1px solid var(--line);padding-top:18px;margin-top:40px;display:flex;justify-content:space-between;gap:15px;font-size:13px;color:var(--muted)}.footer .motto{color:var(--accent);letter-spacing:.1em;white-space:nowrap}.auth{max-width:430px;padding:45px 0 70px}.auth h2{font-size:28px;margin-bottom:10px}.auth>p{color:var(--muted);font-size:13px;margin-bottom:26px}.auth label{display:block;font-size:13px;color:var(--muted);margin:17px 0 7px}.auth input{display:block;width:100%;background:var(--side);border:1px solid #5c696e;color:var(--text);padding:11px 13px;border-radius:4px;font:16px system-ui}.auth .hint{font-size:13px;color:var(--muted);margin-top:8px}.auth-submit{background:var(--accent);color:#172023;border:0;margin-top:25px;font-weight:550}.auth-message{color:var(--warn);font-size:13px;margin-top:20px}.auth .retry{margin-top:15px}@keyframes turn{to{transform:rotateY(360deg)}}@media(prefers-reduced-motion:reduce){.logo,.logo-wrap.running .logo{animation:none!important;transform:none!important}}@media(min-width:1100px){.workspace{align-self:start}}@media(max-width:1100px){.workspace{padding:26px}.jobs-workspace{grid-template-columns:1fr}.job-inspector{border-left:0;border-top:1px solid var(--line);padding:22px 0 0}.metadata{grid-template-columns:110px minmax(0,1fr)}.metadata dd{margin:0 0 10px}}@media(max-width:700px){.brand{gap:10px}.brand p{font-size:15px}.logo-wrap{width:25px}.logo{font-size:.9px;line-height:1.2px}.workspace{padding:20px}.eyebrow{font-size:13px}.view-head{margin-bottom:22px}h1{font-size:26px}.signal{align-items:flex-start;flex-direction:column;gap:6px;padding-top:18px}.readiness{grid-template-columns:1fr 1fr;gap:15px}.counts div{padding-left:13px}.counts dd{font-size:31px}.counts dt{font-size:13px}.scope-note{font-size:13px}.job-columns,.job-row{grid-template-columns:minmax(0,1fr) 90px;gap:8px}.job-columns span:last-child{display:none}.job-time{grid-column:1/-1;text-align:left;font-size:13px}.job-row{padding:13px 10px}.jobs-toolbar .muted{margin:0;width:100%}.policy{grid-template-columns:120px minmax(0,1fr);gap:16px}.system-grid{grid-template-columns:1fr;gap:28px}.metadata{grid-template-columns:90px minmax(0,1fr)}.footer{flex-direction:column;gap:8px;margin-top:30px}.auth{padding-top:24px}.section-title p{display:none}}@media(max-width:360px){.workspace{padding:16px}.counts div{padding-left:9px}.counts dd{font-size:27px}.counts dt{font-size:13px}.brand small{font-size:13px}.eyebrow{letter-spacing:.06em}}.system-grid h2,.technical h2,.job-inspector h2,.section-title h2{font-size:16px;font-weight:550}.system-grid h2,.technical h2,.job-inspector h2{margin-bottom:12px}.updater-explanation{margin-top:22px;max-width:65ch}.view-head button{flex-shrink:0}.footer{font-size:13px}.signal p{max-width:100%;overflow-wrap:anywhere}@media(max-width:700px){.view-head{flex-wrap:wrap;gap:12px}.view-head button{white-space:nowrap}.eyebrow{font-size:11px}}.provider-activity{margin:28px 0}.provider-activity h2{font-size:16px}.provider-activity .readiness{margin-top:18px}.technical summary{cursor:pointer;color:var(--accent);padding:12px 0}.technical .policy{margin-top:18px}@media(min-width:701px){.counts{grid-template-columns:repeat(5,minmax(0,1fr))}}@media(max-width:700px){.counts{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:18px}.counts div:nth-child(odd){border-left:0;padding-left:0}}.counts dd.counter-number{display:flex;align-items:baseline;color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:-.04em;overflow-x:auto;overflow-y:hidden;max-width:100%;scrollbar-width:thin}.counter-window{display:inline-block;flex:none;width:.63em;height:1.3em;overflow:hidden;vertical-align:bottom}.counter-reel{display:block;position:relative;line-height:1.3em;will-change:auto}.counter-reel[data-from]::before{content:attr(data-from);position:absolute;left:0;top:-100%;color:var(--accent)}.counter-reel[data-direction=down]::before{top:100%}@media(prefers-reduced-motion:reduce){.counter-reel{transform:none!important}.counter-reel::before{display:none!important}}.brand small{letter-spacing:.08em;font-size:11px;text-transform:uppercase}.logo-wrap{position:relative}.logo-wrap{width:54px}.logo-wrap pre.logo{width:max-content;margin:auto}.rank-logo{display:none;width:54px;height:65px}.rank-upgrade{display:none}.logo-wrap[data-rank=\"lieutenant\"] .rank-upgrade{display:block}.logo-wrap[data-rank=\"lieutenant\"] .rank-logo{color:#f4dfa8}#private{animation:console-online 280ms ease-out}#private>section{animation:none}#private[data-motion=\"off\"],#private[data-motion=\"off\"]>section{animation:none}@keyframes console-online{from{opacity:.35}to{opacity:1}}@media(prefers-reduced-motion:reduce){#private,#private>section{animation:none!important}}@media(max-width:700px){.brand small{font-size:10px}.logo-wrap{width:38px}.rank-logo{width:38px;height:46px}}.footer{border:0;margin-top:16px;padding-top:0;justify-content:flex-end;align-items:flex-end}.console-info{position:relative}.console-info summary{display:grid;place-items:center;width:44px;height:44px;cursor:pointer;list-style:none;color:var(--muted)}.console-info summary::-webkit-details-marker{display:none}.console-info summary span{display:grid;place-items:center;width:18px;height:18px;border:1px solid currentColor;border-radius:50%;font:12px Georgia,serif}.console-info summary:hover{color:var(--accent)}.console-info summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.info-panel{position:absolute;bottom:calc(100% + 8px);right:0;width:300px;max-width:calc(100vw - 32px);padding:16px;background:var(--side);border:1px solid var(--line);border-radius:4px;box-shadow:0 8px 20px #0005;z-index:5}.info-panel p,.info-panel .scope-note{font-size:12px;line-height:1.6;color:var(--muted);margin:0}.info-panel p+p{margin-top:12px}.scope-note:empty{display:none}.activity li,.job-list li{border-bottom-color:#080b0d;box-shadow:0 1px 0 #ffffff07}.signal,.policy,.technical,.request-review-form,.request-setup{border-top-color:#080b0d;box-shadow:inset 0 1px 0 #ffffff06}.counts{border-color:#080b0d;box-shadow:inset 0 1px 0 #ffffff06,0 1px 0 #ffffff07}.counts div+div{border-left-color:#080b0d;box-shadow:inset 1px 0 #ffffff06}.refresh,.request-primary{box-shadow:inset 0 1px 0 #ffffff35,inset 0 -1px 0 #0004,0 1px 2px #0003}.refresh:active,.request-primary:active{box-shadow:inset 0 2px 3px #0005}@media(max-width:700px){.counts div:nth-child(odd){box-shadow:none}}.logo-wrap{display:grid;place-items:center;min-height:65px;padding:0;border:0;background:transparent}.logo-wrap:hover:not(:disabled){background:transparent;border-color:transparent}.workspace{position:relative;z-index:1}@media(max-width:700px){.logo-wrap{min-height:46px}}.workspace{max-width:1160px;width:calc(100% - 64px);margin:24px auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 28px #0008,inset 0 1px #ffffff04}@media(max-width:700px){.workspace{width:calc(100% - 16px);margin:12px 8px;padding:18px 14px;border-radius:6px}}@media(max-width:700px){.info-panel{max-width:calc(100vw - 64px)}}.logo-wrap pre.logo,.logo-wrap[data-rank] pre.logo{display:none}.rank-logo{display:block;position:relative;transform-style:preserve-3d;animation-name:insignia-turn;transform:rotateY(-24deg);--metal-shadow:#49371d;--metal-mid:#9c7e45;--metal-light:#cbb57d;--metal-shine:#e3d3a5}.logo-wrap[data-rank=\"ensign\"] .rank-logo{--metal-shadow:#503b1d;--metal-mid:#ae8b48;--metal-light:#dfc789;--metal-shine:#f4e5bd}.logo-wrap[data-rank=\"lieutenant\"] .rank-logo{--metal-shadow:#6a471d;--metal-mid:#c49b48;--metal-light:#efd18a;--metal-shine:#fff0c6}.rank-logo>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;backface-visibility:hidden}.insignia-front{transform:translateZ(1.6px)}.insignia-back{transform:rotateY(180deg) translateZ(1.6px)}.insignia-side{position:absolute;height:3.2px;transform-origin:0 0;background:linear-gradient(to bottom,#382b17,#a17e3e 46%,#6e5027);backface-visibility:visible}.insignia-side-0{left:50%;top:5.208333333333334%;width:109.1444%;transform:translateZ(-1.6px) rotate(69.9048deg) rotateX(90deg)}.insignia-side-1{left:87.5%;top:90.625%;width:41.0030%;transform:translateZ(-1.6px) rotate(-142.4314deg) rotateX(90deg)}.insignia-side-2{left:55.00000000000001%;top:69.79166666666666%;width:15.0000%;transform:translateZ(-1.6px) rotate(180.0000deg) rotateX(90deg)}.insignia-side-3{left:40%;top:69.79166666666666%;width:37.1652%;transform:translateZ(-1.6px) rotate(137.7263deg) rotateX(90deg)}.insignia-side-4{left:12.5%;top:90.625%;width:109.1444%;transform:translateZ(-1.6px) rotate(-69.9048deg) rotateX(90deg)}@keyframes insignia-turn{from{transform:rotateY(-24deg)}to{transform:rotateY(336deg)}}.console[data-starfield=\"true\"]{background-color:#070d17}.update-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:20px}.update-actions p{font-size:13px;color:var(--muted)}.logo-wrap[data-rank=\"commander\"] .rank-upgrade,.logo-wrap[data-rank=\"captain\"] .rank-upgrade,.logo-wrap[data-rank=\"admiral\"] .rank-upgrade{display:block}.rank-crown,.rank-laurel,.rank-core{display:none}.logo-wrap[data-rank=\"commander\"] .rank-crown,.logo-wrap[data-rank=\"captain\"] .rank-crown,.logo-wrap[data-rank=\"admiral\"] .rank-crown,.logo-wrap[data-rank=\"captain\"] .rank-laurel,.logo-wrap[data-rank=\"admiral\"] .rank-laurel,.logo-wrap[data-rank=\"admiral\"] .rank-core{display:block}.logo-wrap[data-rank=\"commander\"] .rank-logo,.logo-wrap[data-rank=\"captain\"] .rank-logo,.logo-wrap[data-rank=\"admiral\"] .rank-logo{--metal-shadow:#604218;--metal-mid:#bd9144;--metal-light:#f4d698;--metal-shine:#fff4d7}.logo-wrap[data-rank=\"admiral\"] .rank-logo{--metal-light:#f9e4b6;--metal-shine:#fffdf0}.space-plane{position:absolute;inset:0;width:100%;height:100%;transform-origin:50% 47%;animation:none}.console[data-starfield=\"true\"] .space-plane{animation:star-travel 113s linear infinite;will-change:transform,opacity}.console[data-starfield=\"true\"] .space-plane-0{animation-delay:-27s;transform-origin:46% 48%}.console[data-starfield=\"true\"] .space-plane-1{animation-duration:179s;animation-delay:-79s;transform-origin:54% 52%}.console[data-starfield=\"true\"] .space-scene{display:block}@keyframes star-travel{0%{transform:scale(.46) translate3d(10px,-6px,0);opacity:0}12%{opacity:.95}82%{opacity:1}100%{transform:scale(1.85) translate3d(-10px,6px,0);opacity:0}}.console[data-motion=\"off\"] .space-plane{animation-play-state:paused;will-change:auto}@media(prefers-reduced-motion:reduce){.space-plane{animation:none!important;transform:none!important;opacity:.8!important;will-change:auto}}.console{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;min-height:100svh;background-color:#0b111a}.sidebar{position:sticky;top:0;z-index:4;display:grid;grid-template-columns:minmax(170px,1fr) auto minmax(170px,1fr);align-items:center;gap:20px;padding:12px 24px;background:transparent;border:0;box-shadow:none}.brand{min-width:0}.brand p{white-space:nowrap}.sidebar-foot{display:none}nav{display:flex;justify-content:center;gap:2px;position:relative;padding:5px 10px;background:#11191d;border:1px solid #dec38738;border-radius:2px;box-shadow:inset 0 1px #ffffff0b,inset 0 -1px #0009,0 5px 14px #0004}nav button{display:flex;align-items:center;justify-content:center;gap:9px;min-width:100px;border:0;border-radius:2px;padding:13px 12px;color:var(--muted);background:transparent;transition:background 100ms,box-shadow 100ms}nav .nav-index{font:10px/20px ui-monospace,Consolas,monospace;width:20px;color:#84908f;text-align:center;opacity:1}nav button[aria-current=\"page\"]{color:var(--accent);background:#dec3870c;box-shadow:inset 0 -2px var(--accent),inset 0 1px #dec38714}nav button[aria-current=\"page\"] .nav-index{color:#ffe5a5;text-shadow:0 0 7px #dec387a0}nav button:hover:not(:disabled){background:#ffffff06;color:var(--text)}nav button:active{background:#0003;box-shadow:inset 0 2px 5px #0006}nav[data-motion=\"off\"] button{transition:none}.space-scene{display:none;position:fixed;inset:-24px;transform:translate3d(var(--look-x,0px),var(--look-y,0px),0);transition:transform 160ms ease-out;overflow:hidden;pointer-events:none;z-index:0;background:#070d17}.console[data-starfield=\"true\"] .workspace{display:flex;flex-direction:column;position:relative;background:transparent;border:0;border-radius:0;box-shadow:none;max-width:1440px;width:calc(100% - 80px);min-height:calc(100svh - 100px);padding:14px 0 12px;margin:0 auto}.hud-instruments{display:flex;justify-content:center;align-items:center;gap:32px;flex-wrap:wrap;position:relative;order:1;margin-top:auto;padding:48px 0 24px}.hud-instruments button{position:relative;text-align:left;background:transparent;border:0;border-radius:0;padding:8px 12px;box-shadow:none;min-height:52px}.hud-instruments button:hover:not(:disabled){background:#dec38708;box-shadow:inset 0 -1px #dec38766}.hud-instruments span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.14em}.hud-instruments strong{display:block;font-size:14px;font-weight:500;color:var(--accent)}.hud-instruments #hud-ready{padding-left:18px}.hud-instruments #hud-ready:before{content:\"\";position:absolute;left:0;top:14px;bottom:14px;border-left:2px solid var(--accent)}.hud-numbers{display:flex!important;gap:30px}.hud-numbers>span{display:flex;flex-direction:column;gap:4px}.hud-numbers small{font:10px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}.hud-instruments .hud-numeral{font:44px/1 ui-monospace,Consolas,monospace;font-weight:400;letter-spacing:-.05em;color:#f3dba4;text-shadow:0 0 12px #dec38740}.hud-instruments #hud-progress{font-size:12px;color:var(--accent);border-left:1px solid #dec38735;padding-left:24px}.hud-instruments #hud-next{background:var(--accent);color:var(--bg);padding:10px 22px;border-radius:2px;font-size:13px;min-height:44px;box-shadow:inset 0 1px #fff4,0 2px 5px #0005}.hud-close{display:block;margin:0 0 8px auto;padding:4px 0;min-height:36px;border:0;color:var(--accent);font-size:12px}.console[data-starfield=\"true\"] #private{order:2;align-self:center;width:100%;max-width:560px;max-height:48svh;overflow:auto;overscroll-behavior:contain;background:var(--bg);border:0;border-top:1px solid #dec38766;border-bottom:1px solid #dec38725;border-radius:0;box-shadow:0 -6px 24px #0004,inset 0 1px #ffffff08;padding:12px 28px 28px}.console[data-starfield=\"true\"] #private[data-width=\"760\"]{max-width:960px}.console[data-starfield=\"true\"] #private[data-width=\"660\"]{max-width:800px}.console[data-starfield=\"true\"][data-hud-expanded=\"false\"] #private{display:none}.console[data-starfield=\"true\"] .request-grid,.console[data-starfield=\"true\"] .jobs-workspace,.console[data-starfield=\"true\"] .system-grid{grid-template-columns:minmax(0,1fr)}.console[data-starfield=\"true\"] .request-aside{border-left:0;border-top:1px solid var(--line);padding:16px 0}.console[data-starfield=\"true\"] .request-empty-illustration{display:none}.console[data-starfield=\"true\"] .view-head{margin-bottom:20px}.console[data-starfield=\"true\"] .footer{order:3;margin-top:8px;align-self:flex-end}.console[data-starfield=\"true\"] .auth{background:var(--bg);padding:24px;align-self:center;width:100%;border-top:1px solid #dec38766}@media(max-width:1050px){.sidebar{grid-template-columns:1fr 1fr;gap:4px 20px;padding:8px 24px}.sidebar .brand{grid-column:1}nav{grid-column:1/-1;grid-row:2;justify-self:center}nav button{min-width:110px}.console[data-starfield=\"true\"] .workspace{min-height:calc(100svh - 150px)}}@media(max-width:700px){.sidebar{padding:6px 12px}.brand p{font-size:15px}nav{width:100%}nav button{min-width:0;flex:1;padding:11px 2px;font-size:12px;gap:4px}nav .nav-index{display:none}.console[data-starfield=\"true\"] .workspace{width:calc(100% - 24px);min-height:calc(100svh - 136px);padding-top:10px}.hud-instruments{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;justify-content:stretch;padding:34px 4px 18px}.hud-instruments #hud-progress{border:0;padding-left:12px}.hud-instruments #hud-next{justify-self:end}.hud-numbers{gap:20px}.hud-instruments .hud-numeral{font-size:34px}.console[data-starfield=\"true\"] #private{max-height:42svh;padding:10px 16px 22px}.hud-close{min-height:44px}}@media(prefers-reduced-motion:reduce){nav button{transition:none}}\n\n.console-utilities{grid-column:3;display:flex;align-items:center;justify-content:flex-end;gap:10px;justify-self:end}\n.refresh-control .refresh{display:grid;justify-items:center;gap:2px;padding:7px 13px;min-width:86px}.live-feed{display:flex;align-items:center;gap:4px;color:#3b3322;font:10px/1.3 ui-monospace,Consolas,monospace;white-space:nowrap}.live-feed:before{content:\"\";width:4px;height:4px;background:currentColor;border-radius:50%}.live-feed[data-connection=\"offline\"],.live-feed[data-connection=\"stale\"]{color:#6a2c20}\n.console-tools{position:relative}.console-tools summary{display:grid;place-items:center;width:44px;min-height:44px;list-style:none;cursor:pointer;font-size:26px;color:var(--muted);border-radius:3px}.console-tools summary::-webkit-details-marker{display:none}.console-tools summary:hover,.console-tools[open] summary{color:var(--accent);background:#ffffff08}.console-tools summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.console-menu{position:absolute;right:0;top:calc(100% + 10px);min-width:190px;padding:8px;background:var(--side);border:1px solid var(--line);box-shadow:0 8px 20px #0008;z-index:6}\n.console-menu .documentation,.console-menu .motion,.console-menu .logout{display:flex;align-items:center;gap:6px;position:static;width:100%;margin:0;padding:10px 12px;min-height:44px;text-align:left;font-size:13px;text-decoration:none;color:var(--muted);border:0}.console-menu .documentation:hover,.console-menu button:hover{background:#ffffff08;color:var(--accent)}\n@media(max-width:1050px){.console-utilities{grid-column:2;grid-row:1}.sidebar{gap:4px 12px}}\n@media(max-width:700px){.console-utilities{gap:2px}.refresh-control .refresh{min-width:76px;padding:5px 8px}.sidebar{gap:4px 6px}.brand{gap:8px}.brand p{font-size:14px}.brand small{font-size:9px}}\n\n/* Static instrument materials; the HUD never receives the scene transform. */\n.sidebar .brand{padding:4px 10px;background:#11191d;border-left:1px solid #dec38735;justify-self:start;box-shadow:inset 0 1px #ffffff07}\nnav:before,nav:after{content:\"\";position:absolute;width:14px;height:4px;border-top:1px solid #dec38799;top:-3px}nav:before{left:12px}nav:after{right:12px}\nnav button{min-width:94px;padding:10px 9px;min-height:44px;border-radius:0!important}\nnav button[aria-current=\"page\"]{background:#dec3870c;box-shadow:inset 0 -1px #dec387b0,inset 0 1px #dec38725;color:#ffe5a5}\nnav button[aria-current=\"page\"] .nav-index{background:#dec38716;box-shadow:inset 0 0 0 1px #dec38755;color:#ffe5a5;text-shadow:0 0 8px #dec387a0}\n.console-utilities{background:#11191d;padding:5px 8px;border-right:1px solid #dec38735;box-shadow:inset 0 1px #ffffff07}\n.power-instrument{position:relative}.power-instrument #power-toggle{min-width:105px}.power-instrument .hud-numeral{font-size:38px}.power-instrument small{font:10px system-ui,sans-serif;color:var(--muted)}\n.power-details{position:absolute;z-index:3;right:0;bottom:calc(100% + 14px);width:280px;max-width:calc(100vw - 32px);padding:18px;background:var(--bg);border-top:1px solid #dec38788;border-bottom:1px solid #dec38733;box-shadow:0 8px 24px #0007}\n.power-details .metadata{grid-template-columns:1fr auto;gap:10px 20px}.power-details .metadata dd{margin:0}.power-details h2{font-size:16px;margin-bottom:14px}.power-details #power-close{float:right;min-height:32px;padding:0 6px;color:var(--accent)}\n.console[data-motion=\"off\"] .space-scene{transform:none;transition:none}\n@media(max-width:1050px){.console-utilities{grid-column:2;grid-row:1}.sidebar .brand{grid-column:1}nav{grid-column:1/-1;grid-row:2}}\n@media(max-width:700px){.sidebar{padding:6px 10px;gap:6px}.sidebar .brand{padding:0 6px}nav{padding:3px 5px;width:100%}nav button{min-width:0;flex:1;padding:10px 2px;gap:4px}.console-utilities{padding:3px}.hud-instruments #hud-ready{grid-column:1/-1}.power-instrument{justify-self:end}.power-details{right:0}.power-instrument .hud-numeral{font-size:30px}}\n@media(prefers-reduced-motion:reduce){.space-scene{transform:none!important;transition:none!important}}\n\n/* Sign-in is a small reading surface over the same local star scene. */\n.console:has(.auth:not([hidden])) .space-scene {\n  display:block;\n}\n.console:has(.auth:not([hidden])) .workspace {\n  background:transparent;\n  border-color:transparent;\n  box-shadow:none;\n}\n.console:has(.auth:not([hidden])) .auth {\n  width:100%;\n  margin:clamp(0px,6vh,72px) auto 0;\n  padding:clamp(18px,5vw,30px);\n  background:var(--bg);\n  border-top:1px solid #dec38766;\n}\n:where(.console[data-starfield=\"false\"]:has(.auth:not([hidden]))) .space-plane-0 {\n  animation:star-travel 179s -79s linear infinite;\n}\n</style></head><body>\n<main id=\"console-surface\" class=\"console\" data-starfield=\"false\" aria-label=\"Picard Relay status console\">\n<div id=\"space-scene\" class=\"space-scene\" aria-hidden=\"true\"><svg class=\"space-plane space-plane-0\" id=\"space-plane-0\" viewBox=\"0 0 1000 1000\" preserveAspectRatio=\"none\" aria-hidden=\"true\"><path fill=\"none\" stroke=\"#d5e2f4\" stroke-width=\"1.7\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" d=\"M843 31h0.01M92 839h0.01M639 488h0.01M653 731h0.01M722 939h0.01M99 276h0.01M548 72h0.01M26 844h0.01M278 350h0.01M230 103h0.01M174 489h0.01M938 248h0.01M646 676h0.01M239 38h0.01M20 103h0.01M362 587h0.01M478 723h0.01M481 971h0.01M178 961h0.01M634 315h0.01M643 948h0.01M612 70h0.01M872 599h0.01M847 169h0.01M246 261h0.01M609 867h0.01M797 808h0.01M229 152h0.01M700 594h0.01M436 291h0.01M29 730h0.01M982 156h0.01M305 530h0.01M696 372h0.01M350 64h0.01M156 134h0.01M713 105h0.01M771 690h0.01M860 244h0.01M701 800h0.01M520 533h0.01M206 60h0.01M328 739h0.01M616 413h0.01M564 623h0.01M915 975h0.01M349 835h0.01M267 718h0.01M296 581h0.01M450 912h0.01M188 336h0.01M682 192h0.01M690 242h0.01M795 502h0.01M616 345h0.01M837 229h0.01\"/><path fill=\"none\" stroke=\"#fff0d3\" stroke-width=\"2.4\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" d=\"M897 451h0.01M748 955h0.01M69 787h0.01M849 325h0.01M51 196h0.01M163 798h0.01M40 922h0.01M717 195h0.01\"/></svg><svg class=\"space-plane space-plane-1\" id=\"space-plane-1\" viewBox=\"0 0 1000 1000\" preserveAspectRatio=\"none\" aria-hidden=\"true\"><path fill=\"none\" stroke=\"#d5e2f4\" stroke-width=\"1.7\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" d=\"M973 775h0.01M43 616h0.01M93 70h0.01M726 363h0.01M397 164h0.01M335 465h0.01M522 814h0.01M376 60h0.01M869 323h0.01M182 615h0.01M505 852h0.01M935 686h0.01M618 748h0.01M438 145h0.01M87 916h0.01M538 950h0.01M540 250h0.01M175 744h0.01M867 299h0.01M795 262h0.01M355 88h0.01M826 13h0.01M124 431h0.01M238 578h0.01M808 490h0.01M756 154h0.01M406 286h0.01M386 808h0.01M85 604h0.01M697 215h0.01M777 241h0.01M528 617h0.01M259 297h0.01M418 934h0.01M756 729h0.01M725 133h0.01M284 449h0.01M443 619h0.01M198 678h0.01M467 170h0.01M596 596h0.01M757 793h0.01M351 162h0.01M538 285h0.01M472 200h0.01M411 895h0.01M37 276h0.01M881 915h0.01M252 426h0.01M805 137h0.01M691 167h0.01M369 279h0.01M600 533h0.01M772 456h0.01M266 597h0.01M224 309h0.01\"/><path fill=\"none\" stroke=\"#fff0d3\" stroke-width=\"2.4\" stroke-linecap=\"round\" vector-effect=\"non-scaling-stroke\" d=\"M679 268h0.01M728 496h0.01M128 666h0.01M60 857h0.01M437 255h0.01M91 497h0.01M523 564h0.01M176 207h0.01\"/></svg></div><aside class=\"sidebar\"><div class=\"brand\"><button class=\"logo-wrap\" id=\"logo-wrap\" type=\"button\" aria-label=\"Picard Relay insignia; activate five times to toggle the starfield\" aria-pressed=\"false\" title=\"Click five times for the stars\"><pre class=\"logo\" id=\"logo\" aria-hidden=\"true\">                    ###\n                   ## ##\n                  ##   ##\n                 ##     ##\n                ##       ##\n           ######        #######\n         ####  ##    #    ##  ####\n       ###    ##     #     ##    ####\n     ###      #      ##     ##      ##\n    ##       #      ###     ##       ##\n  ###       ##      ###      ##       ###\n  ##       ##       ###       ##       ##\n ##        #     #########     #        ##\n ##       ##       #####       ##       ##\n##       ##        ##  ##       ##       ##\n##       #                       #       ##\n ##     ##                       ##     ##\n ##     #             #######     #     ##\n  ##   ##          ####     ###   ##   ##\n  ### ##         ###          ##   #  ###\n   #####       ###             ##  ####\n     ##      ###                ## ###\n     ##    ###                   #####\n     ##  ####                 ########\n     # #### #######    ########    ###\n    #####        #########          ##\n    ###                              #\n    #</pre><span class=\"logo rank-logo\" role=\"img\" aria-label=\"Picard Relay brass rank insignia\"><span class=\"insignia-side insignia-side-0\" aria-hidden=\"true\"></span><span class=\"insignia-side insignia-side-1\" aria-hidden=\"true\"></span><span class=\"insignia-side insignia-side-2\" aria-hidden=\"true\"></span><span class=\"insignia-side insignia-side-3\" aria-hidden=\"true\"></span><span class=\"insignia-side insignia-side-4\" aria-hidden=\"true\"></span><svg class=\"insignia-front\" viewBox=\"0 0 80 96\" aria-hidden=\"true\" focusable=\"false\"><defs><linearGradient id=\"picard-metal-face\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\".6\"><stop stop-color=\"var(--metal-shine)\"/><stop offset=\".24\" stop-color=\"var(--metal-mid)\"/><stop offset=\".43\" stop-color=\"var(--metal-light)\"/><stop offset=\".5\" stop-color=\"var(--metal-shadow)\"/><stop offset=\".66\" stop-color=\"var(--metal-mid)\"/><stop offset=\".87\" stop-color=\"var(--metal-shine)\"/><stop offset=\"1\" stop-color=\"var(--metal-mid)\"/></linearGradient><linearGradient id=\"picard-metal-recess\" x2=\"0\" y2=\"1\"><stop stop-color=\"#11191b\"/><stop offset=\"1\" stop-color=\"#35413e\"/></linearGradient></defs><g class=\"rank-crown\" fill=\"none\" stroke=\"var(--metal-light)\" stroke-width=\"1.4\"><path d=\"M40 1 75 92 44 72 32 72 5 92Z\"/></g><g class=\"rank-laurel\" fill=\"none\" stroke=\"var(--metal-shine)\" stroke-width=\"1.6\"><path d=\"M20 67 16 73 18 62 13 68 16 56 10 62M60 67 64 73 62 62 67 68 64 56 70 62\"/></g><path class=\"rank-shell\" d=\"M40 5 70 87 44 67 32 67 10 87Z\" fill=\"url(#picard-metal-face)\" stroke=\"var(--metal-shadow)\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M40 8 67 82 44 64 32 64 13 82Z\" fill=\"none\" stroke=\"var(--metal-shine)\" stroke-width=\"1\"/><path d=\"M40 20 56 66 44 58 32 58 24 66Z\" fill=\"url(#picard-metal-recess)\" stroke=\"var(--metal-shadow)\" stroke-width=\"2\"/><path d=\"M40 21 25 64 32 57 44 57 55 64\" fill=\"none\" stroke=\"var(--metal-light)\" stroke-width=\".9\"/><g class=\"rank-upgrade\"><path d=\"M40 11V57L32 64 15 80Z\" fill=\"var(--metal-mid)\"/><path d=\"M40 11 65 80 44 64 40 57Z\" fill=\"url(#picard-metal-face)\"/><path d=\"M40 24 51 62 40 55 29 62Z\" fill=\"url(#picard-metal-recess)\"/></g><path d=\"m40 30 3 12 9 3-9 3-3 12-3-12-9-3 9-3Z\" fill=\"var(--metal-shadow)\" transform=\"translate(.9 1.2)\"/><path d=\"m40 30 3 12 9 3-9 3-3 12-3-12-9-3 9-3Z\" fill=\"var(--metal-shine)\"/><path class=\"rank-upgrade\" d=\"m19 70-5 13 15-10m32-3 5 13-15-10\" fill=\"none\" stroke=\"var(--metal-shine)\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><path class=\"rank-core\" d=\"m40 14 4 9-4 9-4-9Z\" fill=\"var(--metal-shine)\"/></svg><svg class=\"insignia-back\" viewBox=\"0 0 80 96\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M40 5 70 87 44 67 32 67 10 87Z\" fill=\"url(#picard-metal-face)\" stroke=\"var(--metal-shadow)\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M40 12 65 79 44 63 32 63 15 79Z\" fill=\"none\" stroke=\"var(--metal-light)\" stroke-width=\"1\"/><path d=\"m40 30 3 12 9 3-9 3-3 12-3-12-9-3 9-3Z\" fill=\"var(--metal-shadow)\"/></svg></span></button><div><p>Picard Relay</p><small id=\"training-rank\" hidden></small></div></div>\n<nav id=\"navigation\" aria-label=\"Console views\" hidden><button id=\"nav-overview\" type=\"button\" aria-current=\"page\" aria-controls=\"view-overview\"><span class=\"nav-index\" aria-hidden=\"true\">01</span>Overview</button><button id=\"nav-jobs\" type=\"button\" aria-controls=\"view-jobs\"><span class=\"nav-index\" aria-hidden=\"true\">02</span>Jobs</button><button id=\"nav-groq\" type=\"button\" aria-controls=\"view-groq\"><span class=\"nav-index\" aria-hidden=\"true\">03</span>Groq</button><button id=\"nav-system\" type=\"button\" aria-controls=\"view-system\"><span class=\"nav-index\" aria-hidden=\"true\">04</span>System</button></nav>\n<div class=\"console-utilities\"><div id=\"refresh-control\" class=\"refresh-control\" hidden><button class=\"refresh\" id=\"refresh\" type=\"button\" aria-label=\"Refresh status\" aria-describedby=\"live-feed\" hidden><span id=\"refresh-label\">Refresh</span><span class=\"live-feed\" id=\"live-feed\" role=\"status\">Standby</span></button></div><details id=\"console-tools\" class=\"console-tools\"><summary aria-label=\"Documentation and account\" title=\"Documentation and account\">⋯</summary><div class=\"console-menu\"><a id=\"documentation\" class=\"documentation\" href=\"https://github.com/bmartynowicz/picard-relay/blob/main/docs/README.md\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\" aria-label=\"Documentation (opens in a new tab)\">Documentation <span aria-hidden=\"true\">↗</span></a><button class=\"motion\" id=\"motion\" type=\"button\" aria-pressed=\"false\">Pause motion</button><button class=\"logout\" id=\"logout\" type=\"button\" hidden>Sign out</button></div></details></div><p class=\"sidebar-foot\">MAKE IT SO.</p></aside>\n<div class=\"workspace\" id=\"cockpit-glass\" tabindex=\"0\" aria-label=\"Space view; arrow keys look around\">\n<section class=\"auth\" id=\"auth\" aria-labelledby=\"auth-heading\">\n<h2 id=\"auth-heading\">Checking sign-in</h2><p id=\"auth-description\">Connecting to this Picard console.</p>\n<form id=\"setup-form\" hidden>\n<label for=\"setup-code\">One-time setup code</label><input id=\"setup-code\" type=\"password\" autocomplete=\"one-time-code\" maxlength=\"256\" required spellcheck=\"false\" autocapitalize=\"none\">\n<p class=\"hint\">Use the expiring code delivered separately. Do not put it in a URL.</p>\n<label for=\"new-password\">Create your password</label><input id=\"new-password\" type=\"password\" autocomplete=\"new-password\" required maxlength=\"128\">\n<p class=\"hint\">8–128 UTF-8 bytes. Most ordinary characters use one byte; no character-mix rules.</p>\n<label for=\"confirm-password\">Confirm password</label><input id=\"confirm-password\" type=\"password\" autocomplete=\"new-password\" required maxlength=\"128\">\n<button class=\"auth-submit\" id=\"setup-submit\" type=\"submit\">Set password & sign in</button>\n</form>\n<form id=\"login-form\" hidden><label for=\"login-password\">Password</label><input id=\"login-password\" type=\"password\" autocomplete=\"current-password\" required maxlength=\"128\"><button class=\"auth-submit\" id=\"login-submit\" type=\"submit\">Sign in</button></form>\n<p class=\"auth-message\" id=\"auth-message\" role=\"status\" aria-live=\"polite\" hidden></p><button class=\"refresh retry\" id=\"retry-auth\" type=\"button\" hidden>Retry</button>\n</section>\n<div class=\"hud-instruments\" id=\"hud-instruments\" aria-label=\"Relay instruments\" hidden><button id=\"hud-ready\" type=\"button\" aria-controls=\"view-system\"><span>Relay</span><strong id=\"hud-health\">Not checked</strong></button><button id=\"hud-open-jobs\" type=\"button\" aria-controls=\"view-jobs\"><strong id=\"hud-jobs\" class=\"hud-numbers\"><span><b id=\"hud-active\" class=\"hud-numeral\">—</b><small>Active</small></span><span><b id=\"hud-done\" class=\"hud-numeral\">—</b><small>Completed</small></span></strong></button><div class=\"power-instrument\"><button id=\"power-toggle\" type=\"button\" aria-expanded=\"false\" aria-controls=\"power-details\"><span>VM CPU</span><strong id=\"power-value\" class=\"hud-numeral\">—</strong></button><section id=\"power-details\" class=\"power-details\" aria-labelledby=\"power-heading\" hidden><button id=\"power-close\" type=\"button\" aria-label=\"Close CPU details\">×</button><h2 id=\"power-heading\">VM resources</h2><dl class=\"metadata\"><dt>CPU</dt><dd id=\"power-cpu\">—</dd><dt>VM memory</dt><dd id=\"power-memory\">—</dd><dt>Picard RAM</dt><dd id=\"power-relay\">—</dd><dt>Observed</dt><dd id=\"power-observed\">Not checked</dd></dl></section></div><button id=\"hud-progress\" type=\"button\" aria-controls=\"view-overview\">Progress ↗</button><button id=\"hud-next\" type=\"button\" class=\"request-primary\" hidden>New request</button></div><div id=\"private\" hidden><button id=\"hud-close\" class=\"hud-close\" type=\"button\" hidden>Minimize panel ↙</button>\n<p class=\"notice\" id=\"notice\" role=\"status\" hidden></p>\n<section id=\"view-overview\" aria-labelledby=\"heading-overview\"><div class=\"view-head\"><div><h1 id=\"heading-overview\" tabindex=\"-1\">Overview</h1></div></div>\n<div class=\"signal\"><h2 id=\"health-heading\" data-tone=\"unknown\">Not yet checked</h2><p id=\"checked\">No observation yet</p></div>\n<dl class=\"readiness\"><div><dt>New work</dt><dd id=\"accepting\" class=\"muted\">Unknown</dd></div><div><dt>Groq availability</dt><dd id=\"provider\" class=\"muted\">Unknown</dd></div><div><dt>Result recovery</dt><dd id=\"recovery\" class=\"muted\">Unknown</dd></div><div><dt>Draining</dt><dd id=\"draining\" class=\"muted\">Unknown</dd></div></dl>\n<p id=\"blocking\" class=\"blocking\" hidden></p><dl class=\"counts\" aria-label=\"Job counts\"><div><dt>Queued</dt><dd id=\"queued\" class=\"unknown\">-</dd></div><div><dt>Running</dt><dd id=\"invoking\" class=\"unknown\">-</dd></div><div><dt>Completed</dt><dd id=\"completed\" class=\"unknown\">-</dd></div><div><dt>Uncertain</dt><dd id=\"uncertain\" class=\"unknown\">-</dd></div><div><dt>Failed</dt><dd id=\"failed\" class=\"unknown\">-</dd></div></dl>\n<div class=\"section-title\"><h2>Recent activity</h2><button id=\"open-jobs\" class=\"section-action\" type=\"button\">View all jobs →</button></div><ul class=\"activity\" id=\"activity-list\" aria-label=\"Recent activity\"></ul>\n</section>\n<section id=\"view-jobs\" aria-labelledby=\"heading-jobs\" hidden><div class=\"view-head\"><div><h1 id=\"heading-jobs\" tabindex=\"-1\">Jobs</h1></div><button id=\"jobs-refresh\" type=\"button\">Refresh jobs</button></div>\n<div class=\"jobs-toolbar\"><label for=\"jobs-filter\">Show</label><select id=\"jobs-filter\"><option value=\"all\">All loaded jobs</option><option value=\"active\">Queued and running</option><option value=\"attention\">Needs review</option><option value=\"completed\">Completed</option></select><span class=\"muted\" id=\"jobs-observed\">Not checked</span></div>\n<div class=\"jobs-workspace\"><div><div class=\"job-columns\" aria-hidden=\"true\"><span>Job</span><span>State</span><span>Last activity</span></div><ul class=\"job-list\" id=\"jobs-list\" aria-label=\"Recent jobs\"></ul><p id=\"jobs-empty\" class=\"empty\" hidden>No matching jobs in the loaded rows.</p><p class=\"scope-note\" id=\"jobs-notice\">No observation yet</p><button id=\"jobs-more\" type=\"button\" hidden>Load more jobs</button></div>\n<aside class=\"job-inspector\" aria-label=\"Selected job\"><h2>Job details</h2><p id=\"inspector-empty\">Select a job to inspect its recorded state.</p><div id=\"job-details\" hidden><dl class=\"metadata\"><dt>Reference</dt><dd class=\"full-ref\" id=\"detail-ref\" tabindex=\"-1\">-</dd><dt>State</dt><dd id=\"detail-state\">-</dd><dt>Created</dt><dd id=\"detail-created\">-</dd><dt>Updated</dt><dd id=\"detail-updated\">-</dd><dt>Stored result</dt><dd id=\"detail-result\">-</dd></dl><p id=\"detail-reason\"></p></div></aside></div></section>\n<section id=\"view-groq\" aria-labelledby=\"heading-groq\" hidden><div class=\"view-head\"><div><h1 id=\"heading-groq\" tabindex=\"-1\">Groq</h1></div></div><div class=\"groq-status\"><span class=\"status-mark\" aria-hidden=\"true\"></span><h2 id=\"groq-availability\">Availability unknown</h2></div><p id=\"groq-blocking\" class=\"blocking\">No verified observation.</p>\n<details id=\"groq-key\" class=\"technical\" hidden><summary>Groq key · <span id=\"key-expiry\">Expiry unknown</span></summary><p><a href=\"https://github.com/bmartynowicz/picard-relay/blob/main/docs/OPERATIONS.md#replace-a-groq-key\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">Replace a Groq key</a></p></details>\n<div class=\"provider-activity\"><h2>Live relay activity</h2><p class=\"muted\" id=\"groq-checked\">No observation yet</p><dl class=\"readiness\"><div><dt>Queued</dt><dd id=\"groq-queued\">—</dd></div><div><dt>Running</dt><dd id=\"groq-invoking\">—</dd></div><div><dt>Completed</dt><dd id=\"groq-completed\">—</dd></div><div><dt>Failed</dt><dd id=\"groq-failed\">—</dd></div><div><dt>Uncertain</dt><dd id=\"groq-uncertain\">—</dd></div></dl><ul class=\"activity\" id=\"groq-activity\" aria-label=\"Latest relay outcomes\"></ul><button id=\"groq-open-jobs\" type=\"button\">View all jobs →</button></div>\n<details class=\"technical\"><summary>Request limits and safeguards</summary><dl class=\"policy\"><dt>Provider / model</dt><dd>Groq · openai/gpt-oss-20b</dd><dt>Cost policy</dt><dd>Free-only enrollment<p>No paid fallback or model substitution. Retained enrollment is configuration evidence, not a current billing check.</p></dd><dt>Request approval</dt><dd>Exact owner, task, input and expiring one-use grant<p>This console cannot submit or approve a request.</p></dd><dt>Output limit</dt><dd>512 tokens for existing grants; up to 4,096 for newly approved Board requests · one call per unique grant</dd><dt>Execution</dt><dd>Text and code proposals only<p>No tools, command execution or automatic retries. Controlled execution remains a local fixture.</p></dd><dt>Uncertain outcome</dt><dd>Stop and preserve evidence<p>Do not resubmit an uncertain request. Operator review is required.</p></dd></dl></details></section>\n<section id=\"view-system\" aria-labelledby=\"heading-system\" hidden><div class=\"view-head\"><div><h1 id=\"heading-system\" tabindex=\"-1\">System</h1></div></div><div class=\"system-grid\"><div><h2>Runtime</h2><dl class=\"policy\"><dt>VM CPU</dt><dd id=\"system-cpu\">—</dd><dt>VM memory</dt><dd id=\"system-memory\">—</dd><dt>Picard RAM</dt><dd id=\"system-relay-memory\">—</dd><dt>Version</dt><dd id=\"runtime-version\">Not checked</dd><dt>Sequence</dt><dd id=\"runtime-sequence\">Not checked</dd><dt>Source commit</dt><dd id=\"source-commit\" class=\"full-ref\">Not checked</dd><dt>Release</dt><dd id=\"release\">Unknown</dd></dl></div><div><h2>Updater</h2><div class=\"update-actions\"><button id=\"update-check\" type=\"button\" disabled>Check for updates</button><p id=\"update-request-state\" role=\"status\">Checking connection…</p></div><dl class=\"policy\"><dt>State</dt><dd id=\"updater-state\">Not checked</dd><dt>Policy</dt><dd id=\"updater-configured\">Not checked</dd><dt>Timer</dt><dd id=\"updater-timer\">Not checked</dd><dt>Last attempt</dt><dd id=\"updater-attempt\">Not checked</dd><dt>Last outcome</dt><dd id=\"updater-outcome\">Not checked</dd><dt>Observed</dt><dd id=\"updater-observed\">Not checked</dd></dl></div></div><p id=\"updater-explanation\" class=\"subtle updater-explanation\" role=\"status\">No verified updater observation.</p><div class=\"technical\"><h2>Release fingerprint</h2><p class=\"subtle\">Identifies the runtime observation. Service health alone does not verify an update.</p><p class=\"fingerprint\" id=\"fingerprint\">No verified observation</p></div><button id=\"system-motion\" type=\"button\" aria-pressed=\"false\">Pause motion</button></section>\n</div><footer class=\"footer\"><details class=\"console-info\"><summary aria-label=\"About status and privacy\"><span aria-hidden=\"true\">i</span></summary><div class=\"info-panel\"><p class=\"scope-note\" id=\"data-scope\">No scope checked.</p><p>Viewing status and refreshing do not call AI.</p><p>Filters apply to loaded rows only. Up to 100 rows.</p></div></details></footer></div></main>\n<script>\n'use strict';\n(function(){\nconst $=id=>document.getElementById(id),states=['queued','invoking','completed','uncertain','failed'];\nlet pending=false,controller=null,latest=null,paused=false,authenticated=false,authMode='unknown',resumePending=false,latestJobs=null,jobRows=[],nextCursor=null,staleTimer=null,liveTimer=null,statusFailed=false;\nconst counterAnimations=new Set(),counterTracks=new Map(),jobStates=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain','unknown'];\nconst reasons={queued:'Waiting in the existing queue.',claimed:'Claimed by the worker. Do not submit a duplicate.',invoking:'Invocation in progress. Wait for its recorded outcome.',completed:'A result is stored.',result_missing:'Stored result is unavailable. Ask the operator to review.',output_incomplete:'Output incomplete; the request is spent. Do not retry it.',outcome_uncertain:'External outcome is unknown. Do not retry; ask the operator to review the saved evidence.',scope_expired:'Request approval expired. This job will not retry.',scope_revoked:'Request approval was revoked.',provider_quota:'Provider reported a quota limit. Operator review is required; no paid fallback.',provider_payment:'Provider reported a payment requirement. Stop for operator review; no paid fallback.',approval_unavailable:'No usable one-shot authorization is available. Check the existing request approval and stop evidence.',request_rejected:'Request was rejected. Review its saved scope and evidence; do not resubmit automatically.',recorded_failure:'A failure is recorded. Ask the operator to review before any new request.',unknown:'Reason is unknown. Ask the operator to review the stored evidence.'};\nconst object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};\nfunction consoleServiceSummary(s) {\n  const isBool = v => typeof v === 'boolean';\n  const { ready, providerReady, acceptingNewWork, draining } = s || {};\n\n  if (!isBool(ready)) {\n    return { label: 'Service state unknown', tone: 'neutral' };\n  }\n  if (!ready) {\n    return { label: 'Service unavailable', tone: 'warn' };\n  }\n  if (isBool(draining) && draining) {\n    return { label: 'Relay draining - new work blocked', tone: 'warn' };\n  }\n  if (isBool(providerReady) && providerReady &&\n      isBool(acceptingNewWork) && acceptingNewWork) {\n    return { label: 'Ready for new work', tone: 'good' };\n  }\n  return { label: 'Relay reachable - new work blocked', tone: 'warn' };\n}\nconst availabilityReasons={ready:'Ready for a separately reviewed, exact one-use request.',allowance_unavailable:'No usable enrolled one-call allowance remains. Review the saved requests and obtain a new exact approval for different work; never replay a spent request.',pending_uncertainty:'A provider outcome is uncertain. Preserve its evidence and ask the operator to review it. Do not retry or replace the request.',catalogue_expired:'The enrolled request catalogue has expired. Saved results remain available. Ask the operator to review a new exact request.',catalogue_unavailable:'The enrolled request catalogue could not be verified. Saved results can still be checked; operator review is required.',configuration_unavailable:'Provider configuration could not be verified. No new call is permitted; ask the operator to check the existing configuration.',relay_busy_or_draining:'The relay is busy or draining. Wait for the current operation to finish; do not submit a duplicate.',legacy_review_required:'Historical job evidence needs operator review before new work. Saved results remain available; do not retry uncertain jobs.',unknown:'New work is blocked, but this runtime has not supplied a specific reason. Review Requests and ask the operator for the recorded blocking evidence.'};\nconst passwordBytes=value=>new TextEncoder().encode(value).length;\nfunction clearInputs(){for(const id of ['setup-code','new-password','confirm-password','login-password'])$(id).value='';}\nfunction clearPrivate(){\n if($('feedback-dialog').open)$('feedback-dialog').close();\n resetFeedback();$('feedback-open').hidden=true;\n clearPower();renderKeyExpiry();$('groq-key').open=false;\n updateGeneration++;updateState=null;updatePosting=false;$('update-check').disabled=true;$('update-request-state').textContent='Not checked';\n clearTimeout(liveTimer);liveTimer=null;liveCaption('waiting','Standby','Waiting for live data.');$('data-scope').textContent='No scope checked.';$('groq-checked').textContent='No observation yet';for(const state of states)$('groq-'+state).textContent='—';$('groq-activity').replaceChildren();\n resetWorkspace();\n for(const state of states)$(state).setAttribute('aria-label','Unknown');\n for(const animation of counterAnimations)animation.cancel();counterAnimations.clear();clearTimeout(staleTimer);staleTimer=null;latestJobs=null;jobRows=[];nextCursor=null;\n $('blocking').textContent='';$('blocking').hidden=true;$('jobs-list').replaceChildren();$('jobs-notice').textContent='No observation yet';$('jobs-observed').textContent='Not checked';$('jobs-more').hidden=true;\n authenticated=false;latest=null;statusFailed=false;hudExpanded=false;renderHUD();$('private').hidden=true;$('refresh-control').hidden=true;$('refresh').hidden=true;$('logout').hidden=true;\n $('health-heading').textContent='Not yet checked';$('health-heading').dataset.tone='unknown';$('checked').textContent='No observation yet';$('checked').title='';$('notice').textContent='';$('notice').hidden=true;\n for(const id of ['provider','recovery','accepting','draining']){$(id).textContent='Unknown';$(id).className='muted';}\n for(const state of states){$(state).textContent='—';$(state).className='unknown';delete $(state).dataset.counterValue;}\n $('release').textContent='Unknown';$('fingerprint').textContent='No verified observation';for(const id of ['runtime-version','runtime-sequence','source-commit','updater-state','updater-configured','updater-timer','updater-attempt','updater-outcome','updater-observed'])$(id).textContent='Not checked';$('updater-explanation').textContent='No verified updater observation.';\n}\nfunction authMessage(message){$('auth-message').textContent=message;$('auth-message').hidden=!message;}\nfunction showAuth(mode,message=''){\n clearPrivate();clearInputs();authMode=mode;$('auth').hidden=false;$('setup-form').hidden=mode!=='setup';$('login-form').hidden=mode!=='login';$('retry-auth').hidden=mode!=='unknown';\n $('auth-heading').textContent=mode==='setup'?'Set up your console':mode==='login'?'Welcome back':'Sign-in unavailable';\n $('auth-description').textContent=mode==='setup'?'Set the owner password using your one-time setup code.':mode==='login'?'Sign in to see Picard’s private status.':'The console could not check its sign-in state.';authMessage(message);\n}\nfunction project(input){\n const data=object(input),service=object(data.service),jobs=object(data.jobs),release=object(data.release);\n if(data.v!==1||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt)))throw Error('status');\n const bool=value=>typeof value==='boolean'?value:null;\n const claimed=jobs.claimed===undefined?0:jobs.claimed,invoking=jobs.invoking;\n const running=Number.isSafeInteger(claimed)&&claimed>=0&&Number.isSafeInteger(invoking)&&invoking>=0&&claimed+invoking<=10000?claimed+invoking:null;\n return {scope:data.scope==='owner'?'owner':data.scope==='task'?'task':'unknown',observedAt:new Date(data.observedAt).toISOString(),service:{ready:bool(service.ready),resultRecoveryReady:bool(service.resultRecoveryReady),providerReady:bool(service.providerReady),acceptingNewWork:bool(service.acceptingNewWork),draining:bool(service.draining)},jobs:Object.fromEntries(states.map(state=>{const value=state==='invoking'?running:jobs[state];return [state,Number.isSafeInteger(value)&&value>=0&&value<=10000?value:null];})),releaseHash:typeof release.hash==='string'&&/^[a-f0-9]{64}$/.test(release.hash)?release.hash:null,releaseVersion:typeof release.version==='string'&&/^\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?$/.test(release.version)?release.version:null,releaseSequence:Number.isSafeInteger(release.sequence)&&release.sequence>0?release.sequence:null,sourceCommit:typeof release.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(release.sourceCommit)?release.sourceCommit:null,resources:projectResources(data.resources),groqKeyExpiresAt:data.groqKeyExpiresAt===undefined?undefined:Number.isSafeInteger(data.groqKeyExpiresAt)&&data.groqKeyExpiresAt>=0&&data.groqKeyExpiresAt<=8640000000000000?data.groqKeyExpiresAt:null,updater:projectUpdater(data.updater),blockingCode:typeof service.blockingCode==='string'&&Object.hasOwn(availabilityReasons,service.blockingCode)?service.blockingCode:'unknown'};\n}\nconst updaterReasons={none:'The automatic updater is enabled. This observation reports local service activity; installed release identity is shown separately.',policy_disabled:'Automatic updates are disabled by the installed operator policy.',hold_present:'An operator hold blocks updates. Preserve its evidence and ask the operator to review it.',check_in_progress:'An update check is running. Wait for its recorded outcome.',fetch_failed:'The latest release download failed. Ask the operator to inspect the fetch service; no new release is confirmed.',check_failed:'The latest updater check failed. Ask the operator to inspect its saved evidence before another attempt.',timer_disabled:'The updater timer is not running. Ask the operator to review its intended schedule.',never_checked:'No completed updater check has been reported yet.',metadata_unavailable:'Updater metadata could not be read. Current updater state is unknown.',activity_not_connected:'The updater activity feed is not installed. Ask the operator to install the read-only reporter.',activity_unavailable:'Updater activity could not be verified. Current updater state is unknown.',activity_invalid:'Updater activity was invalid. Current updater state is unknown.',activity_stale:'The updater observation is over three minutes old. Current updater state is unknown; ask the operator to check the activity reporter.',activity_clock_mismatch:'The updater observation is ahead of this device. Current updater state is unknown.'};\nfunction projectResources(value){\n const r=object(value),safe=n=>Number.isSafeInteger(n)&&n>=0?n:null;\n if(r.v!==1||r.scope!=='vm'||safe(r.observedAtMs)===null)return null;\n const total=safe(r.memoryTotalBytes),used=safe(r.memoryUsedBytes),rss=safe(r.relayMemoryBytes);\n return {v:1,scope:'vm',observedAtMs:r.observedAtMs,cpuPercent:Number.isFinite(r.cpuPercent)&&r.cpuPercent>=0&&r.cpuPercent<=100?r.cpuPercent:null,memoryTotalBytes:total>0?total:null,memoryUsedBytes:total>0&&used!==null&&used<=total?used:null,relayMemoryBytes:rss!==null&&(total===null||rss<=total)?rss:null};\n}\nfunction projectUpdater(value){\n const data=object(value),states=['enabled','disabled','held','checking','error','unknown'],time=key=>typeof data[key]==='string'&&Number.isFinite(Date.parse(data[key]))?new Date(data[key]).toISOString():null;\n return {state:states.includes(data.state)?data.state:'unknown',reasonCode:Object.hasOwn(updaterReasons,data.reasonCode)?data.reasonCode:'activity_not_connected',observedAt:time('observedAt'),configured:typeof data.configured==='boolean'?data.configured:null,timerActive:typeof data.timerActive==='boolean'?data.timerActive:null,lastAttemptAt:time('lastAttemptAt'),lastFinishedAt:time('lastFinishedAt'),lastOutcome:['never_checked','fetch_failed','check_failed','check_succeeded','unknown'].includes(data.lastOutcome)?data.lastOutcome:'unknown'};\n}\nfunction elapsedAge(age){\n if(!Number.isFinite(age)||age< -5000)return 'age unknown';\n const seconds=Math.max(0,Math.floor(age/1000));return seconds<60?seconds+' seconds ago':Math.floor(seconds/60)+' minutes ago';\n}\nfunction renderUpdater(value){\n const data=projectUpdater(value),age=data.observedAt?Date.now()-Date.parse(data.observedAt):null,reason=statusFailed?'activity_unavailable':age!==null&&age< -5000?'activity_clock_mismatch':age!==null&&age>180000?'activity_stale':data.reasonCode;\n const state=['activity_stale','activity_clock_mismatch','activity_unavailable'].includes(reason)?'unknown':data.state;\n $('updater-state').textContent=({enabled:'Enabled',disabled:'Disabled',held:'On hold',checking:'Checking',error:'Error',unknown:'Unknown'})[state];\n $('updater-configured').textContent=data.configured===null?'Unknown':data.configured?'Updates enabled':'Updates disabled';$('updater-timer').textContent=data.timerActive===null?'Unknown':data.timerActive?'Running':'Not running';\n $('updater-attempt').textContent=data.lastAttemptAt?formatTime(Date.parse(data.lastAttemptAt)):'Not reported';\n $('updater-outcome').textContent=({never_checked:'No completed check',fetch_failed:'Download failed',check_failed:'Update check failed',check_succeeded:'Update check succeeded',unknown:'Unknown'})[data.lastOutcome]+(data.lastFinishedAt?' · '+formatTime(Date.parse(data.lastFinishedAt)):'');\n $('updater-observed').textContent=data.observedAt?formatTime(Date.parse(data.observedAt))+' · '+elapsedAge(age):'Not reported';$('updater-explanation').textContent=updaterReasons[reason];\n}\nfunction readiness(id,value,positive,negative){$(id).textContent=value===true?positive:value===false?negative:'Unknown';$(id).className=value===true?'good':'muted';}\n\nfunction renderCounter(el,value,previous){\n const text=value===null?'—':String(value);\n if(el.dataset.counterValue===text)return;\n for(const animation of counterTracks.get(el)||[])animation.cancel();\n counterTracks.delete(el);el.dataset.counterValue=text;\n el.setAttribute('aria-label',value===null?'Unknown':text);\n el.className=value===null?'unknown':'counter-number';\n el.replaceChildren();\n if(value===null){el.textContent=text;return;}\n const roll=typeof previous==='number'&&previous!==value&&!paused&&!preference.matches&&document.visibilityState!=='hidden'&&activeView==='overview';\n const before=String(previous).padStart(text.length,' '),direction=value>previous?'up':'down',running=new Set();\n for(let i=0;i<text.length;i++){\n  const window=document.createElement('span'),reel=document.createElement('span');\n  window.className='counter-window';window.setAttribute('aria-hidden','true');reel.className='counter-reel';reel.textContent=text[i];window.append(reel);el.append(window);\n  const from=before[before.length-text.length+i];\n  if(!roll||from===text[i]||typeof reel.animate!=='function')continue;\n  reel.dataset.from=from;reel.dataset.direction=direction;\n  const animation=reel.animate([{transform:direction==='up'?'translateY(100%)':'translateY(-100%)'},{transform:'translateY(0)'}],{duration:520,delay:Math.min((text.length-1-i)*35,140),easing:'cubic-bezier(.22,.7,.25,1)'});\n  counterAnimations.add(animation);running.add(animation);\n  animation.onfinish=animation.oncancel=()=>{delete reel.dataset.from;delete reel.dataset.direction;counterAnimations.delete(animation);running.delete(animation);if(counterTracks.get(el)===running&&running.size===0)counterTracks.delete(el);};\n }\n if(running.size)counterTracks.set(el,running);\n}\n\nfunction render(data){\n const previous=latest;authenticated=true;latest=data;statusFailed=false;authMode='authenticated';clearInputs();$('auth').hidden=true;$('private').hidden=false;$('refresh-control').hidden=false;$('navigation').hidden=false;$('refresh').hidden=false;$('logout').hidden=false;$('feedback-open').hidden=false;$('notice').hidden=true;\n const summary=consoleServiceSummary(data.service);$('health-heading').textContent=summary.label;$('health-heading').dataset.tone=summary.tone;\n $('checked').textContent='Observed '+formatTime(Date.parse(data.observedAt));$('checked').title=data.observedAt;\n readiness('provider',data.service.providerReady,'Ready','Unavailable');readiness('recovery',data.service.resultRecoveryReady,'Ready','Unavailable');readiness('accepting',data.service.acceptingNewWork,'Accepting','Not accepting');readiness('draining',data.service.draining,'Yes','No');\n for(const state of states)renderCounter($(state),data.jobs[state],previous?.jobs[state]);\n $('release').textContent=data.releaseHash?'Identified':'Unknown';$('fingerprint').textContent=data.releaseHash||'Not reported';$('runtime-version').textContent=data.releaseVersion?'v'+data.releaseVersion:'Not supplied by this runtime';$('runtime-sequence').textContent=data.releaseSequence===null?'Not supplied':String(data.releaseSequence);$('source-commit').textContent=data.sourceCommit||'Not supplied';\n $('blocking').textContent=data.service.draining===true?availabilityReasons.relay_busy_or_draining:data.service.providerReady!==true||data.service.acceptingNewWork!==true?availabilityReasons[data.blockingCode]||availabilityReasons.unknown:'';$('blocking').hidden=!$('blocking').textContent;\n const scopeText=data.scope==='owner'?'Your relay jobs across approved tasks.':data.scope==='task'?'This configured task only.':'Job scope not supplied by this runtime.';$('data-scope').textContent=scopeText+' Metadata only; request and result text stay private.';\n showGroq(data);renderHUD();\n refreshFreshness();restoreWorkspace();\n}\nfunction refreshFreshness(){\n clearTimeout(staleTimer);staleTimer=null;if(!authenticated||!latest)return;renderUpdater(latest.updater);\n const age=Date.now()-Date.parse(latest.observedAt),elapsed=elapsedAge(age);renderKeyExpiry(latest,age);\n $('checked').textContent='Observed '+formatTime(Date.parse(latest.observedAt))+' · '+elapsed;$('groq-checked').textContent=(statusFailed?'Last successful observation ':'Observed ')+formatTime(Date.parse(latest.observedAt))+' · '+elapsed;\n if(!statusFailed){if(age< -5000){$('notice').textContent='Observation time is ahead of this device. Freshness is unknown.';$('notice').hidden=false;$('health-heading').textContent='Current health unknown - clock mismatch';$('health-heading').dataset.tone='unknown';}else if(age>=60000){$('notice').textContent='This observation is over a minute old. Refresh to check current status.';$('notice').hidden=false;$('health-heading').textContent='Current health unknown - refresh needed';$('health-heading').dataset.tone='unknown';}}\n renderHUD();if(!statusFailed)staleTimer=setTimeout(refreshFreshness,15000);\n}\nfunction liveCaption(state,text,description){const el=$('live-feed');el.dataset.connection=state;if(el.textContent!==text)el.textContent=text;el.title=description;el.setAttribute('aria-label',description);}\nfunction scheduleLiveRefresh(){\n clearTimeout(liveTimer);liveTimer=null;if(!authenticated)return;\n const age=Date.now()-Date.parse(latest?.observedAt);if(statusFailed)liveCaption('offline','Offline','Live connection unavailable; showing the last observation.');else if(document.visibilityState==='hidden')liveCaption('paused','Paused','Live updates paused while this tab is hidden.');else if(age< -5000||age>=60000)liveCaption('stale','Check status','Observation freshness needs attention. Automatic checks every 15 seconds.');else liveCaption('live','Live · 15s','Live updates every 15 seconds. Refresh checks now.');\n if(!pending&&document.visibilityState!=='hidden')liveTimer=setTimeout(refreshLive,15000);\n}\nasync function refreshLive(){\n liveTimer=null;if(!authenticated||document.visibilityState==='hidden')return;if(pending){scheduleLiveRefresh();return;}\n busy(true);try{await status({automatic:true});}finally{busy(false);}\n}\nfunction busy(value){pending=value;if(value){clearTimeout(liveTimer);liveTimer=null;}for(const id of ['refresh','logout','setup-submit','login-submit','retry-auth','jobs-refresh','jobs-more'])$(id).disabled=value;$('refresh-label').textContent=value?'Checking…':'Refresh';$('refresh').setAttribute('aria-busy',String(value));if(!value)scheduleLiveRefresh();if(!value&&resumePending){resumePending=false;queueMicrotask(()=>void boot());}}\nasync function request(path,body){\n const abort=new AbortController();controller=abort;const timer=setTimeout(()=>abort.abort(),8000);\n try{\n  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});\n  if(!response.ok){let code='auth_failed';try{const data=await response.json();if(['auth_failed','setup_unavailable','rate_limited'].includes(data.error))code=data.error;}catch{}const error=Error(code);error.status=response.status;throw error;}\n  const result=await response.json();if(abort.signal.aborted)throw Error('aborted');return result;\n }finally{clearTimeout(timer);}\n}\nconst friendly=error=>error.message==='rate_limited'?'Too many attempts. Wait before trying again.':error.message==='setup_unavailable'?'Setup is unavailable. Check whether this console has already been enrolled.':'Sign-in failed. Check your details and try again.';\nasync function status({automatic=false}={}){\n try{render(project(await request('/status')));if(!automatic||jobRows.length<=25)await loadJobs(false);if(activeView==='system')await readUpdateStatus();}\n catch(error){if(error.status===401||error.status===403){showAuth('login','Please sign in to view private status.');return;}\n  if(authenticated&&latest){statusFailed=true;renderKeyExpiry(latest);clearTimeout(staleTimer);staleTimer=null;$('health-heading').textContent='Current health unknown';$('health-heading').dataset.tone='unknown';renderUpdater(latest.updater);$('groq-availability').textContent='Current availability unknown';$('groq-blocking').hidden=false;$('groq-blocking').textContent='Status could not be checked. Refresh to check current availability; refreshing status does not authorize a request.';$('notice').textContent='Status could not be checked. Showing the previous observation from '+new Date(latest.observedAt).toLocaleString()+'. Current health is unknown.';$('notice').hidden=false;renderHUD();}\n  else showAuth('login','Signed-in status could not be confirmed. Please try again.');}\n}\nfunction projectJobs(input){\n const data=object(input);if(data.v!==1||!Array.isArray(data.rows)||data.rows.length>50||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt))||!(data.nextCursor===null||typeof data.nextCursor==='string'&&data.nextCursor.length<=256&&/^[A-Za-z0-9_-]+$/.test(data.nextCursor)))throw Error('history');\n const rows=data.rows.map(row=>{if(!row||typeof row.ref!=='string'||!/^[a-f0-9]{64}$/.test(row.ref)||!jobStates.includes(row.state)||!Object.hasOwn(reasons,row.reasonCode)||typeof row.resultAvailable!=='boolean')throw Error('history');const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?value:null;return {ref:row.ref,state:row.state,createdAt:time(row.createdAt),updatedAt:time(row.updatedAt),resultAvailable:row.resultAvailable,reasonCode:row.reasonCode};});\n if(new Set(rows.map(row=>row.ref)).size!==rows.length||rows.length===0&&data.nextCursor!==null)throw Error('history');return {rows,nextCursor:data.nextCursor,observedAt:new Date(data.observedAt).toISOString()};\n}\nfunction renderJobs(page,append){\n const previous=append?jobRows:[];if(page.rows.some(row=>previous.some(old=>old.ref===row.ref)))throw Error('history');jobRows=[...previous,...page.rows].slice(0,100);nextCursor=page.nextCursor;latestJobs=page;if(preferredRoute.view==='jobs'&&preferredRoute.ref)selectedRef=preferredRoute.ref;paintJobs();\n $('jobs-observed').textContent='Observed '+formatTime(Date.parse(page.observedAt));$('jobs-notice').textContent=jobRows.length===0?'No jobs recorded for this configured scope.':jobRows.length>=100?'Showing 100 jobs. Refresh to start again.':'';$('jobs-more').hidden=nextCursor===null||jobRows.length>=100;\n}\nlet selectedRef=null,activeView='overview',preferredRoute=readRoute();\nfunction readRoute(){const match=/^#(overview|jobs|requests|groq|system)(?:\\/([a-f0-9]{64}))?$/.exec(window.location?.hash||'');return match?{view:match[1],ref:match[2]||null}:{view:'overview',ref:null};}\nfunction writeRoute(replace=false){if(!window.location||!window.history)return;const hash='#'+preferredRoute.view+(preferredRoute.ref?'/'+preferredRoute.ref:'');if(window.location.hash!==hash)window.history[replace?'replaceState':'pushState']?.(null,'',hash);}\nfunction restoreWorkspace(){if(!authenticated)return;if(preferredRoute.view==='jobs'&&preferredRoute.ref)selectedRef=preferredRoute.ref;if(activeView!==preferredRoute.view)showView(preferredRoute.view,false,false);}\nfunction restoreRoute(){preferredRoute=readRoute();if(!authenticated)return;selectedRef=preferredRoute.view==='jobs'?preferredRoute.ref:null;showView(preferredRoute.view);paintJobs();}\nwindow.addEventListener('popstate',restoreRoute);window.addEventListener('hashchange',restoreRoute);\nconst views=['overview','jobs','groq','system'];\nfunction showView(view,focus=true,persist=true){\n if(!views.includes(view))return;if(persist){preferredRoute={view,ref:view==='jobs'?selectedRef:preferredRoute.view===view?preferredRoute.ref:null};if(authenticated)writeRoute();}activeView=view;$('private').dataset.view=view;if(starfield&&persist)hudExpanded=true;renderHUD();for(const name of views){$('view-'+name).hidden=name!==view;$('nav-'+name).setAttribute('aria-current',name===view?'page':'false');}if(focus)$('heading-'+view).focus?.();if(view==='system'&&authenticated)void readUpdateStatus();\n}\nfunction inspectJob(row){\n $('inspector-empty').hidden=!!row;$('job-details').hidden=!row;\n const values=row?{ref:row.ref,state:row.state,created:formatTime(row.createdAt),updated:formatTime(row.updatedAt),result:row.resultAvailable?'Stored':'Not available',reason:reasons[row.reasonCode]}:{ref:'-',state:'-',created:'-',updated:'-',result:'-',reason:''};\n for(const [key,value] of Object.entries(values))$('detail-'+key).textContent=value;\n}\nfunction resetWorkspace(){\n selectedRef=null;$('navigation').hidden=true;$('activity-list').replaceChildren();$('jobs-filter').value='all';$('jobs-empty').hidden=true;inspectJob(null);showView('overview',false,false);\n $('groq-availability').textContent='Availability unknown';$('groq-blocking').textContent='No verified observation.';$('groq-blocking').hidden=false;\n}\nfunction renderKeyExpiry(data,age){\n const date=data?.groqKeyExpiresAt,left=date-Date.parse(data?.observedAt);\n $('groq-key').hidden=date===undefined;\n $('key-expiry').textContent=date!=null&&age>=-5000&&age<60000?(left<=0?'Expired · ':left<=604800000?'Expires soon · ':'Expires · ')+formatTime(date):'Expiry unknown';\n}\nfunction showGroq(data){\n $('groq-availability').textContent=data.service.providerReady===true?'Ready for an approved request':data.service.providerReady===false?'Not available for new work':'Availability unknown';\n $('groq-blocking').textContent=$('blocking').textContent||'The relay is available for approved work.';$('groq-blocking').hidden=!$('blocking').textContent;for(const state of states)$('groq-'+state).textContent=data.jobs[state]===null?'—':String(data.jobs[state]);\n}\nconst formatTime=value=>value===null?'Time unknown':new Date(value).toLocaleString([],{timeZoneName:'short'});\nfunction paintJobs(){\n let filter=$('jobs-filter').value;\n const matches=row=>filter==='all'||filter==='active'&&['queued','claimed','invoking'].includes(row.state)||filter==='attention'&&['uncertain','failed','blocked','cancelled','unknown'].includes(row.state)||filter==='completed'&&row.state==='completed';\n const selected=jobRows.find(row=>row.ref===selectedRef);\n if(preferredRoute.view==='jobs'&&preferredRoute.ref===selectedRef&&selected&&!matches(selected)){filter='all';$('jobs-filter').value='all';}\n const filtered=jobRows.filter(matches);\n if(!filtered.some(row=>row.ref===selectedRef))selectedRef=null;\n $('jobs-list').replaceChildren();$('jobs-empty').hidden=filtered.length!==0;\n for(const row of filtered){\n  const li=document.createElement('li'),button=document.createElement('button'),identity=document.createElement('span'),state=document.createElement('span'),time=document.createElement('span');li.dataset.state=row.state;button.type='button';button.className='job-row';button.setAttribute('aria-pressed',String(selectedRef===row.ref));button.setAttribute('aria-label','Inspect job '+row.ref.slice(0,12)+', '+row.state);\n  identity.className='job-ref';identity.textContent=row.ref.slice(0,12);state.className='job-state';state.textContent=row.state;time.className='job-time';time.textContent=formatTime(row.updatedAt);button.append(identity,state,time);button.addEventListener('click',()=>{selectedRef=row.ref;preferredRoute={view:'jobs',ref:row.ref};writeRoute();paintJobs();$('detail-ref').focus?.();});li.append(button);$('jobs-list').append(li);\n }\n inspectJob(jobRows.find(row=>row.ref===selectedRef)??null);for(const listId of ['activity-list','groq-activity']){\n $(listId).replaceChildren();\n for(const row of jobRows.slice(0,4)){const li=document.createElement('li'),ref=document.createElement('span'),state=document.createElement('span');ref.className='activity-ref';ref.textContent=row.ref.slice(0,12);state.className='activity-state';state.textContent=row.state;li.append(ref,state);$(listId).append(li);}\n if(jobRows.length===0){const li=document.createElement('li');li.textContent='No recorded activity in this observation.';$(listId).append(li);}\n }\n}\nfor(const view of views)$('nav-'+view).addEventListener('click',()=>showView(view));\n$('open-jobs').addEventListener('click',()=>showView('jobs'));$('groq-open-jobs').addEventListener('click',()=>showView('jobs'));\n$('jobs-filter').addEventListener('change',()=>{selectedRef=null;preferredRoute={view:'jobs',ref:null};writeRoute(true);paintJobs();});\nasync function loadJobs(append){\n if(!authenticated)return;const cursor=append?nextCursor:null;if(append&&!cursor)return;\n try{const page=projectJobs(await request('/jobs'+(cursor?'?cursor='+encodeURIComponent(cursor):'')));if(authenticated)renderJobs(page,append);}\n catch(error){if(error.status===401||error.status===403){showAuth('login','Please sign in to view private status.');return;}$('jobs-notice').textContent=latestJobs?'Recent jobs unavailable. Showing the previous observation from '+new Date(latestJobs.observedAt).toLocaleString()+'.':'Recent jobs unavailable. Refresh to try reading them again.';}\n}\nasync function boot(){\n if(pending)return;busy(true);clearPrivate();clearInputs();authMessage('');\n try{const state=await request('/auth/state');if(typeof state.enrolled!=='boolean')throw Error('state');if(!state.enrolled)showAuth('setup');else await status();}\n catch{showAuth('unknown','No private status has been loaded. Retry when the console is available.');}\n finally{busy(false);}\n}\nasync function submit(event,setup){\n event.preventDefault();if(pending)return;\n let password=$(setup?'new-password':'login-password').value,setupCode=$('setup-code').value;\n const length=passwordBytes(password);\n if(length<8||length>128){authMessage('Use a password between 8 and 128 UTF-8 bytes.');return;}\n if(setup&&password!==$('confirm-password').value){authMessage('The passwords do not match.');return;}\n if(setup&&(!setupCode||passwordBytes(setupCode)>256)){authMessage('Enter the one-time setup code.');return;}\n busy(true);authMessage('');const body=setup?{setupCode,password}:{password};clearInputs();password='';setupCode='';\n try{const result=await request(setup?'/auth/setup':'/auth/login',body);if(result.ok!==true)throw Error('auth_failed');body.password='';if(setup)body.setupCode='';await status();}\n catch(error){showAuth(setup&&error.message==='setup_unavailable'?'unknown':setup?'setup':'login',friendly(error));}\n finally{body.password='';if(setup)body.setupCode='';busy(false);}\n}\nasync function logout(){\n if(pending)return;preferredRoute={view:'overview',ref:null};writeRoute(true);busy(true);showAuth('login');\n try{const result=await request('/auth/logout',{});if(result.ok!==true)throw Error('logout');authMessage('Signed out.');}\n catch{authMessage('Could not confirm sign-out. Private status is hidden; the server session may still be active.');}\n finally{busy(false);}\n}\n$('setup-form').addEventListener('submit',event=>submit(event,true));$('login-form').addEventListener('submit',event=>submit(event,false));$('retry-auth').addEventListener('click',boot);$('logout').addEventListener('click',logout);$('refresh').addEventListener('click',async()=>{if(pending||!authenticated)return;busy(true);try{await status();}finally{busy(false);}});\nfor(const [id,append] of [['jobs-refresh',false],['jobs-more',true]])$(id).addEventListener('click',async()=>{if(pending||!authenticated)return;busy(true);try{await loadJobs(append);}finally{busy(false);}});\nconst preference=window.matchMedia('(prefers-reduced-motion: reduce)');\nfunction motion(){const reduced=preference.matches;$('console-surface').dataset.motion=paused||reduced||document.visibilityState==='hidden'?'off':'on';$('private').dataset.motion=paused||reduced?'off':'on';$('navigation').dataset.motion=paused||reduced?'off':'on';if(paused||reduced||document.visibilityState==='hidden'){for(const a of counterAnimations)a.cancel();counterAnimations.clear();}$('logo-wrap').classList.toggle('running',!paused&&!reduced&&document.visibilityState!=='hidden');$('motion').textContent=reduced?'Motion reduced':paused?'Resume motion':'Pause motion';$('motion').disabled=reduced;if(paused||reduced||document.visibilityState==='hidden')resetLook();$('motion').setAttribute('aria-pressed',String(paused));$('system-motion').textContent=$('motion').textContent;$('system-motion').disabled=reduced;$('system-motion').setAttribute('aria-pressed',String(paused));renderPower();}\n$('motion').addEventListener('click',()=>{paused=!paused;motion();});$('system-motion').addEventListener('click',()=>{paused=!paused;motion();});preference.addEventListener('change',motion);document.addEventListener('visibilitychange',()=>{motion();scheduleLiveRefresh();if(document.visibilityState!=='hidden'){refreshFreshness();if(authenticated&&!pending){clearTimeout(liveTimer);liveTimer=setTimeout(refreshLive,0);}}});\nwindow.addEventListener('pagehide',()=>{controller?.abort();clearPrivate();clearInputs();});window.addEventListener('pageshow',event=>{if(event.persisted){if(pending)resumePending=true;else void boot();}});let starClicks=0,lastStarClick=0,starfield=false,hudExpanded=false;\nfunction hudPanelState({ enabled = false, authenticated = false, expanded = false, view = 'overview' } = {}) {\n  const viewMap = {\n    overview: 660,\n    jobs: 760,\n    requests: 760,\n    groq: 560,\n    system: 560,\n  };\n  const isOwn = Object.prototype.hasOwnProperty.bind(viewMap);\n  const finalView = typeof view === 'string' && isOwn(view) ? view : 'overview';\n  const maxWidth = viewMap[finalView];\n\n  const trayVisible = enabled === true && authenticated === true;\n  const panelVisible = trayVisible && expanded === true;\n\n  return { trayVisible, panelVisible, view: finalView, maxWidth };\n}\n\nfunction renderHUD(){\n renderPower();\n const model=hudPanelState({enabled:starfield,authenticated,expanded:hudExpanded,view:activeView});\n $('console-surface').dataset.hudExpanded=String(model.panelVisible);$('hud-instruments').hidden=!model.trayVisible;$('hud-close').hidden=!model.panelVisible;$('private').dataset.width=String(model.maxWidth);\n $('hud-health').textContent=authenticated&&latest?$('health-heading').textContent:'Not checked';const j=latest?.jobs,age=Date.now()-Date.parse(latest?.observedAt),fresh=authenticated&&!statusFailed&&Number.isFinite(age)&&age>=-5000&&age<60000,known=fresh&&j&&[j.queued,j.invoking,j.completed].every(Number.isSafeInteger);$('hud-active').textContent=known?String(j.queued+j.invoking):'—';$('hud-done').textContent=known?String(j.completed):'—';$('hud-open-jobs').setAttribute('aria-label',known?'Jobs: '+(j.queued+j.invoking)+' active, '+j.completed+' completed':'Jobs: counts unavailable');\n for(const name of views){$('nav-'+name).setAttribute('aria-current',starfield&&!model.panelVisible?'false':activeView===name?'page':'false');if(starfield)$('nav-'+name).setAttribute('aria-expanded',String(hudExpanded&&activeView===name));else $('nav-'+name).removeAttribute?.('aria-expanded');}\n if(!authenticated){$('hud-next').hidden=true;$('hud-next').disabled=true;}\n}\n$('hud-ready').addEventListener('click',()=>showView('system'));$('hud-open-jobs').addEventListener('click',()=>showView('jobs'));$('hud-progress').addEventListener('click',()=>showView('overview'));$('hud-next').addEventListener('click',()=>{if(typeof trainingAction==='function')trainingAction();});\nfunction minimizeHUD(){hudExpanded=false;renderHUD();$('hud-ready').focus?.();}\n$('hud-close').addEventListener('click',minimizeHUD);\nfunction summarizeVmPower(sample,nowMs){\n const integer=n=>Number.isSafeInteger(n)&&n>=0,unknown=()=>({state:'unknown',label:'VM CPU',value:null,memoryPercent:null});\n if(!integer(nowMs)||sample===null||typeof sample!=='object'||Array.isArray(sample))return unknown();\n const {observedAtMs,cpuPercent,memoryUsedBytes,memoryTotalBytes}=sample;\n if(!integer(observedAtMs)||nowMs-observedAtMs< -5000||nowMs-observedAtMs>=60000||typeof cpuPercent!=='number'||!Number.isFinite(cpuPercent)||cpuPercent<0||cpuPercent>100)return unknown();\n const memoryPercent=integer(memoryUsedBytes)&&integer(memoryTotalBytes)&&memoryTotalBytes>0&&memoryUsedBytes<=memoryTotalBytes?Math.round(memoryUsedBytes/memoryTotalBytes*100):null;\n return {state:'ready',label:'VM CPU',value:Math.round(cpuPercent),memoryPercent};\n}\nfunction sceneRate(rate){for(const id of ['space-plane-0','space-plane-1'])for(const animation of $(id).getAnimations?.()??[])if(animation.playbackRate!==rate)animation.updatePlaybackRate?.(rate);}\nfunction clearPower(){for(const id of ['power-value','power-cpu','power-memory','power-relay','system-cpu','system-memory','system-relay-memory'])$(id).textContent='—';$('power-observed').textContent='Not checked';$('power-toggle').setAttribute('aria-label','VM CPU: unavailable');$('power-toggle').setAttribute('aria-expanded','false');$('power-details').hidden=true;sceneRate(1);resetLook();}\nfunction renderPower(){\n const r=latest?.resources,now=Date.now(),age=now-Date.parse(latest?.observedAt),fresh=authenticated&&!statusFailed&&Number.isFinite(age)&&age>=-5000&&age<60000;\n const sampleFresh=fresh&&r?.v===1&&r.scope==='vm'&&now-r.observedAtMs>=-5000&&now-r.observedAtMs<60000,v=summarizeVmPower(sampleFresh?r:null,now),cpu=v.value===null?'—':v.value+'%',memory=sampleFresh&&r.memoryUsedBytes!==null&&r.memoryTotalBytes>0?Math.round(r.memoryUsedBytes/r.memoryTotalBytes*100)+'%':'—';\n const relay=sampleFresh&&Number.isSafeInteger(r?.relayMemoryBytes)&&r.relayMemoryBytes>=0?Math.round(r.relayMemoryBytes/1048576)+' MB':'—';\n for(const id of ['power-value','power-cpu','system-cpu'])$(id).textContent=cpu;for(const id of ['power-memory','system-memory'])$(id).textContent=memory;for(const id of ['power-relay','system-relay-memory'])$(id).textContent=relay;\n $('power-observed').textContent=sampleFresh?formatTime(r.observedAtMs):'Not checked';$('power-toggle').setAttribute('aria-label',v.value===null?'VM CPU: unavailable':'VM CPU: '+cpu+'; open resource details');\n if(starfield&&!paused&&!preference.matches&&document.visibilityState!=='hidden')sceneRate(v.value===null?1:1+v.value*.003);\n}\n$('power-toggle').addEventListener('click',()=>{const open=$('power-details').hidden;$('power-details').hidden=!open;$('power-toggle').setAttribute('aria-expanded',String(open));});\n$('power-close').addEventListener('click',()=>{$('power-details').hidden=true;$('power-toggle').setAttribute('aria-expanded','false');$('power-toggle').focus?.();});\nlet lookX=0,lookY=0,lastLookAt=0;\nfunction setLook(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return;lookX=Math.max(-14,Math.min(14,x));lookY=Math.max(-10,Math.min(10,y));$('space-scene').style?.setProperty('--look-x',lookX.toFixed(2)+'px');$('space-scene').style?.setProperty('--look-y',lookY.toFixed(2)+'px');}\nfunction resetLook(){setLook(0,0);}\nfunction canLook(){return starfield&&authenticated&&!paused&&!preference.matches&&document.visibilityState!=='hidden';}\n$('console-surface').addEventListener('pointermove',e=>{if(!canLook()||!['mouse','pen'].includes(e.pointerType)||e.target!==$('console-surface')&&e.target!==$('cockpit-glass')&&e.target!==$('hud-instruments'))return;const at=Date.now();if(at-lastLookAt<33)return;lastLookAt=at;const box=$('console-surface').getBoundingClientRect?.();if(box?.width>0&&box.height>0)setLook((.5-(e.clientX-box.left)/box.width)*28,(.5-(e.clientY-box.top)/box.height)*20);});\n$('console-surface').addEventListener('pointerleave',resetLook);\n$('cockpit-glass').addEventListener('keydown',e=>{if(e.target!==$('cockpit-glass')||!canLook())return;const moves={ArrowLeft:[4,0],ArrowRight:[-4,0],ArrowUp:[0,3],ArrowDown:[0,-3]},step=Object.hasOwn(moves,e.key)?moves[e.key]:null;if(step){e.preventDefault?.();setLook(lookX+step[0],lookY+step[1]);}});\n\n$('console-surface').addEventListener('click',e=>{if(e.target!==$('console-surface')&&e.target!==$('cockpit-glass')&&e.target!==$('hud-instruments'))return;$('console-tools').open=false;$('power-details').hidden=true;$('power-toggle').setAttribute('aria-expanded','false');if(starfield&&authenticated&&hudExpanded)minimizeHUD();});window.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('feedback-dialog').open)return;if(!$('power-details').hidden){$('power-details').hidden=true;$('power-toggle').setAttribute('aria-expanded','false');$('power-toggle').focus?.();}else if(starfield&&hudExpanded)minimizeHUD();}});\n$('logo-wrap').addEventListener('click',()=>{const at=Date.now();starClicks=at-lastStarClick>5000?1:starClicks+1;lastStarClick=at;if(starClicks<5)return;starClicks=0;starfield=!starfield;hudExpanded=false;renderHUD();$('console-surface').dataset.starfield=String(starfield);if(starfield)renderPower();else resetLook();$('logo-wrap').setAttribute('aria-pressed',String(starfield));$('logo-wrap').title=starfield?'Starfield on · five clicks to switch off':'Click five times for the stars';});\n\nlet updateGeneration=0,updateState=null,updatePosting=false,updateReading=false;\nconst updateCopy={not_connected:'Ask your operator to connect the updater.',idle:'Ready',checking:'Checking for updates…',up_to_date:'You’re up to date.',installed:'Update installed.',held:'Update paused. Operator review needed.',failed:'Update failed. Operator review needed.',unknown:'Update outcome unknown. Check saved status.'};\nfunction renderUpdateStatus(v){\n if(v?.v!==1||typeof v.enabled!=='boolean'||!Object.hasOwn(updateCopy,v.state)||![v.requestedAt,v.finishedAt,v.retryAt].every(x=>x===null||Number.isSafeInteger(x)&&x>=0))throw Error('update_status');\n updateState=v;const cooldown=v.retryAt!==null&&Date.now()<v.retryAt;\n $('update-request-state').textContent=updateCopy[v.state]+(cooldown?' Next check '+formatTime(v.retryAt)+'.':'');\n $('update-check').textContent=v.state==='checking'?'Checking…':v.state==='unknown'?'Check saved status':'Check for updates';\n $('update-check').disabled=updatePosting||!v.enabled||v.state==='checking'||v.state==='held'||cooldown;\n $('update-check').setAttribute('aria-busy',String(v.state==='checking'));\n}\nasync function readUpdateStatus(){\n if(!authenticated||updateReading||updatePosting)return;const generation=updateGeneration;updateReading=true;\n try{const v=await request('/updates');if(authenticated&&generation===updateGeneration)renderUpdateStatus(v);}\n catch(e){if(generation!==updateGeneration)return;if(e.status===401||e.status===403){showAuth('login','Please sign in.');return;}$('update-request-state').textContent='Update status unavailable. Refresh to check.';$('update-check').disabled=true;}\n finally{updateReading=false;}\n}\n$('update-check').addEventListener('click',async()=>{\n if(!authenticated||updatePosting||$('update-check').disabled)return;if(updateState?.state==='unknown'){await readUpdateStatus();return;}\n const generation=updateGeneration;updatePosting=true;$('update-check').disabled=true;$('update-request-state').textContent='Requesting update check…';\n try{const v=await request('/updates',{});if(authenticated&&generation===updateGeneration){updatePosting=false;renderUpdateStatus(v);}}\n catch(e){if(generation!==updateGeneration)return;if(e.status===401||e.status===403){showAuth('login','Please sign in.');return;}updateState={v:1,enabled:true,state:'unknown',requestedAt:null,finishedAt:null,retryAt:null};updatePosting=false;renderUpdateStatus(updateState);}\n finally{if(generation===updateGeneration)updatePosting=false;}\n});\n\nmotion();void boot();\n})();\n</script></body></html>\n";

const FEEDBACK_STYLE=String.raw`
.feedback-dialog {width:min(90vw,490px);max-height:90dvh;overflow:auto;background:var(--bg);color:var(--text);border:1px solid var(--line);padding:18px}
.feedback-dialog::backdrop {background:#080c13cc}
.feedback-dialog label {display:block;margin-top:6px}
.feedback-dialog :is(input,select,textarea) {width:100%;background:var(--side);color:var(--text);padding:7px;font-size:16px}
`;

const FEEDBACK_DIALOG=String.raw`
<dialog id="feedback-dialog" class="feedback-dialog" aria-labelledby="feedback-heading">
<h2 id="feedback-heading">Feedback</h2>
<form id="feedback-form" autocomplete="off" novalidate>
<label for="feedback-kind">Type</label><select id="feedback-kind"><option value="feature">Feature request</option><option value="bug">Bug report</option></select>
<label for="feedback-title">Title</label><input id="feedback-title" maxlength="120" required autofocus>
<label for="feedback-details">Details</label><textarea id="feedback-details" maxlength="2400" rows="3" required></textarea>
<button>Preview</button><button id="feedback-close" type="button">Close</button>
</form>
<section id="feedback-preview" hidden>
<label for="feedback-draft">Issue draft</label><textarea id="feedback-draft" rows="5" readonly></textarea>
<p class="muted">GitHub issues are public. Use the first line as the title.</p>
<button id="feedback-copy" type="button">Copy draft</button><a href="https://github.com/bmartynowicz/picard-relay/issues/new" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open GitHub ↗</a>
</section>
<p id="feedback-note" class="muted" role="status"></p>
</dialog>
`;

const FEEDBACK_CLIENT=String.raw`
const feedback=part=>$('feedback-'+part);
function clearFeedbackPreview(){
 feedback('draft').value='';
 feedback('preview').hidden=true;
 feedback('note').textContent='';
}
function resetFeedback(){
 feedback('title').value=feedback('details').value='';
 clearFeedbackPreview();
}
function openFeedback(kind){
 if(!authenticated||feedback('dialog').open)return;
 resetFeedback();
 feedback('kind').value=kind;
 $('console-tools').querySelector?.('summary')?.focus();
 $('console-tools').open=false;
 feedback('dialog').showModal();
}
feedback('open').addEventListener('click',()=>openFeedback('feature'));
$('console-surface').addEventListener('contextmenu',e=>{
 if(!authenticated||!cockpit)return;
 if(!['console-surface','cockpit-glass','hud-instruments'].some(id=>e.target===$(id)))return;
 e.preventDefault();
 openFeedback('bug');
});
feedback('close').addEventListener('click',()=>feedback('dialog').close());
feedback('dialog').addEventListener('close',resetFeedback);
feedback('form').addEventListener('input',clearFeedbackPreview);
feedback('form').addEventListener('submit',e=>{
 e.preventDefault();
 clearFeedbackPreview();
 const title=feedback('title').value.trim(),details=feedback('details').value.trim();
 if(!title||title.length>120){feedback('note').textContent='Enter a title (1–120 characters).';return;}
 if(!details||details.length>2400){feedback('note').textContent='Enter a description (1–2400 characters).';return;}
 feedback('draft').value=(feedback('kind').value==='bug'?'Bug: ':'Feature: ')+title+'\n\n'+details;
 feedback('preview').hidden=false;
 feedback('draft').focus?.();
});
feedback('copy').addEventListener('click',async()=>{
 const draft=feedback('draft').value;
 if(!draft||!authenticated)return;
 let message='Draft copied.';
 try{await navigator.clipboard.writeText(draft);}
 catch{message='Select the draft and copy it manually.';}
 if(draft===feedback('draft').value)feedback('note').textContent=message;
});
`;

const RECOGNITION_CLIENT=String.raw`
function showRecognition(text=''){
 const mark=$('recognition');
 mark.textContent=text;
 mark.hidden=!text;
}
`;

const GROQ_REPLACEMENT_DIALOG=String.raw`
<dialog id="replace-groq-dialog" class="feedback-dialog" aria-labelledby="replace-groq-heading">
<h2 id="replace-groq-heading">Replace Groq key</h2>
<p><a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Create a key in Groq ↗</a></p>
<form id="replace-groq-form" autocomplete="off">
<label for="replace-groq-secret">New Groq key</label>
<input id="replace-groq-secret" type="password" autocomplete="off" spellcheck="false" maxlength="512" required autofocus>
<label class="groq-key-confirm"><input id="replace-groq-free" type="checkbox" required><span id="replace-groq-project"></span></label>
<div class="groq-key-actions"><button class="refresh" id="replace-groq-submit">Save key</button><button id="replace-groq-cancel" type="button">Cancel</button></div>
<p id="replace-groq-error" class="muted" role="status"></p>
</form>
</dialog>
`;

const GROQ_REPLACEMENT_CLIENT=String.raw`
const replacement=part=>$('replace-groq-'+part);
let keyStatus=null,keyChecking=false,keySaving=false,keyPendingId=null,keyGeneration=0;
const keyMessages={idle:'',checking:'Replacing key…',replaced:'Key replaced.',rejected:'Key replacement did not complete. The previous key is still active.',unknown:'Replacement status unknown. Refresh to check.'};
function clearGroqKeyForm(){
 replacement('secret').value='';replacement('free').checked=false;replacement('error').textContent='';
}
function resetGroqReplacement(){
 keyGeneration++;keyStatus=null;keyPendingId=null;keyChecking=false;keySaving=false;
 if(replacement('dialog').open)replacement('dialog').close();
 clearGroqKeyForm();replacement('submit').disabled=false;replacement('row').hidden=true;replacement('status').textContent='';
}
function renderGroqReplacement(status){
 status=status??{v:1,enabled:false,project:'',state:'unavailable',id:null};
 if(!status||status.v!==1||typeof status.enabled!=='boolean'||typeof status.project!=='string'
  ||(status.enabled&&!Object.hasOwn(keyMessages,status.state)))throw Error('key_status_invalid');
 keyStatus=status;replacement('row').hidden=!status.enabled&&!keyPendingId;
 if(status.id===keyPendingId&&['replaced','rejected'].includes(status.state))keyPendingId=null;
 replacement('open').disabled=Boolean(keyPendingId)||['checking','unknown'].includes(status.state);
 replacement('status').textContent=keyPendingId&&status.id!==keyPendingId?keyMessages.unknown:keyMessages[status.state]??'';
}
async function readGroqReplacement(){
 if(!authenticated||keyChecking||keySaving)return;
 const generation=keyGeneration;keyChecking=true;
 try{const status=await request('/groq/key');if(generation===keyGeneration){renderGroqReplacement(status);return status;}}
 catch{if(generation===keyGeneration&&keyPendingId)replacement('status').textContent=keyMessages.unknown;}
 finally{if(generation===keyGeneration)keyChecking=false;}
}
replacement('open').addEventListener('click',async()=>{
 if(!authenticated||!keyStatus?.enabled||replacement('open').disabled)return;
 const status=await readGroqReplacement();
 if(!status?.enabled||replacement('open').disabled)return;
 if(!status.recent){showAuth('login','Sign in again to replace your Groq key.');return;}
 clearGroqKeyForm();
 replacement('project').textContent='I created this key in '+keyStatus.project+' and confirmed Groq shows Free.';
 replacement('dialog').showModal();
});
replacement('cancel').addEventListener('click',()=>replacement('dialog').close());
replacement('dialog').addEventListener('close',clearGroqKeyForm);
replacement('form').addEventListener('submit',async event=>{
 event.preventDefault();
 if(!authenticated||keySaving||keyPendingId||!replacement('free').checked)return;
 const key=replacement('secret').value.trim();
 if(!/^gsk_[A-Za-z0-9_-]{20,508}$/.test(key)){
  replacement('error').textContent='Paste a Groq key beginning with gsk_.';return;
 }
 const generation=keyGeneration,id=crypto.randomUUID();
 keySaving=true;keyPendingId=id;replacement('submit').disabled=true;replacement('open').disabled=true;
 replacement('secret').value='';replacement('error').textContent='';
 try{const status=await request('/groq/key',{id,key,free:true});if(generation===keyGeneration){renderGroqReplacement(status);replacement('dialog').close();}}
 catch(error){
  if(generation!==keyGeneration)return;
  if([401,403,428].includes(error.status)){showAuth('login','Sign in again to replace your Groq key.');return;}
  if([400,409].includes(error.status)){keyPendingId=null;replacement('error').textContent=error.status===409?'Check the current replacement status first.':'Check the key and try again.';}
  else{replacement('dialog').close();replacement('status').textContent=keyMessages.unknown;}
 }finally{
  if(generation===keyGeneration){keySaving=false;replacement('submit').disabled=false;void readGroqReplacement();}
 }
});
`;

const STEALTH_STYLE=String.raw`
#cockpit-toggle{font-size:12px;padding-inline:8px}
#cockpit-toggle[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
@media(max-width:360px){.hud-instruments{grid-template-columns:repeat(2,minmax(0,1fr))}#hud-stealth kbd{display:block;margin-left:0}}
[data-stars=false] .space-scene{display:none!important}
.hud-instruments #hud-stealth{font-size:12px;white-space:nowrap;color:var(--muted)}
#hud-stealth kbd{margin-left:6px}
#stealth-settings{display:grid;gap:4px;padding:8px 12px;font-size:12px;color:var(--muted)}
#stealth-auto{width:100%;color:var(--text);background:var(--bg);border:1px solid var(--line);padding:8px}
[data-stealth=true]{--bg:#191919;--side:#222;--surface:#2c2c2c;--line:#434343;--accent:#dededb;--text:#f2f2ef;--muted:#b8b8b5;background:var(--bg)}
[data-stealth=true] :is(#logo-wrap,#training-rank,#training-title,#recognition,.sidebar-foot,.nav-index,.space-scene),[data-stealth=true] nav::before,[data-stealth=true] nav::after{display:none!important}
[data-stealth=true] :is(.brand,nav,.console-utilities,.workspace){background:transparent;border:0;box-shadow:none}
[data-stealth=true] .sidebar{background:var(--side);border-bottom:1px solid var(--line)}
[data-stealth=true] .workspace{width:100%;margin:0;max-width:1120px;justify-self:start}
[data-stealth=true] nav [aria-current=page]{background:var(--surface);color:var(--text);box-shadow:inset 2px 0 var(--accent)}
[data-stealth=true] .counts dd{font:600 24px/1.3 system-ui}
[data-stealth=true] .auth{border:0}
[data-stealth=true] .refresh:hover:not(:disabled){background:#fff}
[data-stealth=true] *,[data-stealth=true] *::before,[data-stealth=true] *::after{animation:none!important;transition:none!important}
#stealth-mode[aria-pressed=true]{background:var(--surface)}
@media(min-width:900px){
 .console[data-stealth=true]{grid-template-columns:196px minmax(0,1fr);grid-template-rows:1fr}
 [data-stealth=true] .sidebar{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;height:100svh;gap:16px;padding:20px 12px;border:0;border-right:1px solid var(--line)}
 [data-stealth=true] nav{flex-direction:column;padding:0}
 [data-stealth=true] nav button{justify-content:flex-start;padding-inline:12px}
 [data-stealth=true] .console-utilities{justify-content:space-between;margin-top:auto}
 [data-stealth=true] .console-menu{right:auto;left:0;top:auto;bottom:calc(100% + 8px)}
}
`;

const STEALTH_CLIENT=String.raw`
const stealthPreference='picard:stealth';
const cockpitPreference='picard:cockpit';
const stealthWhenHidden=2,stealthWhenIdle=4;
const stealthIdleMs=5*60_000;
let stealthFlags=0,stealthTimer;
let stealth=false,cockpitFlags=2,starfield=false;
function syncCockpit(){
 const hadStars=starfield,showControls=authenticated&&!stealth;
 const starsEnabled=Boolean(cockpitFlags&2);
 cockpit=showControls&&Boolean(cockpitFlags&1);
 starfield=cockpit&&starsEnabled;
 const surface=$('console-surface');
 surface.dataset.cockpit=String(cockpit);
 surface.dataset.starfield=String(starfield);
 surface.dataset.stars=String(starsEnabled);
 $('cockpit-toggle').hidden=!showControls;
 $('stars-toggle').hidden=!showControls;
 $('cockpit-toggle').setAttribute('aria-pressed',String(cockpit));
 $('stars-toggle').setAttribute('aria-pressed',String(starsEnabled));
 $('logo-wrap').setAttribute('aria-pressed',String(cockpit));
 $('logo-wrap').title=cockpit?'Cockpit on · five clicks to switch off':'Click five times for Cockpit';
 $('cockpit-glass').setAttribute('aria-label',starfield?'Space view; arrow keys look around':'Workspace');
 if(hadStars&&!starfield)resetLook();
 renderHUD();
}
function saveCockpit(){
 try{localStorage.setItem(cockpitPreference,String(cockpitFlags));}catch{}
}
function toggleCockpit(){
 if(!authenticated||stealth)return;
 cockpitFlags^=1;hudExpanded=activeView!=='overview';starClicks=0;
 saveCockpit();
 syncCockpit();
}
$('cockpit-toggle').addEventListener('click',toggleCockpit);
$('stars-toggle').addEventListener('click',()=>{
 if(!authenticated||stealth)return;
 cockpitFlags^=2;
 saveCockpit();
 syncCockpit();
});
function setStealth(enabled){
 stealth=enabled;starClicks=0;
 $('console-surface').dataset.stealth=String(enabled);
 $('stealth-mode').setAttribute('aria-pressed',String(enabled));
 $('brand-name').textContent=enabled?'Work Console':'Picard Relay';
 document.title=enabled?'Work Console':'Picard Relay — Console';
 syncCockpit();
 motion();
 armStealthIdle();
}
function saveStealth(){
 try{localStorage.setItem(stealthPreference,String(stealthFlags));}catch{}
}
function toggleStealth(){
 setStealth(!stealth);
 stealthFlags=(stealthFlags&6)|Number(stealth);
 saveStealth();
}
function armStealthIdle(){
 clearTimeout(stealthTimer);
 if(!stealth&&(stealthFlags&stealthWhenIdle)&&document.visibilityState!=='hidden'){
  stealthTimer=setTimeout(()=>setStealth(true),stealthIdleMs);
 }
}
function syncStealthVisibility(){
 if(!stealth&&(stealthFlags&stealthWhenHidden)&&document.visibilityState==='hidden')setStealth(true);
 else armStealthIdle();
}
$('stealth-mode').addEventListener('click',toggleStealth);
$('hud-stealth').addEventListener('click',()=>{
 toggleStealth();
 $('console-tools-toggle').focus?.();
});
$('stealth-auto').addEventListener('change',()=>{
 stealthFlags=(stealthFlags&1)|(Number($('stealth-auto').value)&6);
 saveStealth();
 syncStealthVisibility();
});
document.addEventListener('keydown',event=>{
 if(event.code==='KeyS'&&event.altKey&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.repeat
   &&!event.defaultPrevented&&!event.isComposing&&!event.target?.closest?.('input,select,textarea,[contenteditable]')){
  event.preventDefault();
  const focusHud=event.target?.id==='hud-stealth';
  toggleStealth();
  if(focusHud)$('console-tools-toggle').focus?.();
 }else if(stealthFlags&stealthWhenIdle)armStealthIdle();
});
for(const name of ['pointerdown','wheel'])document.addEventListener(name,()=>{
 if(stealthFlags&stealthWhenIdle)armStealthIdle();
},{passive:true});
try{
 const saved=localStorage.getItem(stealthPreference);
 if(/^[0-7]$/.test(saved))stealthFlags=Number(saved);
 const display=localStorage.getItem(cockpitPreference);
 if(/^[0-3]$/.test(display))cockpitFlags=Number(display);
}catch{}
$('stealth-auto').value=String(stealthFlags&6);
if(stealthFlags&1)setStealth(true);
else{syncCockpit();syncStealthVisibility();}
`;

const STEALTH_CONTROLS='<button id="stealth-mode" type="button" aria-pressed="false" aria-keyshortcuts="Alt+Shift+S">Stealth mode</button><label id="stealth-settings" for="stealth-auto">Auto stealth<select id="stealth-auto"><option value="0">Off</option><option value="2">When tab is hidden</option><option value="4">After 5 minutes idle</option><option value="6">When hidden or idle</option></select></label>';

const SAVINGS_STYLE=String.raw`
#codex-savings{margin:0 0 26px;padding:18px 0;border-bottom:1px solid var(--line)}
#codex-savings-headline{display:block;margin:6px 0 1px;font-size:clamp(20px,4vw,30px);line-height:1.2;color:var(--accent)}
#codex-savings-note{margin:5px 0 11px}
#codex-savings-runs details{border-top:1px solid var(--line);padding:7px 0;overflow-wrap:anywhere}
#codex-savings-runs summary{cursor:pointer;padding:4px 0;font-size:13px}
#codex-savings-runs p{margin:4px 0 4px 14px}
`;
const SAVINGS_PANEL='<section id="codex-savings" aria-labelledby="codex-savings-title"><h2 id="codex-savings-title">Savings</h2><strong id="codex-savings-headline">Savings not yet measured</strong><p class="muted" id="codex-savings-note">Connect Codex to record usage as you work.</p><div id="codex-savings-runs" aria-label="Recent Codex runs"></div></section>';
const SAVINGS_CLIENT=String.raw`
let lastCodexUsage='';
function renderCodexSavings(usage){
 const signature=JSON.stringify(usage??null);
 if(signature===lastCodexUsage)return;
 lastCodexUsage=signature;
 const list=$('codex-savings-runs');
 list.replaceChildren();
 const runs=Array.isArray(usage?.runs)?usage.runs:[];
 const measured=runs.find(run=>run.baselineTokens>0);
 const number=value=>value.toLocaleString();
 const headline=$('codex-savings-headline');
 const note=$('codex-savings-note');
 const usageChange=run=>{
  const difference=(Math.abs(run.savedTokens)*100/run.baselineTokens).toLocaleString(undefined,{maximumFractionDigits:1});
  return run.savedTokens===0?'Same total Codex tokens':difference+'% '+(run.savedTokens>0?'fewer':'more')+' total Codex tokens';
 };
 headline.textContent=measured?usageChange(measured):'Savings not yet measured';
 note.textContent=measured
  ?number(measured.baselineTokens)+' tokens on its own · '+number(measured.totalTokens)+' with Picard'
  :usage?.state==='unavailable'?'Usage records are temporarily unavailable.'
  :usage?.state==='ready'?(runs.length?'Run the same task both ways to measure savings.':'Waiting for the first completed Codex run.')
  :'Connect Codex to record usage as you work.';
 for(const run of runs){
  const detail=document.createElement('details');
  const title=document.createElement('summary');
  const label=run.variant==='baseline'?'Comparison baseline':run.tools.length?'With Picard':'Codex run';
  title.textContent=label+' · '+number(run.totalTokens)+' tokens · '+new Date(run.recordedAt).toLocaleString();
  detail.append(title);
  const row=text=>{const p=document.createElement('p');p.className='muted';p.textContent=text;detail.append(p);};
  row(run.model+' · '+number(run.inputTokens)+' input ('+number(run.cachedInputTokens)+' cached) · '+number(run.outputTokens)+' output');
  if(run.tools.length)row('Picard tools used · '+run.tools.join(', '));
  if(run.comparisonId)row('Comparison · '+run.comparisonId);
  if(run.baselineTokens>0)
   row('Fresh input and output · '+number(run.baselineFreshTokens)+' tokens on its own · '+number(run.totalTokens-run.cachedInputTokens)+' with Picard');
  else if(run.variant!=='baseline')row('Savings not yet measured');
  list.append(detail);
 }
}
`;

export const CONSOLE_HTML=CONSOLE_SHELL_HTML
  .replaceAll('starfield','cockpit')
  .replaceAll(/data-cockpit="true"(?= \.space-(?:plane|scene))/g,'data-starfield="true"')
  .replace('if(cockpit&&!paused','if(starfield&&!paused')
  .replace('return cockpit&&authenticated&&!paused','return starfield&&authenticated&&!paused')
  .replace('const previous=latest;authenticated=true;', "const previous=latest;if(!authenticated){authenticated=true;hudExpanded=preferredRoute.view!=='overview';syncCockpit();}")
  .replace('authenticated=false;latest=null;statusFailed=false;hudExpanded=false;renderHUD();','authenticated=false;latest=null;statusFailed=false;hudExpanded=false;syncCockpit();')
  .replace('</style>',FEEDBACK_STYLE+STEALTH_STYLE+SAVINGS_STYLE+'#recognition{display:block;color:var(--accent)}.groq-key-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 18px}.feedback-dialog .groq-key-confirm{display:flex;gap:8px;align-items:baseline}.feedback-dialog .groq-key-confirm input{width:auto;flex:none}</style>')
  .replace('<div class="section-title"><h2>Recent activity',SAVINGS_PANEL+'<div class="section-title"><h2>Recent activity')
  .replace('<p>Picard Relay</p>','<p id="brand-name">Picard Relay</p>')
  .replace('id="training-rank" hidden></small>','id="training-rank" hidden></small><small id="recognition" hidden></small>')
  .replace('function clearPrivate(){','function clearPrivate(){\n showRecognition();resetGroqReplacement();renderCodexSavings();')
  .replace("render(project(await request('/status')));","const data=await request('/status');render(project(data));renderCodexSavings(data.codexUsage);showRecognition(typeof data.recognition==='string'?data.recognition:'');if(!keySaving)renderGroqReplacement(data.keyReplacement);")
  .replace('<summary aria-label="Documentation and account"','<summary id="console-tools-toggle" aria-label="Documentation and account"')
  .replace('<div id="refresh-control"','<button id="cockpit-toggle" type="button" aria-pressed="false" hidden>Cockpit</button><div id="refresh-control"')
  .replace('<button class="logout"',STEALTH_CONTROLS+'<button id="stars-toggle" class="motion" type="button" aria-pressed="true" hidden>Cockpit stars</button><button id="feedback-open" type="button" hidden>Feedback</button><button class="logout"')
  .replace('<button id="hud-next"','<button id="hud-stealth" type="button" aria-keyshortcuts="Alt+Shift+S">Stealth <kbd>Alt+Shift+S</kbd></button><button id="hud-next"')
  .replace('<div class="provider-activity">','<div id="replace-groq-row" class="groq-key-actions" hidden><button id="replace-groq-open" type="button">Replace key</button><span id="replace-groq-status" class="muted" role="status"></span></div><div class="provider-activity">')
  .replace('</main>',FEEDBACK_DIALOG+GROQ_REPLACEMENT_DIALOG+'</main>')
  .replace('const roll=typeof previous','const roll=!stealth&&typeof previous')
  .replace('const reduced=preference.matches;','const reduced=stealth||preference.matches;')
  .replace("$('motion').textContent=reduced?","$('motion').textContent=stealth?'Motion off':reduced?")
  .replace("cockpit=!cockpit;hudExpanded=false;renderHUD();$('console-surface').dataset.cockpit=String(cockpit);if(cockpit)renderPower();else resetLook();$('logo-wrap').setAttribute('aria-pressed',String(cockpit));$('logo-wrap').title=cockpit?'Starfield on · five clicks to switch off':'Click five times for the stars';",'toggleCockpit();')
  .replace("document.addEventListener('visibilitychange',()=>{motion();","document.addEventListener('visibilitychange',()=>{syncStealthVisibility();motion();")
  .replace('motion();void boot();',FEEDBACK_CLIENT+RECOGNITION_CLIENT+GROQ_REPLACEMENT_CLIENT+STEALTH_CLIENT+SAVINGS_CLIENT+'\nmotion();void boot();');
export function loadOracleConfig(e=process.env){
 if(e.BRIDGE_ENABLED!=='true')return {enabled:false};
 const secret=e.BRIDGE_HMAC_SECRET_FILE?readFileSync(e.BRIDGE_HMAC_SECRET_FILE,'utf8').trim():'';
 const c={enabled:true,keyId:e.BRIDGE_KEY_ID??'',secret,ownerId:e.BRIDGE_OWNER_ID??'',assistantId:e.BRIDGE_ASSISTANT_ID??'',allowedTaskId:e.BRIDGE_ALLOWED_TASK_ID??'',dbPath:e.BRIDGE_DB_PATH??'',port:Number(e.BRIDGE_PORT??8787),stopPath:e.BRIDGE_STOP_PATH??null,controlSocket:e.BRIDGE_CONTROL_SOCKET??'',releaseHash:e.BRIDGE_RELEASE_HASH??'',workspaceEnabled:e.BRIDGE_WORKSPACE_ENABLED==='true',admissionEnabled:e.BRIDGE_ADMISSION_ENABLED==='true',admissionSignedBridgeEnabled:e.BRIDGE_ADMISSION_SIGNED_BRIDGE_ENABLED==='true',admissionReusableBoardEnabled:e.BRIDGE_ADMISSION_REUSABLE_BOARD_ENABLED==='true',admissionCatalogueFile:e.BRIDGE_ADMISSION_CATALOGUE_FILE??'',admissionLegacyBaselineFile:e.BRIDGE_ADMISSION_LEGACY_BASELINE_FILE??'',admissionLegacyBaselineSha256:e.BRIDGE_ADMISSION_LEGACY_BASELINE_SHA256??'',consoleEnabled:e.BRIDGE_CONSOLE_ENABLED==='true',consoleAuthDir:e.BRIDGE_CONSOLE_AUTH_DIR??'',consoleOrigins:(()=>{try{return JSON.parse(e.BRIDGE_CONSOLE_ORIGINS??'[]');}catch{return [];}})()};
 c.recognition=contributionRecognition(e.BRIDGE_CONTRIBUTION_CREDITS);
 c.recognitionLogin=e.BRIDGE_CONTRIBUTION_GITHUB_LOGIN??'';
 c.codexUsageTokenFile=e.BRIDGE_CODEX_USAGE_TOKEN_FILE??'';
 if(c.workspaceEnabled&&(!c.admissionEnabled||!c.admissionReusableBoardEnabled||!c.consoleEnabled))throw Error('workspace_configuration_unavailable');
 if(c.assistantId==='groq:openai/gpt-oss-20b'&&(!c.allowedTaskId||c.allowedTaskId.length>200))throw Error('production_configuration_unavailable');
 if(!validConfig(c)||!c.ownerId||!c.assistantId||!c.dbPath||c.dbPath===':memory:'||!Number.isSafeInteger(c.port)||c.port<1024||c.port>65535||e.BRIDGE_LOCAL_TEST_MODE==='true')throw Error('production_configuration_unavailable');
 return c;
}
export async function main(){
 const config=loadOracleConfig();if(!config.enabled){console.log(JSON.stringify({state:'disabled'}));return;}
 if(config.admissionEnabled===true){const {prepareAdmissionRuntime}=await import('./admission-runtime.mjs');const feature=prepareAdmissionRuntime({activationEnabled:true,config});return startOracleService(config,feature.adapter,{admissionFactory:feature.attach});}
 return startOracleService(config,createSelectedAssistantAdapter());
}
export async function startOracleService(config,assistantAdapter,{intervalMs=1000,installSignals=true,admissionFactory=null,readResources=createVmTelemetry()}={}){
 if(assistantAdapter?.localTestOnly===true||assistantAdapter?.kind==='controlled-local-fixture-only')throw Error('production_fixture_executor_forbidden');
 // No provider/API/model/command fallback. This is the sole external runtime
 // Unconfigured adapters fail closed; a spent one-shot adapter may serve saved results.
 if((assistantAdapter.ready!==true&&assistantAdapter.canServeResults!==true)||assistantAdapter.assistantId!==config.assistantId)throw Error('assistant_invocation_unavailable');
 let store,live=false;
 const control=createRuntimeControl({socketPath:config.controlSocket,releaseHash:config.releaseHash,stats:()=>store.stats(),providerReady:()=>assistantAdapter.ready===true,providerAvailability:()=>assistantAdapter.availability?.(),resultRecoveryReady:()=>live,serviceReady:()=>live});
 store=createRelayStore({...config,canAccept:()=>control.accepting});
 const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 let dispatcher,admission=null;
 let stopping=false,shutdownPromise=null,finishBusy=null;
 let consoleAuth=null;
 if(config.consoleEnabled===true){try{consoleAuth=createOwnerAuth({stateDir:config.consoleAuthDir});}catch{/* Console fails closed; independent signed bridge remains available. */}}
 let codexUsage=null,codexUsageKey=null;
 if(consoleAuth&&config.codexUsageTokenFile){
  try{codexUsageKey=codexUsageTokenHash(config.codexUsageTokenFile);codexUsage=store.openCodexUsage(config.ownerId);}
  catch{console.error('Codex usage recording could not be enabled.');}
 }
 if(config.admissionEnabled===true){try{if(typeof admissionFactory!=='function')throw Error('admission_configuration_invalid');admission=admissionFactory({store,control,auth:consoleAuth,baseHtml:CONSOLE_HTML});}catch{admission?.close();store.close();throw Error('admission_configuration_invalid');}}
 const receiver=createReceiver({store,config,assistantAdapter,canAccept:()=>control.accepting,runtimeHealth:()=>control.health(),gradeResult:admission?.gradeResult,readGrade:admission?.readGrade});
 dispatcher=createDispatcher({store:admission?.dispatchStore??store,boardAdapter,assistantAdapter,production:true,enabled:true,dbPath:config.dbPath,workerId:'oracle-relay',claimTtlMs:60000});
 // Reusable Board admission accepts separately approved tasks for this owner.
 // Its console must use that same owner scope, not the legacy catalogue task.
 const consoleScope={ownerId:config.ownerId,allowedTaskId:config.admissionEnabled===true&&config.admissionReusableBoardEnabled===true?'':config.allowedTaskId??''};
 const recognition=config.consoleEnabled===true&&config.recognitionLogin?createContributionRecognition({login:config.recognitionLogin}):null;
 const consoleHandler=createConsoleHandler({enabled:config.consoleEnabled===true,html:admission?.html??CONSOLE_HTML,auth:consoleAuth,origins:config.consoleOrigins,recognition:recognition?.read??config.recognition,updates:createUpdateRequestBridge({enabled:process.env.BRIDGE_OWNER_UPDATES_ENABLED==='true'}),groqReplacement:admission?.groqReplacement,codexUsage,codexUsageKey,getSnapshot:()=>consoleSnapshot(control.health(),store.scopedStats(consoleScope),new Date(),consoleScope.allowedTaskId?'task':'owner',readResources(),admission?.groqKeyExpiresAt),getRecentJobs:query=>store.recentJobs({...query,...consoleScope})});
 const server=createServer(async(req,res)=>{try{
  // TLS/auth for the opt-in console terminate at the approved reverse proxy.
  if(admission&&await admission.handler(req,res))return;
  if(await consoleHandler(req,res))return;
  // Signed bridge authorization remains separate; loopback only.
  if(req.method!=='POST'||req.url!=='/bridge/v1'){res.writeHead(404).end();return;}
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>24576){res.writeHead(413).end();req.destroy();return;}chunks.push(chunk);}
  const request=new Request('https://relay.invalid/bridge/v1',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),reply=await receiver(request);
  res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());
 }catch{res.writeHead(503).end();}});
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=16;
 try{await control.start();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}catch(e){await control.close();admission?.close();store.close();throw e;}
 live=true;
 const timer=setInterval(async()=>{if(stopping||!control.accepting||control.busy)return;if(config.stopPath&&existsSync(config.stopPath)){shutdown();return;}if(!control.tryBegin())return;try{const result=await dispatcher.runOnce();if(result.status!=='idle')console.log(JSON.stringify({state:result.status,eventId:result.requestId,attempt:result.attempt,code:result.code}));}finally{control.finish();if(finishBusy)finishBusy();}},intervalMs);
 function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  stopping=true;control.drain();clearInterval(timer);recognition?.close();
  shutdownPromise=(async()=>{
   await Promise.all([new Promise(resolve=>server.close(resolve)),control.close(),control.busy?new Promise(resolve=>{finishBusy=resolve;}):Promise.resolve()]);
   live=false;admission?.close();store.close();if(installSignals){process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);}
  })();return shutdownPromise;
 }
 if(installSignals){process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);}
 console.log(JSON.stringify({state:'started',storage:'file',bind:'loopback'}));
 return {shutdown,control,address:()=>server.address()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({state:'startup_blocked',code:error.message==='assistant_invocation_unavailable'?error.message:'configuration_or_startup_failed'}));process.exitCode=2;});
