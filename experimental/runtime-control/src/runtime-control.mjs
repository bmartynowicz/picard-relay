import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {lstatSync,realpathSync,chmodSync,unlinkSync,readFileSync,readdirSync,openSync,fstatSync,closeSync,mkdirSync,constants} from 'node:fs';
import {dirname,basename,isAbsolute,resolve} from 'node:path';
const STATES=new Set(['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain']);
export const AVAILABILITY_CODES=Object.freeze(['ready','pending_uncertainty','catalogue_expired','catalogue_unavailable','configuration_unavailable','relay_busy_or_draining','allowance_unavailable','legacy_review_required','unknown']);
const UPDATER_STATES=['enabled','disabled','held','checking','error','unknown'];
const UPDATER_REASONS=['none','policy_disabled','hold_present','check_in_progress','fetch_failed','check_failed','timer_disabled','never_checked','metadata_unavailable'];
const UPDATER_OUTCOMES=['never_checked','fetch_failed','check_failed','check_succeeded','unknown'];
// The runtime can create one empty request directory. It cannot select a unit,
// command, release URL or policy. A separately enrolled root path unit owns it.
export function createUpdateRequestBridge({enabled=false,root='/var/lib/picard-update-requests',statusRoot='/var/lib/picard-updater-status',administratorUid=0,runtimeGid=process.getgid?.(),now=Date.now}={}){
 const unavailable=()=>Object.assign(Error('update_not_connected'),{code:'update_not_connected'});
 function directory(){const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==administratorUid||s.gid!==runtimeGid||(s.mode&0o777)!==0o770||realpathSync(root)!==root)throw unavailable();return s;}
 function status(){
  if(enabled!==true)return {v:1,enabled:false,state:'not_connected',requestedAt:null,finishedAt:null,retryAt:null};
  let fd;try{
   directory();const d=lstatSync(statusRoot);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==administratorUid||(d.mode&0o022)||realpathSync(statusRoot)!==statusRoot)throw unavailable();
   fd=openSync(statusRoot+'/request.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==administratorUid||(s.mode&0o022)||s.size>2048)throw unavailable();
   const raw=readFileSync(fd),v=JSON.parse(raw);if(raw.length>2048||v.v!==1||!['idle','checking','up_to_date','installed','held','failed','unknown'].includes(v.state))throw unavailable();
   const time=x=>x===null||Number.isSafeInteger(x)&&x>=0&&x<=8640000000000000;
   if(![v.requestedAt,v.finishedAt,v.retryAt].every(time)||v.state==='checking'&&v.requestedAt===null||v.requestedAt!==null&&v.requestedAt>now()+5000||v.finishedAt!==null&&(v.finishedAt>now()+5000||v.requestedAt===null||v.finishedAt<v.requestedAt)||v.retryAt!==null&&(v.requestedAt===null||v.retryAt<v.requestedAt||v.retryAt>v.requestedAt+300000))throw unavailable();
   let state=v.state;if(state==='checking'&&now()-v.requestedAt>240000)state='unknown';
   try{const queued=lstatSync(root+'/request');if(!queued.isDirectory()||queued.isSymbolicLink())throw unavailable();const age=now()-queued.mtimeMs;if(age< -5000)state='unknown';else if(state!=='checking')state=age<10000?'checking':'unknown';}catch(e){if(e.code!=='ENOENT')throw e;}
   return {v:1,enabled:true,state,requestedAt:v.requestedAt,finishedAt:v.finishedAt,retryAt:v.retryAt};
  }catch{return {v:1,enabled:false,state:'not_connected',requestedAt:null,finishedAt:null,retryAt:null};}finally{if(fd!==undefined)closeSync(fd);}
 }
 function request(){
  const value=status();if(!value.enabled)throw unavailable();
  if(['checking','unknown','held'].includes(value.state))throw Object.assign(Error('update_'+value.state),{code:'update_'+value.state});
  if(value.retryAt!==null&&now()<value.retryAt)throw Object.assign(Error('update_cooldown'),{code:'update_cooldown'});
  const before=directory();try{mkdirSync(root+'/request',{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Object.assign(Error('update_checking'),{code:'update_checking'});throw unavailable();}
  const after=directory();if(before.ino!==after.ino||before.dev!==after.dev)throw unavailable();
  return {v:1,enabled:true,state:'checking',requestedAt:now(),finishedAt:null,retryAt:null};
 }
 return Object.freeze({status,request});
}
export function projectUpdaterActivity(value,now=Date.now()){
 const unknown=reasonCode=>({state:'unknown',reasonCode,observedAt:null,configured:null,timerEnabled:null,timerActive:null,lastAttemptAt:null,lastFinishedAt:null,lastOutcome:'unknown',lastReportedState:null});
 if(!value||value.v!==1||!UPDATER_STATES.includes(value.state)||!UPDATER_REASONS.includes(value.reasonCode)||!UPDATER_OUTCOMES.includes(value.lastOutcome)||['configured','timerEnabled','timerActive'].some(key=>value[key]!==null&&typeof value[key]!=='boolean'))return unknown('activity_invalid');
 const observed=typeof value.observedAt==='string'?Date.parse(value.observedAt):NaN;
 if(!Number.isFinite(observed)||observed<0)return unknown('activity_invalid');
 const time=key=>value[key]===null?null:typeof value[key]==='string'&&Number.isFinite(Date.parse(value[key]))&&Date.parse(value[key])>=0&&Date.parse(value[key])<=observed+5000?new Date(value[key]).toISOString():false;
 const lastAttemptAt=time('lastAttemptAt'),lastFinishedAt=time('lastFinishedAt');if(lastAttemptAt===false||lastFinishedAt===false)return unknown('activity_invalid');
 const reasonCode=observed>now+5000?'activity_clock_mismatch':now-observed>180000?'activity_stale':value.reasonCode;
 return {state:['activity_clock_mismatch','activity_stale'].includes(reasonCode)?'unknown':value.state,reasonCode,observedAt:new Date(observed).toISOString(),configured:value.configured,timerEnabled:value.timerEnabled,timerActive:value.timerActive,lastAttemptAt,lastFinishedAt,lastOutcome:value.lastOutcome,lastReportedState:value.state};
}
export function readUpdaterActivity({root='/var/lib/picard-updater-status',expectedUid=0,now=Date.now()}={}){
 let fd;try{const before=lstatSync(root);if(!before.isDirectory()||before.isSymbolicLink()||before.uid!==expectedUid||(before.mode&0o022)||realpathSync(root)!==root)throw Error();fd=openSync(root+'/status.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==expectedUid||(stat.mode&0o022)||stat.size>4096)throw Error();const bytes=readFileSync(fd),after=lstatSync(root),end=fstatSync(fd);if(bytes.length>4096||after.ino!==before.ino||after.dev!==before.dev||stat.ino!==end.ino||stat.size!==end.size||stat.mtimeMs!==end.mtimeMs)throw Error();return projectUpdaterActivity(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),now);}catch(e){const result=projectUpdaterActivity(null,now);result.reasonCode=e.code==='ENOENT'?'activity_not_connected':'activity_unavailable';return result;}finally{if(fd!==undefined)closeSync(fd);}
}
export function physicalReleaseIdentity(moduleUrl=import.meta.url,expected=''){
 const file=realpathSync(fileURLToPath(moduleUrl)),src=dirname(file),releaseDir=dirname(src),actual=basename(releaseDir);
 if(basename(src)!=='src'||basename(dirname(releaseDir))!=='releases'||!/^[a-f0-9]{64}$/.test(actual))return {release:'unversioned-flat',updateReady:false};
 if(actual!==expected)throw Error('control_release_mismatch');
 const immutable=(path,kind)=>{const s=lstatSync(path);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o222)!==0||(kind==='file'?!s.isFile():!s.isDirectory()))throw Error('release_ownership_invalid');return s;};
 immutable(releaseDir,'dir');immutable(src,'dir');const manifestPath=releaseDir+'/manifest.json';const ms=immutable(manifestPath,'file');if(ms.size>16384)throw Error('release_manifest_invalid');
 const raw=readFileSync(manifestPath),hash=bytes=>createHash('sha256').update(bytes).digest('hex');if(hash(raw)!==actual)throw Error('release_manifest_digest_mismatch');
 const manifest=JSON.parse(raw);if(manifest.format!==1||manifest.product!=='picard-relay'||manifest.nodeMajor!==24||manifest.stateSchema!==1||manifest.migration!=='none'||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>32)throw Error('release_manifest_invalid');
 const seen=new Set();for(const spec of manifest.files){if(!/^src\/[a-z][a-z0-9-]*\.mjs$/.test(spec.path)||seen.has(spec.path)||!Number.isSafeInteger(spec.bytes)||spec.bytes<0||spec.bytes>262144||!/^[a-f0-9]{64}$/.test(spec.sha256))throw Error('release_manifest_invalid');seen.add(spec.path);const path=releaseDir+'/'+spec.path;const st=immutable(path,'file');if(st.size!==spec.bytes||hash(readFileSync(path))!==spec.sha256)throw Error('release_source_mismatch');}
 const required=['adapters','dispatcher','groq-adapter','groq-once-adapter','https-fetch','oracle-service','protocol','receiver','relay-store','selected-assistant','runtime-control'];
 if(required.some(name=>!seen.has('src/'+name+'.mjs'))||readdirSync(src).some(name=>!seen.has('src/'+name)))throw Error('release_files_mismatch');
 const version=typeof manifest.version==='string'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)?manifest.version:null;
 const sequence=Number.isSafeInteger(manifest.sequence)&&manifest.sequence>0?manifest.sequence:null;
 const sourceCommit=typeof manifest.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(manifest.sourceCommit)?manifest.sourceCommit:null;
 return {release:actual,updateReady:true,version,sequence,sourceCommit};
}
export function createRuntimeControl({socketPath='',releaseHash='',stats=()=>[],providerReady=()=>false,providerAvailability=()=>null,resultRecoveryReady=()=>false,serviceReady=()=>false}={}){
 const identity=socketPath||releaseHash?physicalReleaseIdentity(import.meta.url,releaseHash):{release:'control-disabled',updateReady:false};
 let draining=false,busy=false,server=null,owned=false,socketInode=null;
 const sockets=new Set();
 const health=()=>{const ledgerStateCounts=Object.fromEntries(stats().filter(r=>STATES.has(r.state)&&Number.isSafeInteger(r.count)&&r.count>=0).map(r=>[r.state,r.count]));const unresolvedInvoking=ledgerStateCounts.invoking??0,ready=providerReady()===true;let code='unknown';try{const value=providerAvailability();if(AVAILABILITY_CODES.includes(value?.code))code=value.code;}catch{}if(draining||busy)code='relay_busy_or_draining';else if(ready)code='ready';return {v:1,protocolVersion:1,release:identity.release,releaseHash:identity.release,releaseVersion:identity.version??null,releaseSequence:identity.sequence??null,sourceCommit:identity.sourceCommit??null,updateReady:identity.updateReady,pid:process.pid,serviceReady:serviceReady()===true,resultRecoveryReady:resultRecoveryReady()===true,providerReady:ready,blockingCode:code,accepting:!draining&&ready,acceptingNewWork:!draining&&ready,busy,draining,drained:draining&&!busy&&unresolvedInvoking===0,unresolvedInvoking,ledgerStateCounts};};
 const drain=()=>{draining=true;return health();};
 async function start(){
  if(!socketPath&&!releaseHash)return;
  if(!/^[a-f0-9]{64}$/.test(releaseHash)||!isAbsolute(socketPath)||resolve(socketPath)!==socketPath)throw Error('control_configuration_invalid');
  const dir=dirname(socketPath),s=lstatSync(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||s.uid!==process.getuid()||realpathSync(dir)!==dir)throw Error('control_directory_invalid');
  try{lstatSync(socketPath);throw Error('control_socket_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  server=createServer(sock=>{
   sockets.add(sock);sock.once('close',()=>sockets.delete(sock));sock.on('error',()=>{});sock.setTimeout(2000,()=>sock.destroy());let data='',done=false;
   sock.on('data',chunk=>{if(done)return;data+=chunk.toString('utf8');if(Buffer.byteLength(data)>256){done=true;sock.end('{"v":1,"error":"invalid_command"}\n');return;}if(!data.includes('\n'))return;done=true;
    try{const parsed=JSON.parse(data.trim());if(Object.keys(parsed).length!==2||parsed.v!==1||!['health','drain'].includes(parsed.action))throw Error();sock.end(JSON.stringify(parsed.action==='drain'?drain():health())+'\n');}
    catch{sock.end('{"v":1,"error":"invalid_command"}\n');}
   });
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(socketPath,()=>{try{owned=true;chmodSync(socketPath,0o600);socketInode=lstatSync(socketPath).ino;yes();}catch(e){no(e);}});});
 }
 async function close(){drain();for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));if(owned){try{const current=lstatSync(socketPath);if(!current.isSocket()||current.ino!==socketInode)throw Error('control_socket_replaced');unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}owned=false;}}
 return {start,close,health,drain,get accepting(){return !draining;},get busy(){return busy;},tryBegin(){if(draining||busy)return false;busy=true;return true;},finish(){busy=false;}};
}
