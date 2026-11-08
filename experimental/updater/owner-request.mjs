// Separately enrolled root host support. One fixed request, one fixed unit.
// There is no network listener, command input, provider call or retry loop.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadAdministratorPolicy} from './updater.mjs';
const exec=promisify(execFile),QUEUE='/var/lib/picard-update-requests',STATUS='/var/lib/picard-updater-status',COOLDOWN=300000;
export async function runOwnerUpdateRequest(d){
 const previous=await d.readStatus(),at=d.now();
 // An interrupted check is not automatically replayed after restart.
 if(previous.state==='checking'||previous.state==='unknown'){await d.writeStatus({...previous,state:'unknown'});return 'unknown';}
 if(previous.state==='held')return 'held';
 if(previous.retryAt!==null&&at<previous.retryAt)return 'cooldown';
 const state={v:1,state:'checking',requestedAt:at,finishedAt:null,retryAt:at+COOLDOWN};
 const finish=async outcome=>{await d.writeStatus({...state,state:outcome,finishedAt:d.now()});return outcome;};
 // Persist intent before any fallible preflight. If writing fails, the queue remains evidence.
 await d.writeStatus(state);let phase='preflight';
 try{
  if(await d.blocked())return finish('held');const before=await d.release();
  phase='check';await d.check();phase='verify';
  if(await d.blocked())return finish('held');const after=await d.release();return finish(after===before?'up_to_date':'installed');
 }catch(error){
  if(phase==='preflight')return finish('failed');
  try{if(await d.blocked())return finish('held');}catch{return finish('unknown');}
  const uncertain=phase==='verify'||error?.killed===true||!!error?.signal||['ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code);
  return finish(uncertain?'unknown':'failed');
 }
}
// Explicit dependency seam for local queue fixtures; main supplies only the fixed host paths.
export async function consumeOwnerUpdateRequest(d){
 const request=await d.readRequest();
 if(!request.isDirectory()||request.isSymbolicLink()||(request.mode&0o777)!==0o700)throw Error('invalid_request');
 const outcome=await runOwnerUpdateRequest(d);
 // Preserve the directory after unreadable state, failed persistence or an unknown outcome.
 if(outcome==='unknown')return outcome;
 const after=await d.readRequest();if(after.ino!==request.ino||after.dev!==request.dev)throw Error('request_changed');
 await d.removeRequest();return outcome;
}
async function safeDir(root,mode){const s=await fs.lstat(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o777)!==mode||await fs.realpath(root)!==root)throw Error('unsafe_directory');return s;}
async function readStatus(){
 await safeDir(STATUS,0o755);const h=await fs.open(STATUS+'/request.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await h.stat();if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||s.size>2048)throw Error('unsafe_status');const v=JSON.parse(await h.readFile('utf8'));if(v.v!==1||!['idle','checking','up_to_date','installed','held','failed','unknown'].includes(v.state)||![v.requestedAt,v.finishedAt,v.retryAt].every(x=>x===null||Number.isSafeInteger(x)&&x>=0&&x<=Date.now()+COOLDOWN+5000))throw Error('invalid_status');return v;}finally{await h.close();}
}
async function writeStatus(v){
 await safeDir(STATUS,0o755);const temporary=STATUS+'/.request-'+randomUUID(),h=await fs.open(temporary,'wx',0o644);
 try{await h.chmod(0o644);await h.writeFile(JSON.stringify(v));await h.sync();}finally{await h.close();}
 await fs.rename(temporary,STATUS+'/request.json');const dir=await fs.open(STATUS,'r');try{await dir.sync();}finally{await dir.close();}
}
async function blocked(){
 for(const file of ['/var/lib/picard-updater/HOLD','/var/lib/board-event-relay/STOP','/usr/local/lib/board-event-relay/pending.json']){try{await fs.lstat(file);return true;}catch(e){if(e.code!=='ENOENT')throw e;}}
 const p=await loadAdministratorPolicy('/etc/picard-updater/policy.json',0);return p.enabled!==true;
}
async function release(){const s=await fs.lstat('/usr/local/lib/board-event-relay/current'),v=await fs.readlink('/usr/local/lib/board-event-relay/current');if(!s.isSymbolicLink()||s.uid!==0||!/^releases\/[a-f0-9]{64}$/.test(v))throw Error('unsafe_release');return v;}
export async function main(){
 if(process.getuid?.()!==0)throw Error('administrator_required');
 await safeDir(QUEUE,0o770);
 return consumeOwnerUpdateRequest({readStatus,writeStatus,blocked,release,now:Date.now,
  readRequest:()=>fs.lstat(QUEUE+'/request'),removeRequest:()=>fs.rmdir(QUEUE+'/request'),check:async()=>{
   await exec('/usr/bin/systemctl',['--no-ask-password','start','picard-updater.service'],{timeout:195000,maxBuffer:4096,windowsHide:true,env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'}});
  }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('{"state":"request_failed"}');process.exitCode=1;});
