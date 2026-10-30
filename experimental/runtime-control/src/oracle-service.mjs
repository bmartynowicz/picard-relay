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
function passwordBytes(password){requestCheck(typeof password==='string'&&password.length<=128);const bytes=Buffer.from(password,'utf8');requestCheck(bytes.length>=12&&bytes.length<=128&&bytes.toString('utf8')===password);return bytes;}
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
  async authenticate(token){if(!encoded(token,32))return false;try{return await publicRead((state,at)=>matches(state,token,at));}catch{return false;}},
  async logout(token){if(!encoded(token,32))return false;return locked(async(ctx,state,at)=>{if(!matches(state,token,at))return false;state.session=null;await persist(ctx,state,at);return true;});},
 });
}

return {createOwnerAuth,createBootstrapState};
})();
export const createOwnerAuth=ownerAuthCore.createOwnerAuth;
export const createBootstrapState=ownerAuthCore.createBootstrapState;

import {createRuntimeControl} from './runtime-control.mjs';
// In tribute to Sir Patrick Stewart. Make it so.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRelayStore} from './relay-store.mjs';
import {createReceiver,healthDiagnostics} from './receiver.mjs';
import {createSelectedAssistantAdapter} from './selected-assistant.mjs';
import {createDispatcher} from './dispatcher.mjs';
import {validConfig} from './protocol.mjs';

