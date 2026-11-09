// Local Linux operator command. Stages a new directory and never starts work.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';
import {admissionHash} from '../experimental/runtime-control/src/admission-store.mjs';
import {priorGroqEnrollmentIds,validCostEnrollmentMetadata} from '../experimental/runtime-control/src/admission-enrollment.mjs';
import {admissionConfigurationDigest,readExistingAdmissionFile,readGroqReplacementHistory} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {createCatalogueLoader} from '../experimental/runtime-control/src/admission-catalogue.mjs';
import {readBoundAdmissionPolicy} from '../experimental/runtime-control/src/admission-policy.mjs';

const service='board-event-relay.service';
const hour=3600000;
const evidenceFields=['v','accountLabel','organizationId','projectId','accountPlan','noPaidFallback','verifiedAt','evidenceRef','keyAssociationEvidenceRef'];
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const validKey=key=>typeof key==='string'&&/^[\x21-\x7e]{16,512}$/.test(key);
function requireValid(condition){if(!condition)throw Error('groq_replacement_invalid');}
const json=value=>canonical(value)+'\n';

function boundGate(gate,key,config){
 const e=gate?.costEnrollment;
 requireValid(gate?.v===3&&validCostEnrollmentMetadata(e)&&validKey(key)&&e.owner===config.ownerId&&gate.owner===config.ownerId
  &&gate.task===config.allowedTaskId&&e.keySha256===admissionHash(key)&&gate.enrollmentId===admissionHash(canonical(e)));
 return e;
}

export function planGroqKeyReplacement({config,markerDirectory,oldGate,oldKey,oldPolicy,previous=[],newKey,evidence,at}){
 const old=boundGate(oldGate,oldKey,config);
 requireValid(config.workspaceEnabled===true&&config.admissionReusableBoardEnabled===true&&config.admissionSignedBridgeEnabled===true);
 const priorBinding={ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,enrollmentId:oldGate.enrollmentId,keySha256:old.keySha256};
 priorBinding.configurationSha256=admissionConfigurationDigest({config,enrollmentId:oldGate.enrollmentId,keySha256:old.keySha256,markerDirectory});
 const prior=readBoundAdmissionPolicy(()=>oldPolicy,priorBinding);
 requireValid(validKey(newKey)&&exact(evidence,evidenceFields)&&evidence.v===1&&Number.isSafeInteger(at)&&at>=old.enrolledAt
  &&Number.isSafeInteger(evidence.verifiedAt)&&evidence.verifiedAt>=old.verifiedAt&&evidence.verifiedAt<=at&&at-evidence.verifiedAt<=hour
  &&evidence.keyAssociationEvidenceRef!==old.keyAssociationEvidenceRef);
 const enrollment={...evidence,provider:old.provider,model:old.model,owner:old.owner,enrolledAt:at,keySha256:admissionHash(newKey)};
 const enrollmentId=admissionHash(canonical(enrollment));
 const history={v:1,activeEnrollmentId:enrollmentId,previous:[...previous,old]};
 priorGroqEnrollmentIds(history,enrollment);
 const gate={v:3,owner:config.ownerId,task:config.allowedTaskId,enrollmentId,costEnrollment:enrollment};
 const configurationSha256=admissionConfigurationDigest({config,enrollmentId,keySha256:enrollment.keySha256,markerDirectory});
 const policy={v:1,configurationSha256,costEnrollment:enrollment,catalogue:{...prior.catalogue,enrollmentId,notBefore:at,expiresAt:at+86400000,entries:[]}};
 readBoundAdmissionPolicy(()=>policy,{...priorBinding,enrollmentId,keySha256:enrollment.keySha256,configurationSha256});
 return {gate,history,policy};
}

function servicePid(){
 const pid=execFileSync('/usr/bin/systemctl',['show',service,'--property=MainPID','--value'],{encoding:'utf8',timeout:5000}).trim();
 requireValid(/^[1-9][0-9]{0,9}$/.test(pid));
 return pid;
}

