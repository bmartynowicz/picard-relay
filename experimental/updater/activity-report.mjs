// Root-owned local observer. Fixed read-only systemd queries; no update/control action.
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ROOT='/var/lib/picard-updater-status';
const fields=['ActiveState','UnitFileState','Result','ExecMainStartTimestamp','ExecMainExitTimestamp'];
const units={timer:'picard-updater.timer',fetch:'picard-update-fetch.service',update:'picard-updater.service'};
const parseTime=value=>{const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)&&n>=0?n:null;};
export function summarizeUpdaterActivity({policyEnabled,held,timer,fetch,update},now=Date.now()){
 if(typeof policyEnabled!=='boolean'||typeof held!=='boolean'||![timer,fetch,update].every(v=>v&&typeof v==='object'))throw Error('metadata_unavailable');
 const validTime=value=>{const time=parseTime(value);if(time!==null&&time>now+5000)throw Error('clock_mismatch');return time;};
 const starts=[fetch,update].map(u=>validTime(u.ExecMainStartTimestamp)).filter(v=>v!==null);
 const fetchEnd=validTime(fetch.ExecMainExitTimestamp),updateEnd=validTime(update.ExecMainExitTimestamp);
 const timerEnabled=['enabled','enabled-runtime','linked','linked-runtime'].includes(timer.UnitFileState)?true:['disabled','masked','masked-runtime','static'].includes(timer.UnitFileState)?false:null;
 const timerActive=timer.ActiveState==='active'?true:['inactive','failed'].includes(timer.ActiveState)?false:null;
 if(timerActive===null)throw Error('metadata_unavailable');
 let lastOutcome='never_checked',lastFinishedAt=null;
 if(fetchEnd!==null&&(updateEnd===null||fetchEnd>updateEnd)&&fetch.Result!=='success'){lastOutcome='fetch_failed';lastFinishedAt=fetchEnd;}
 else if(updateEnd!==null){lastOutcome=update.Result==='success'?'check_succeeded':'check_failed';lastFinishedAt=updateEnd;}
 let state='enabled',reasonCode='none';
 if(!policyEnabled){state='disabled';reasonCode='policy_disabled';}
 else if(held){state='held';reasonCode='hold_present';}
 else if([fetch,update].some(u=>['active','activating','deactivating'].includes(u.ActiveState))){state='checking';reasonCode='check_in_progress';}
 else if(['fetch_failed','check_failed'].includes(lastOutcome)){state='error';reasonCode=lastOutcome;}
 else if(!timerActive){state='disabled';reasonCode='timer_disabled';}
 else if(lastOutcome==='never_checked')reasonCode='never_checked';
 return {v:1,state,reasonCode,observedAt:new Date(now).toISOString(),configured:policyEnabled,timerEnabled,timerActive,lastAttemptAt:starts.length?new Date(Math.max(...starts)).toISOString():null,lastFinishedAt:lastFinishedAt===null?null:new Date(lastFinishedAt).toISOString(),lastOutcome};
}
async function safeDirectory(root,uid){const s=await fs.lstat(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o022)||await fs.realpath(root)!==root)throw Error('unsafe_status_directory');return s;}
async function safeJson(file,uid,limit){const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||s.uid!==uid||(s.mode&0o022)||s.size>limit)throw Error('unsafe_evidence');return JSON.parse(await h.readFile('utf8'));}finally{await h.close();}}
export async function writeUpdaterActivity(value,{root=ROOT,uid=0}={}){
 const before=await safeDirectory(root,uid),target=root+'/status.json';
 try{await safeJson(target,uid,4096);}catch(e){if(e.code!=='ENOENT')throw e;}
 const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>4096)throw Error('activity_too_large');
 const temporary=root+'/.activity-'+randomUUID();
 try{const h=await fs.open(temporary,'wx',0o600);try{await h.writeFile(bytes);await h.chmod(0o644);await h.sync();}finally{await h.close();}const after=await safeDirectory(root,uid);if(before.ino!==after.ino||before.dev!==after.dev)throw Error('status_directory_changed');await fs.rename(temporary,target);const d=await fs.open(root,'r');try{await d.sync();}finally{await d.close();}}finally{await fs.unlink(temporary).catch(()=>{});}
}
export async function collectUpdaterActivity(){
 if(process.getuid()!==0)throw Error('administrator_required');
 let report;try{
  const policy=await safeJson('/etc/picard-updater/policy.json',0,16384);
  let held=false;try{const s=await fs.lstat('/var/lib/picard-updater/HOLD');if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077))throw Error('unsafe_evidence');held=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const metadata={};for(const [kind,unit] of Object.entries(units)){const raw=execFileSync('/usr/bin/systemctl',['show',unit,'--property='+fields.join(',')],{encoding:'utf8',timeout:1500,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'}});metadata[kind]=Object.fromEntries(raw.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}).filter(([key])=>fields.includes(key)));}
  report=summarizeUpdaterActivity({policyEnabled:policy.enabled,held,...metadata});
 }catch{report={v:1,state:'unknown',reasonCode:'metadata_unavailable',observedAt:new Date().toISOString(),configured:null,timerEnabled:null,timerActive:null,lastAttemptAt:null,lastFinishedAt:null,lastOutcome:'unknown'};}
 await writeUpdaterActivity(report);console.log(JSON.stringify({state:report.state,reasonCode:report.reasonCode}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await collectUpdaterActivity();