// Opt-in console is protected by the administrator's HTTPS reverse proxy.
// It exposes only a projection, never the ledger/control object or credentials.
export function consoleSnapshot(health,rows,now=new Date()){
 const flag=name=>typeof health?.[name]==='boolean'?health[name]:null;
 const diagnostic=healthDiagnostics({rows,runtimeHealth:health});
 const jobs=Object.fromEntries(['queued','invoking','completed','uncertain'].map(state=>[state,diagnostic.ledgerStateCounts?.[state]??null]));
 return {v:1,service:{ready:flag('serviceReady'),resultRecoveryReady:flag('resultRecoveryReady'),providerReady:flag('providerReady'),acceptingNewWork:flag('acceptingNewWork'),draining:flag('draining')},jobs,release:{hash:diagnostic.release.hash,version:null},updater:{state:'unknown'},observedAt:now.toISOString()};
}
export function createConsoleHandler({enabled=false,html='',getSnapshot,auth=null,origins=[]}={}){
 if(typeof html!=='string'||Buffer.byteLength(html)>131072)throw Error('console_document_invalid');
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
  if(!enabled||!((req.method==='GET'&&['/','/status','/auth/state'].includes(path))||(req.method==='POST'&&['/auth/setup','/auth/login','/auth/logout'].includes(path))))return false;
  const reply=(status,body,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(body));return true;};
  let origin=null;try{const host=req.headers.host;if(typeof host==='string'){const u=new URL('https://'+host);if(u.host===host&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password)origin=u.origin;}}catch{}
  if(!origin||!allowed.has(origin))return reply(403,{error:'auth_failed'});
  if(req.method==='POST'&&(req.headers.origin!==origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])))return reply(403,{error:'auth_failed'});
  if(path==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(html);return true;}
  if(!auth)return reply(503,{error:'auth_unavailable'});
  try{
   if(path==='/auth/state'){const state=await auth.readPublicState();if(typeof state?.enrolled!=='boolean')throw Error('auth_unavailable');return reply(200,{enrolled:state.enrolled});}
   if(path==='/status'){
    if(!await auth.authenticate(tokenFrom(req)))return reply(401,{error:'auth_failed'});
    return reply(200,getSnapshot());
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
export const CONSOLE_HTML="<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"color-scheme\" content=\"dark\">\n<title>Picard Relay — Console</title>\n<style>\n:root{color-scheme:dark;--bg:#111719;--surface:#182023;--line:#344044;--text:#ecede8;--muted:#a5b1b3;--accent:#d8bb7e;--good:#a5d4bc;--warn:#f0c184}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}button{font:inherit;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}button:disabled{cursor:wait;opacity:.6}.console{max-width:900px;margin:7vh auto;padding:0 34px 20px;background:var(--surface);border:1px solid var(--line);border-radius:6px}header{display:flex;align-items:center;gap:18px;min-height:140px;border-bottom:1px solid var(--line)}.identity{flex:1}.kicker{margin:0;color:var(--accent);font:11px/1.5 ui-monospace,Consolas,monospace;letter-spacing:.16em;text-transform:uppercase}h1{margin:5px 0 2px;font-size:26px;font-weight:500;letter-spacing:-.04em}.subtle{color:var(--muted);font-size:12px}.identity p:last-child{margin:0}.logo-wrap{width:64px;flex:none;text-align:center;perspective:200px}.logo{display:inline-block;text-align:left;margin:0;font:2px/3px ui-monospace,Consolas,\"Liberation Mono\",monospace;white-space:pre;color:var(--accent);transform-origin:center;animation:turn 18s linear infinite;animation-play-state:paused}.logo-wrap.running .logo{animation-play-state:running}.motion{display:block;border:0;background:none;padding:3px 0;width:100%;font-size:10px;color:var(--muted);text-decoration:underline;text-underline-offset:3px}.refresh{border:1px solid #536064;background:transparent;border-radius:4px;padding:8px 14px;font-size:12px}.signal{display:flex;align-items:baseline;justify-content:space-between;gap:20px;padding:24px 0 18px}.signal h2{margin:0;font-size:23px;font-weight:450;letter-spacing:-.03em}.signal h2:before{content:\"\";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);margin:0 10px 3px 0}.signal h2[data-tone=good]:before{background:var(--good)}.signal h2[data-tone=warn]:before{background:var(--warn)}.signal p{margin:0}.notice{margin:0 0 18px;color:var(--warn);font-size:13px}.notice[hidden]{display:none}.readiness{margin:0;display:flex;flex-wrap:wrap;gap:12px 26px;padding-bottom:24px}.readiness div{display:flex;gap:8px}.readiness dt{color:var(--muted);font-size:12px}.readiness dd{margin:0;font-size:12px}.good{color:var(--good)}.muted{color:var(--muted)}.ledger{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:20px 0 23px}.section-title{display:flex;justify-content:space-between;gap:16px;align-items:baseline;margin-bottom:16px}.section-title h3,.runtime h3{font-size:11px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin:0}.section-title p{margin:0;font-size:11px;color:var(--muted)}.counts{display:grid;grid-template-columns:repeat(4,1fr);margin:0}.counts div{padding-left:25px;border-left:1px solid var(--line)}.counts div:first-child{padding-left:0;border-left:0}.counts dt{font-size:12px;color:var(--muted)}.counts dd{font:32px/1.4 ui-monospace,Consolas,monospace;margin:3px 0 0;letter-spacing:-.05em;font-variant-numeric:tabular-nums}.counts dd.unknown{font-size:24px;line-height:1.87;color:var(--muted)}.runtime{padding:21px 0 18px;display:grid;grid-template-columns:1fr 1fr;gap:22px 32px}.runtime h3{grid-column:1/-1}.runtime dl{margin:0;display:grid;grid-template-columns:105px 1fr;gap:9px 12px;font-size:12px;align-content:start}.runtime dt{color:var(--muted)}.runtime dd{margin:0;min-width:0}.runtime details{grid-column:1/-1;font-size:11px;color:var(--muted)}.runtime summary{cursor:pointer}.fingerprint{overflow-wrap:anywhere;margin:8px 0 0;font-family:ui-monospace,Consolas,monospace}.footer{display:flex;justify-content:space-between;gap:16px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}.footer p{margin:0}.footer .motto{color:var(--accent);white-space:nowrap;letter-spacing:.08em}@keyframes turn{from{transform:rotateY(0deg)}to{transform:rotateY(360deg)}}@media(prefers-reduced-motion:reduce){.logo,.logo-wrap.running .logo{animation:none!important;transform:none!important}}@media(max-width:640px){.console{margin:0;min-height:100vh;border:0;border-radius:0;padding:0 22px 20px}header{gap:12px;min-height:132px}.logo-wrap{width:51px}h1{font-size:23px}.refresh{padding:8px 10px}.signal{align-items:flex-start;flex-direction:column;gap:5px;padding-top:22px}.signal h2{font-size:22px}.readiness{gap:10px 18px}.counts div{padding-left:14px}.counts dd{font-size:29px}.section-title{display:block}.section-title p{margin-top:5px}.runtime{grid-template-columns:1fr;gap:14px}.runtime h3{margin-bottom:1px}.runtime dl{grid-template-columns:110px 1fr}.footer{font-size:10px;gap:10px}.kicker{font-size:10px}.subtle{font-size:11px}}@media(max-width:360px){.console{padding-left:16px;padding-right:16px}.counts div{padding-left:9px}.counts dt{font-size:11px}.identity .subtle{max-width:115px}.logo-wrap{width:44px}.refresh{padding:7px;font-size:11px}}\n[hidden]{display:none!important}.header-actions{display:flex;gap:8px}.logout{border:0;background:none;color:var(--muted);font-size:12px;padding:8px}.auth{padding:27px 0 30px;max-width:440px}.auth h2{margin:0 0 7px;font-size:22px;font-weight:450}.auth p{margin:0 0 20px;color:var(--muted);font-size:13px}.auth label{display:block;color:var(--muted);font-size:12px;margin:16px 0 6px}.auth input{display:block;width:100%;border:1px solid #536064;background:var(--bg);color:var(--text);border-radius:4px;padding:10px 12px;font:16px system-ui;box-sizing:border-box}.auth input:focus{outline:2px solid var(--accent);outline-offset:2px}.auth-submit{margin-top:22px;background:var(--accent);color:#172023;border:0;border-radius:4px;padding:10px 18px;font-weight:500}.auth .auth-message{color:var(--warn);margin:18px 0 0}.auth .hint{font-size:11px;margin-top:6px}.auth .retry{margin-top:8px}.signed-label{color:var(--good);font-size:11px;margin:0 0 12px}@media(max-width:640px){.header-actions{flex-direction:column;gap:0}.logout{text-align:right}.auth{max-width:none}}\n</style>\n</head>\n<body>\n<main class=\"console\" aria-label=\"Picard Relay status console\">\n<header>\n<div class=\"logo-wrap\" id=\"logo-wrap\"><pre class=\"logo\" id=\"logo\" role=\"img\" aria-label=\"Picard Relay ASCII Starfleet insignia\">                    ###\n                   ## ##\n                  ##   ##\n                 ##     ##\n                ##       ##\n           ######        #######\n         ####  ##    #    ##  ####\n       ###    ##     #     ##    ####\n     ###      #      ##     ##      ##\n    ##       #      ###     ##       ##\n  ###       ##      ###      ##       ###\n  ##       ##       ###       ##       ##\n ##        #     #########     #        ##\n ##       ##       #####       ##       ##\n##       ##        ##  ##       ##       ##\n##       #                       #       ##\n ##     ##                       ##     ##\n ##     #             #######     #     ##\n  ##   ##          ####     ###   ##   ##\n  ### ##         ###          ##   #  ###\n   #####       ###             ##  ####\n     ##      ###                ## ###\n     ##    ###                   #####\n     ##  ####                 ########\n     # #### #######    ########    ###\n    #####        #########          ##\n    ###                              #\n    #</pre><button class=\"motion\" id=\"motion\" type=\"button\" aria-pressed=\"false\">Pause logo</button></div>\n<div class=\"identity\"><p class=\"kicker\">Picard Relay</p><h1>Mission status</h1><p class=\"subtle\">Self-hosted · private console</p></div>\n<div class=\"header-actions\"><button class=\"refresh\" id=\"refresh\" type=\"button\" hidden>Refresh</button><button class=\"logout\" id=\"logout\" type=\"button\" hidden>Sign out</button></div>\n</header>\n<section class=\"auth\" id=\"auth\" aria-labelledby=\"auth-heading\">\n<h2 id=\"auth-heading\">Checking sign-in</h2><p id=\"auth-description\">Connecting to this Picard console.</p>\n<form id=\"setup-form\" hidden>\n<label for=\"setup-code\">One-time setup code</label><input id=\"setup-code\" type=\"password\" autocomplete=\"one-time-code\" maxlength=\"256\" required spellcheck=\"false\" autocapitalize=\"none\">\n<p class=\"hint\">Use the expiring code delivered separately. Do not put it in a URL.</p>\n<label for=\"new-password\">Create your password</label><input id=\"new-password\" type=\"password\" autocomplete=\"new-password\" required maxlength=\"128\">\n<p class=\"hint\">12–128 UTF-8 bytes. Most ordinary characters use one byte.</p>\n<label for=\"confirm-password\">Confirm password</label><input id=\"confirm-password\" type=\"password\" autocomplete=\"new-password\" required maxlength=\"128\">\n<button class=\"auth-submit\" id=\"setup-submit\" type=\"submit\">Set password & sign in</button>\n</form>\n<form id=\"login-form\" hidden><label for=\"login-password\">Password</label><input id=\"login-password\" type=\"password\" autocomplete=\"current-password\" required maxlength=\"128\"><button class=\"auth-submit\" id=\"login-submit\" type=\"submit\">Sign in</button></form>\n<p class=\"auth-message\" id=\"auth-message\" role=\"status\" aria-live=\"polite\" hidden></p><button class=\"refresh retry\" id=\"retry-auth\" type=\"button\" hidden>Retry</button>\n</section>\n<div id=\"private\" hidden>\n<section aria-labelledby=\"health-heading\">\n<div class=\"signal\"><h2 id=\"health-heading\" data-tone=\"unknown\">Not yet checked</h2><p class=\"subtle\" id=\"checked\">No observation yet</p></div>\n<p class=\"notice\" id=\"notice\" role=\"status\" aria-live=\"polite\" hidden></p>\n<dl class=\"readiness\"><div><dt>Provider</dt><dd id=\"provider\">Unknown</dd></div><div><dt>Result recovery</dt><dd id=\"recovery\">Unknown</dd></div><div><dt>New work</dt><dd id=\"accepting\">Unknown</dd></div><div><dt>Draining</dt><dd id=\"draining\">Unknown</dd></div></dl>\n</section>\n<section class=\"ledger\" aria-labelledby=\"jobs-heading\"><div class=\"section-title\"><h3 id=\"jobs-heading\">Job ledger</h3><p>Configured relay scope · not all Board tasks</p></div><dl class=\"counts\"><div><dt>Queued</dt><dd class=\"unknown\" id=\"queued\">—</dd></div><div><dt>Invoking</dt><dd class=\"unknown\" id=\"invoking\">—</dd></div><div><dt>Completed</dt><dd class=\"unknown\" id=\"completed\">—</dd></div><div><dt>Uncertain</dt><dd class=\"unknown\" id=\"uncertain\">—</dd></div></dl></section>\n<section class=\"runtime\" aria-labelledby=\"runtime-heading\"><h3 id=\"runtime-heading\">Runtime & release</h3><dl><dt>Version</dt><dd id=\"version\">Not reported</dd><dt>Release</dt><dd id=\"release\">Unknown</dd></dl><dl><dt>Updater</dt><dd id=\"updater\">Unknown</dd><dt>Last activity</dt><dd>Not reported</dd></dl><details><summary>Release fingerprint</summary><p class=\"fingerprint\" id=\"fingerprint\">No verified observation</p></details></section>\n</div>\n<footer class=\"footer\"><p>Private status. Manual refresh. No AI calls.<br>Service health does not authorize work or verify an update.</p><p class=\"motto\">MAKE IT SO.</p></footer>\n</main>\n<script>\n'use strict';\n(function(){\nconst $=id=>document.getElementById(id),states=['queued','invoking','completed','uncertain'];\nlet pending=false,controller=null,latest=null,paused=false,authenticated=false,authMode='unknown',resumePending=false;\nconst object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};\nconst passwordBytes=value=>new TextEncoder().encode(value).length;\nfunction clearInputs(){for(const id of ['setup-code','new-password','confirm-password','login-password'])$(id).value='';}\nfunction clearPrivate(){\n authenticated=false;latest=null;$('private').hidden=true;$('refresh').hidden=true;$('logout').hidden=true;\n $('health-heading').textContent='Not yet checked';$('health-heading').dataset.tone='unknown';$('checked').textContent='No observation yet';$('checked').title='';$('notice').textContent='';$('notice').hidden=true;\n for(const id of ['provider','recovery','accepting','draining']){$(id).textContent='Unknown';$(id).className='muted';}\n for(const state of states){$(state).textContent='—';$(state).className='unknown';}\n $('release').textContent='Unknown';$('fingerprint').textContent='No verified observation';\n}\nfunction authMessage(message){$('auth-message').textContent=message;$('auth-message').hidden=!message;}\nfunction showAuth(mode,message=''){\n clearPrivate();clearInputs();authMode=mode;$('auth').hidden=false;$('setup-form').hidden=mode!=='setup';$('login-form').hidden=mode!=='login';$('retry-auth').hidden=mode!=='unknown';\n $('auth-heading').textContent=mode==='setup'?'Set up your console':mode==='login'?'Welcome back':'Sign-in unavailable';\n $('auth-description').textContent=mode==='setup'?'Set the owner password using your one-time setup code.':mode==='login'?'Sign in to see Picard’s private status.':'The console could not check its sign-in state.';authMessage(message);\n}\nfunction project(input){\n const data=object(input),service=object(data.service),jobs=object(data.jobs),release=object(data.release);\n if(data.v!==1||typeof data.observedAt!=='string'||!Number.isFinite(Date.parse(data.observedAt)))throw Error('status');\n const bool=value=>typeof value==='boolean'?value:null;\n return {observedAt:new Date(data.observedAt).toISOString(),service:{ready:bool(service.ready),resultRecoveryReady:bool(service.resultRecoveryReady),providerReady:bool(service.providerReady),acceptingNewWork:bool(service.acceptingNewWork),draining:bool(service.draining)},jobs:Object.fromEntries(states.map(state=>[state,Number.isSafeInteger(jobs[state])&&jobs[state]>=0&&jobs[state]<=10000?jobs[state]:null])),releaseHash:typeof release.hash==='string'&&/^[a-f0-9]{64}$/.test(release.hash)?release.hash:null};\n}\nfunction readiness(id,value,positive,negative){$(id).textContent=value===true?positive:value===false?negative:'Unknown';$(id).className=value===true?'good':'muted';}\nfunction render(data){\n authenticated=true;latest=data;authMode='authenticated';clearInputs();$('auth').hidden=true;$('private').hidden=false;$('refresh').hidden=false;$('logout').hidden=false;$('notice').hidden=true;\n $('health-heading').textContent=data.service.ready===true?'Service operational':data.service.ready===false?'Service needs attention':'Service state unknown';$('health-heading').dataset.tone=data.service.ready===true?'good':data.service.ready===false?'warn':'unknown';\n $('checked').textContent='Checked '+new Date(data.observedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('checked').title=new Date(data.observedAt).toLocaleString();\n readiness('provider',data.service.providerReady,'Ready','Unavailable');readiness('recovery',data.service.resultRecoveryReady,'Ready','Unavailable');readiness('accepting',data.service.acceptingNewWork,'Accepting','Not accepting');readiness('draining',data.service.draining,'Yes','No');\n for(const state of states){$(state).textContent=data.jobs[state]===null?'—':String(data.jobs[state]);$(state).className=data.jobs[state]===null?'unknown':'';}\n $('release').textContent=data.releaseHash?'Identified':'Unknown';$('fingerprint').textContent=data.releaseHash||'Not reported';\n}\nfunction busy(value){pending=value;for(const id of ['refresh','logout','setup-submit','login-submit','retry-auth'])$(id).disabled=value;$('refresh').textContent=value?'Checking…':'Refresh';if(!value&&resumePending){resumePending=false;queueMicrotask(()=>void boot());}}\nasync function request(path,body){\n const abort=new AbortController();controller=abort;const timer=setTimeout(()=>abort.abort(),8000);\n try{\n  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});\n  if(!response.ok){let code='auth_failed';try{const data=await response.json();if(['auth_failed','setup_unavailable','rate_limited'].includes(data.error))code=data.error;}catch{}const error=Error(code);error.status=response.status;throw error;}\n  const result=await response.json();if(abort.signal.aborted)throw Error('aborted');return result;\n }finally{clearTimeout(timer);}\n}\nconst friendly=error=>error.message==='rate_limited'?'Too many attempts. Wait before trying again.':error.message==='setup_unavailable'?'Setup is unavailable. Check whether this console has already been enrolled.':'Sign-in failed. Check your details and try again.';\nasync function status(){\n try{render(project(await request('/status')));}\n catch(error){if(error.status===401||error.status===403){showAuth('login','Please sign in to view private status.');return;}\n  if(authenticated&&latest){$('notice').textContent='Status could not be checked. Showing the previous observation, not current health.';$('notice').hidden=false;}\n  else showAuth('login','Signed-in status could not be confirmed. Please try again.');}\n}\nasync function boot(){\n if(pending)return;busy(true);clearPrivate();clearInputs();authMessage('');\n try{const state=await request('/auth/state');if(typeof state.enrolled!=='boolean')throw Error('state');if(!state.enrolled)showAuth('setup');else await status();}\n catch{showAuth('unknown','No private status has been loaded. Retry when the console is available.');}\n finally{busy(false);}\n}\nasync function submit(event,setup){\n event.preventDefault();if(pending)return;\n let password=$(setup?'new-password':'login-password').value,setupCode=$('setup-code').value;\n const length=passwordBytes(password);\n if(length<12||length>128){authMessage('Use a password between 12 and 128 UTF-8 bytes.');return;}\n if(setup&&password!==$('confirm-password').value){authMessage('The passwords do not match.');return;}\n if(setup&&(!setupCode||passwordBytes(setupCode)>256)){authMessage('Enter the one-time setup code.');return;}\n busy(true);authMessage('');const body=setup?{setupCode,password}:{password};clearInputs();password='';setupCode='';\n try{const result=await request(setup?'/auth/setup':'/auth/login',body);if(result.ok!==true)throw Error('auth_failed');body.password='';if(setup)body.setupCode='';await status();}\n catch(error){showAuth(setup&&error.message==='setup_unavailable'?'unknown':setup?'setup':'login',friendly(error));}\n finally{body.password='';if(setup)body.setupCode='';busy(false);}\n}\nasync function logout(){\n if(pending)return;busy(true);showAuth('login');\n try{const result=await request('/auth/logout',{});if(result.ok!==true)throw Error('logout');authMessage('Signed out.');}\n catch{authMessage('Could not confirm sign-out. Private status is hidden; the server session may still be active.');}\n finally{busy(false);}\n}\n$('setup-form').addEventListener('submit',event=>submit(event,true));$('login-form').addEventListener('submit',event=>submit(event,false));$('retry-auth').addEventListener('click',boot);$('logout').addEventListener('click',logout);$('refresh').addEventListener('click',async()=>{if(pending||!authenticated)return;busy(true);try{await status();}finally{busy(false);}});\nconst preference=window.matchMedia('(prefers-reduced-motion: reduce)');\nfunction motion(){const reduced=preference.matches;$('logo-wrap').classList.toggle('running',!paused&&!reduced&&document.visibilityState!=='hidden');$('motion').textContent=reduced?'Motion reduced':paused?'Resume logo':'Pause logo';$('motion').disabled=reduced;$('motion').setAttribute('aria-pressed',String(paused));}\n$('motion').addEventListener('click',()=>{paused=!paused;motion();});preference.addEventListener('change',motion);document.addEventListener('visibilitychange',motion);\nwindow.addEventListener('pagehide',()=>{controller?.abort();clearPrivate();clearInputs();});window.addEventListener('pageshow',event=>{if(event.persisted){if(pending)resumePending=true;else void boot();}});motion();void boot();\n})();\n</script>\n</body>\n</html>\n";
export function loadOracleConfig(e=process.env){
 if(e.BRIDGE_ENABLED!=='true')return {enabled:false};
 const secret=e.BRIDGE_HMAC_SECRET_FILE?readFileSync(e.BRIDGE_HMAC_SECRET_FILE,'utf8').trim():'';
 const c={enabled:true,keyId:e.BRIDGE_KEY_ID??'',secret,ownerId:e.BRIDGE_OWNER_ID??'',assistantId:e.BRIDGE_ASSISTANT_ID??'',allowedTaskId:e.BRIDGE_ALLOWED_TASK_ID??'',dbPath:e.BRIDGE_DB_PATH??'',port:Number(e.BRIDGE_PORT??8787),stopPath:e.BRIDGE_STOP_PATH??null,controlSocket:e.BRIDGE_CONTROL_SOCKET??'',releaseHash:e.BRIDGE_RELEASE_HASH??'',consoleEnabled:e.BRIDGE_CONSOLE_ENABLED==='true',consoleAuthDir:e.BRIDGE_CONSOLE_AUTH_DIR??'',consoleOrigins:(()=>{try{return JSON.parse(e.BRIDGE_CONSOLE_ORIGINS??'[]');}catch{return [];}})()};
 if(c.assistantId==='groq:openai/gpt-oss-20b'&&(!c.allowedTaskId||c.allowedTaskId.length>200))throw Error('production_configuration_unavailable');
 if(!validConfig(c)||!c.ownerId||!c.assistantId||!c.dbPath||c.dbPath===':memory:'||!Number.isSafeInteger(c.port)||c.port<1024||c.port>65535||e.BRIDGE_LOCAL_TEST_MODE==='true')throw Error('production_configuration_unavailable');
 return c;
}
export async function main(){
 const config=loadOracleConfig();if(!config.enabled){console.log(JSON.stringify({state:'disabled'}));return;}
 return startOracleService(config,createSelectedAssistantAdapter());
}
export async function startOracleService(config,assistantAdapter,{intervalMs=1000,installSignals=true}={}){
 if(assistantAdapter?.localTestOnly===true||assistantAdapter?.kind==='controlled-local-fixture-only')throw Error('production_fixture_executor_forbidden');
 // No provider/API/model/command fallback. This is the sole external runtime
 // Unconfigured adapters fail closed; a spent one-shot adapter may serve saved results.
 if((assistantAdapter.ready!==true&&assistantAdapter.canServeResults!==true)||assistantAdapter.assistantId!==config.assistantId)throw Error('assistant_invocation_unavailable');
 let store,live=false;
 const control=createRuntimeControl({socketPath:config.controlSocket,releaseHash:config.releaseHash,stats:()=>store.stats(),providerReady:()=>assistantAdapter.ready===true,resultRecoveryReady:()=>live,serviceReady:()=>live});
 store=createRelayStore({...config,canAccept:()=>control.accepting});
 const receiver=createReceiver({store,config,assistantAdapter,canAccept:()=>control.accepting,runtimeHealth:()=>control.health()});
 const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter,production:true,enabled:true,dbPath:config.dbPath,workerId:'oracle-relay',claimTtlMs:60000});
 let stopping=false,shutdownPromise=null,finishBusy=null;
 let consoleAuth=null;
 if(config.consoleEnabled===true){try{consoleAuth=createOwnerAuth({stateDir:config.consoleAuthDir});}catch{/* Console fails closed; independent signed bridge remains available. */}}
 const consoleHandler=createConsoleHandler({enabled:config.consoleEnabled===true,html:CONSOLE_HTML,auth:consoleAuth,origins:config.consoleOrigins,getSnapshot:()=>consoleSnapshot(control.health(),store.scopedStats({ownerId:config.ownerId,allowedTaskId:config.allowedTaskId??''}))});
 const server=createServer(async(req,res)=>{try{
  // TLS/auth for the opt-in console terminate at the approved reverse proxy.
  if(await consoleHandler(req,res))return;
  // Signed bridge authorization remains separate; loopback only.
  if(req.method!=='POST'||req.url!=='/bridge/v1'){res.writeHead(404).end();return;}
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>24576){res.writeHead(413).end();req.destroy();return;}chunks.push(chunk);}
  const request=new Request('https://relay.invalid/bridge/v1',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),reply=await receiver(request);
  res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());
 }catch{res.writeHead(503).end();}});
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=16;
 try{await control.start();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}catch(e){await control.close();store.close();throw e;}
 live=true;
 const timer=setInterval(async()=>{if(stopping||!control.accepting||control.busy)return;if(config.stopPath&&existsSync(config.stopPath)){shutdown();return;}if(!control.tryBegin())return;try{const result=await dispatcher.runOnce();if(result.status!=='idle')console.log(JSON.stringify({state:result.status,eventId:result.requestId,attempt:result.attempt,code:result.code}));}finally{control.finish();if(finishBusy)finishBusy();}},intervalMs);
 function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  stopping=true;control.drain();clearInterval(timer);
  shutdownPromise=(async()=>{
   await Promise.all([new Promise(resolve=>server.close(resolve)),control.close(),control.busy?new Promise(resolve=>{finishBusy=resolve;}):Promise.resolve()]);
   live=false;store.close();if(installSignals){process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);}
  })();return shutdownPromise;
 }
 if(installSignals){process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);}
 console.log(JSON.stringify({state:'started',storage:'file',bind:'loopback'}));
 return {shutdown,control,address:()=>server.address()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({state:'startup_blocked',code:error.message==='assistant_invocation_unavailable'?error.message:'configuration_or_startup_failed'}));process.exitCode=2;});
