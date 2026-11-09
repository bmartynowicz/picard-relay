// Opt-in administrator helper. One systemd Unix connection per invocation.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {GROQ_REPLACEMENT_STATUS,groqReplacementId,groqReplacementKey,readExistingAdmissionFile} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {createPreparedServiceAdapter} from '../experimental/updater/fixed-service-adapter.mjs';
import {currentGroqEnrollment,stageGroqReplacement} from './stage-groq-key-replacement.mjs';

const service='board-event-relay.service';
const root='/usr/local/lib/board-event-relay';
const dropIn='/etc/systemd/system/board-event-relay.service.d/90-groq-key-replacement.conf';
const admissionRoot='/etc/board-event-relay/admission';
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:30000,maxBuffer:4096,stdio:['ignore','pipe','pipe']}).trim();
const assert=condition=>{if(!condition)throw Error('key_replacement_preflight');};

export function parseGroqReplacementRequest(raw){
 const body=JSON.parse(raw);
 assert(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')==='enrollmentId,free,id,key,v'
  &&body.v===1&&body.free===true&&groqReplacementId(body.id)&&groqReplacementKey(body.key)
  &&typeof body.enrollmentId==='string'&&body.enrollmentId.length===64&&/^[a-f0-9]+$/.test(body.enrollmentId));
 return body;
}

async function receive(){
 let raw='';
 try{
  for await(const chunk of process.stdin.iterator({destroyOnReturn:false})){
   raw+=chunk.toString('utf8');
   assert(Buffer.byteLength(raw)<=1024);
   if(raw.endsWith('\n')){
    assert(raw.indexOf('\n')===raw.length-1);
    return parseGroqReplacementRequest(raw.slice(0,-1));
   }
  }
  throw Error('key_replacement_incomplete');
 }finally{process.stdin.pause();}
}