export function currentGroqEnrollment(){
 const pid=servicePid(),proc='/proc/'+pid,identity=fs.statSync(proc);
 requireValid(identity.uid>0&&identity.gid>0);
 const fd=fs.openSync(proc+'/environ','r');let raw;
 try{
  const bytes=Buffer.alloc(65537);
  let size=0;
  while(size<bytes.length){
   const read=fs.readSync(fd,bytes,size,bytes.length-size,null);
   if(read===0)break;
   size+=read;
  }
  requireValid(size>0&&size<bytes.length&&bytes[size-1]===0);
  raw=bytes.subarray(0,size).toString('utf8');
 }finally{fs.closeSync(fd);}
 requireValid(servicePid()===pid);
 const env=Object.fromEntries(raw.split('\0').filter(Boolean).map(row=>[row.slice(0,row.indexOf('=')),row.slice(row.indexOf('=')+1)]));
 requireValid(env.BRIDGE_ENABLED==='true'&&env.BRIDGE_PROVIDER==='groq'&&env.GROQ_ENABLED==='true'&&env.GROQ_ONE_SHOT==='true'
  &&env.BRIDGE_CONSOLE_ENABLED==='true'&&env.BRIDGE_ADMISSION_ENABLED==='true');
 const config={ownerId:env.BRIDGE_OWNER_ID,allowedTaskId:env.BRIDGE_ALLOWED_TASK_ID,assistantId:env.BRIDGE_ASSISTANT_ID,
  keyId:env.BRIDGE_KEY_ID,consoleOrigins:JSON.parse(env.BRIDGE_CONSOLE_ORIGINS),admissionLegacyBaselineFile:env.BRIDGE_ADMISSION_LEGACY_BASELINE_FILE,
  admissionLegacyBaselineSha256:env.BRIDGE_ADMISSION_LEGACY_BASELINE_SHA256,workspaceEnabled:env.BRIDGE_WORKSPACE_ENABLED==='true',
  admissionSignedBridgeEnabled:env.BRIDGE_ADMISSION_SIGNED_BRIDGE_ENABLED==='true',admissionReusableBoardEnabled:env.BRIDGE_ADMISSION_REUSABLE_BOARD_ENABLED==='true'};
 const oldGate=JSON.parse(readExistingAdmissionFile(env.GROQ_FREE_GATE_FILE,16384,identity).text);
 const oldKey=readExistingAdmissionFile(env.GROQ_API_KEY_FILE,16384,identity).text.trim(),old=boundGate(oldGate,oldKey,config);
 const oldPolicy=createCatalogueLoader({activationEnabled:true,file:env.BRIDGE_ADMISSION_CATALOGUE_FILE,expectedUid:0,expectedGid:identity.gid})();
 const prior=env.GROQ_KEY_REPLACEMENT_FILE||env.GROQ_KEY_REPLACEMENT_SHA256;
 const previous=prior?readGroqReplacementHistory(env.GROQ_KEY_REPLACEMENT_FILE,env.GROQ_KEY_REPLACEMENT_SHA256,old,identity).record.previous:[];
 return {pid,identity,config,webReplacementEnabled:env.BRIDGE_GROQ_KEY_REPLACEMENT_ENABLED==='true',controlSocket:env.BRIDGE_CONTROL_SOCKET,markerDirectory:path.dirname(env.GROQ_ONCE_MARKER_FILE),oldGate,oldKey,oldPolicy,previous};
}

function stagedFiles(directory,plan,key){
 const history=json(plan.history);
 return [
  ['key',key+'\n',0o640],['gate.json',json(plan.gate),0o640],['catalogue.json',json(plan.policy),0o640],['replacement.json',history,0o640],
  ['activate.env',`GROQ_API_KEY_FILE=${directory}/key\nGROQ_FREE_GATE_FILE=${directory}/gate.json\nBRIDGE_ADMISSION_CATALOGUE_FILE=${directory}/catalogue.json\nGROQ_KEY_REPLACEMENT_FILE=${directory}/replacement.json\nGROQ_KEY_REPLACEMENT_SHA256=${admissionHash(history)}\nGROQ_KEY_EXPIRY_FILE=\n`,0o600],
 ];
}

function writeStage(directory,files,gid){
 fs.mkdirSync(directory,{mode:0o750});
 fs.chownSync(directory,0,gid);fs.chmodSync(directory,0o750);
 for(const [name,text,mode] of files){
  const fd=fs.openSync(path.join(directory,name),'wx',0o600);
  try{
   fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);
   fs.writeFileSync(fd,text);fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
 }
 for(const target of [directory,path.dirname(directory)]){
  const fd=fs.openSync(target,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
}

function protectedParent(directory){
 requireValid(process.platform==='linux'&&process.getuid()===0);
 const parent=path.dirname(directory);
 requireValid(/^\/[a-zA-Z0-9_./-]+$/.test(directory)&&path.resolve(directory)===directory&&fs.realpathSync(parent)===parent);
 for(let ancestor=parent;;ancestor=path.dirname(ancestor)){
  const info=fs.lstatSync(ancestor);
  requireValid(info.isDirectory()&&info.uid===0&&(info.mode&0o022)===0);
  if(ancestor==='/')break;
 }
}
function checkedFiles(current,directory,now){
  protectedParent(directory);
  const info=fs.lstatSync(directory);
  requireValid(info.isDirectory()&&info.uid===0&&info.gid===current.identity.gid&&(info.mode&0o777)===0o750);
  const read=name=>readExistingAdmissionFile(path.join(directory,name),32768,{...current.identity,rootOnly:true}).text;
  const gate=JSON.parse(read('gate.json'));
  const newKey=read('key').trim(),at=gate?.costEnrollment?.enrolledAt;
  requireValid(Number.isSafeInteger(at)&&at<=now&&now-at<=hour);
  const evidence=Object.fromEntries(evidenceFields.map(k=>[k,gate.costEnrollment[k]]));
  const plan=planGroqKeyReplacement({...current,newKey,evidence,at});
  requireValid(now-plan.gate.costEnrollment.verifiedAt<=hour&&servicePid()===current.pid);
  for(const [name,expected,permissions] of stagedFiles(directory,plan,newKey)){
  const file=path.join(directory,name),info=fs.lstatSync(file);
  requireValid((info.mode&0o777)===permissions&&info.gid===current.identity.gid
   &&readExistingAdmissionFile(file,32768,{...current.identity,rootOnly:true}).text===expected);
  }
  return plan.gate.enrollmentId;
}

export function stageGroqReplacement(current,{directory,newKey,evidence,at=Date.now()}){
 protectedParent(directory);
 const plan=planGroqKeyReplacement({...current,newKey,evidence,at});
 requireValid(servicePid()===current.pid);
 writeStage(directory,stagedFiles(directory,plan,newKey),current.identity.gid);
 return checkedFiles(current,directory,Date.now());
}

function main([mode,...args]){
 requireValid(process.platform==='linux'&&process.getuid()===0&&(mode==='stage'&&args.length===3||mode==='check'&&args.length===1));
 const current=currentGroqEnrollment(),directory=args.at(-1);
 if(mode==='stage'){
  const newKey=readExistingAdmissionFile(args[0],1024,{rootOnly:true}).text.trim();
  const evidence=JSON.parse(readExistingAdmissionFile(args[1],4096,{rootOnly:true}).text);
  stageGroqReplacement(current,{directory,newKey,evidence});
 }else checkedFiles(current,directory,Date.now());
 console.log(JSON.stringify({state:mode==='stage'?'staged':'checked',providerCalls:0}));
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{main(process.argv.slice(2));}catch{console.error('Groq replacement did not pass the protected operator checks.');process.exitCode=1;}
}