function syncDirectory(dir){
 const fd=fs.openSync(dir,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function rootDirectory(dir){
 const s=fs.lstatSync(dir);
 assert(s.isDirectory()&&s.uid===0&&(s.mode&0o022)===0&&fs.realpathSync(dir)===dir);
}
function writeAtomic(file,contents,gid=0,mode=0o600){
 const dir=path.dirname(file),temporary=path.join(dir,'.replacement-'+randomUUID());
 const fd=fs.openSync(temporary,'wx',0o600);
 try{
  try{fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.writeFileSync(fd,contents);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);syncDirectory(dir);
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function readDropIn(){
 try{fs.lstatSync(dropIn);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 return readExistingAdmissionFile(dropIn,512,{rootOnly:true}).text;
}
function replaceDropIn(contents){
 if(contents===null){fs.unlinkSync(dropIn);syncDirectory(path.dirname(dropIn));}
 else writeAtomic(dropIn,contents);
 systemctl('daemon-reload');
}
function relabel(candidate){
 const restorecon='/usr/sbin/restorecon';
 if(fs.existsSync(restorecon))execFileSync(restorecon,['-R',candidate],{timeout:5000,stdio:'pipe'});
}
function guardStops(){
 for(const file of [root+'/pending.json','/var/lib/picard-updater/HOLD','/var/lib/board-event-relay/STOP']){
  try{fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  throw Error('key_replacement_held');
 }
}

export async function switchGroqKey({adapter,target,activate,restore,stopFailedStart,checkActive,checkRestored}){
 try{await adapter.quiesce();}catch{return 'unknown';}
 try{
  activate();await adapter.start(target);
  if(await adapter.health({release:target.slice(9),noProviderCalls:true,requireProviderReady:true})&&checkActive())return 'replaced';
 }catch{/* Restore the previous pointer after a confirmed stop. */}
 try{
  if(!stopFailedStart())await adapter.stop();
  restore();await adapter.start(target);
  if(await adapter.health({release:target.slice(9),noProviderCalls:true})&&checkRestored())return 'rejected';
 }catch{/* Preserve the host checkpoint for review. */}
 return 'unknown';
}

function stoppedAfterFailedStart(){
 const state=systemctl('show',service,'--property=ActiveState','--value');
 if(state==='inactive')return true;
 if(state!=='failed'||systemctl('show',service,'--property=MainPID','--value')!=='0')return false;
 systemctl('--no-ask-password','stop',service);
 return systemctl('show',service,'--property=ActiveState','--value')==='inactive';
}

async function run(input,acknowledge){
 const statusDir=path.dirname(GROQ_REPLACEMENT_STATUS);
 for(const dir of [root,admissionRoot,path.dirname(dropIn),statusDir])rootDirectory(dir);
 const lock=root+'/executor.lock';
 fs.mkdirSync(lock,{mode:0o700});
 try{
  guardStops();
  const active=currentGroqEnrollment(),gid=active.identity.gid;
  assert(active.webReplacementEnabled&&active.oldGate.enrollmentId===input.enrollmentId);
  // The versioned launcher sets its release hash inside Node. The fixed
  // adapter checks this root pointer against the actual PID and control socket.
  const currentLink=fs.lstatSync(root+'/current'),target=fs.readlinkSync(root+'/current');
  assert(currentLink.isSymbolicLink()&&currentLink.uid===0&&/^releases\/[a-f0-9]{64}$/.test(target));
  const adapter=createPreparedServiceAdapter({socketPath:active.controlSocket});
  const status=JSON.parse(readExistingAdmissionFile(GROQ_REPLACEMENT_STATUS,512,{...active.identity,rootOnly:true}).text);
  const at=Date.now();
  assert(Object.keys(status).sort().join(',')==='id,state,updatedAt,v'&&status.v===1
   &&['idle','replaced','rejected'].includes(status.state)&&status.id!==input.id
   &&(status.state==='idle'?status.id===null:groqReplacementId(status.id))
   &&Number.isSafeInteger(status.updatedAt)&&status.updatedAt>=0&&at-status.updatedAt>=0);
  const record=state=>writeAtomic(GROQ_REPLACEMENT_STATUS,JSON.stringify({v:1,state,id:input.id,updatedAt:Date.now()}),gid,0o640);
  record('checking');acknowledge();
  const directory=admissionRoot+'/rotation-'+input.id;
  let enrollmentId,previousDropIn;
  try{
   const old=active.oldGate.costEnrollment;
   enrollmentId=stageGroqReplacement(active,{directory,newKey:input.key,at,evidence:{
    v:1,accountLabel:old.accountLabel,organizationId:old.organizationId,projectId:old.projectId,accountPlan:'Free',
    noPaidFallback:true,verifiedAt:at,evidenceRef:'Owner confirmed Free in the Groq console',
    keyAssociationEvidenceRef:'Owner confirmed this key in the enrolled project · '+input.id,
   }});
   previousDropIn=readDropIn();
   if(previousDropIn!==null)writeAtomic(directory+'/previous-drop-in.conf',previousDropIn);
   relabel(directory);
   guardStops();
  }catch{record('rejected');return;}
  const next='[Service]\nEnvironmentFile='+directory+'/activate.env\n';
  const outcome=await switchGroqKey({adapter,target,activate:()=>replaceDropIn(next),restore:()=>{
   if(readDropIn()!==previousDropIn)replaceDropIn(previousDropIn);
  },stopFailedStart:stoppedAfterFailedStart,checkActive:()=>currentGroqEnrollment().oldGate.enrollmentId===enrollmentId,
  checkRestored:()=>currentGroqEnrollment().oldGate.enrollmentId===input.enrollmentId});
  record(outcome);
 }finally{fs.rmdirSync(lock);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.stdout.on('error',()=>{});
 let acknowledged=false;
 try{
  assert(process.platform==='linux'&&process.getuid()===0&&process.argv.length===2);
  const input=await receive();
  await run(input,()=>{acknowledged=true;process.stdout.write('{"accepted":true}\n');});
 }catch{
  if(!acknowledged)process.stdout.write('{"accepted":false}\n');
  process.stderr.write('Groq replacement did not finish. Check the saved replacement status.\n');
  process.exitCode=1;
 }
}
