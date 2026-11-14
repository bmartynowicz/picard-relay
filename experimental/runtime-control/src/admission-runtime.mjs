// Preparation and attachment are separate. Nothing activates on module import.
import fs from 'node:fs';
import path from 'node:path';
import {canonical} from './protocol.mjs';
import {createCatalogueLoader,createLegacyBaselineLoader} from './admission-catalogue.mjs';
import {createAdmissionStore,admissionHash,legacyMarkerName,stop} from './admission-store.mjs';
import {readBoundAdmissionPolicy} from './admission-policy.mjs';
import {priorGroqEnrollmentIds,recordedGroqKeyExpiry,validCostEnrollmentMetadata} from './admission-enrollment.mjs';
import {createAdmissionAssistantAdapter} from './admission-dispatch.mjs';
import {createAdmissionHandler,createWorkspaceHandler,createPublicTestHandler} from './admission-handler.mjs';
import {admissionConsoleHtml} from './admission-ui.mjs';
import {groqHttpsFetch} from './https-fetch.mjs';
import {TextDecoder} from 'node:util';
import {connect} from 'node:net';

export const GROQ_REPLACEMENT_SOCKET='/run/picard-groq-replacement.sock';
export const GROQ_REPLACEMENT_STATUS='/var/lib/picard-groq-replacement/status.json';
export const groqReplacementId=value=>typeof value==='string'&&value.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const groqReplacementKey=value=>typeof value==='string'&&value.trim()===value&&/^gsk_[A-Za-z0-9_-]{20,508}$/.test(value);

function replacementRequest(socketPath,body){
 return new Promise((resolve,reject)=>{
  const socket=connect(socketPath);
  let reply='';
  socket.setEncoding('utf8');
  socket.setTimeout(3000,()=>socket.destroy(Error('key_replacement_unknown')));
  socket.once('connect',()=>socket.write(JSON.stringify(body)+'\n'));
  socket.once('error',()=>reject(Error('key_replacement_unknown')));
  socket.on('data',part=>{
   reply+=part;
   if(reply.length>64)socket.destroy(Error('key_replacement_unknown'));
   if(reply==='{"accepted":true}\n'){socket.destroy();resolve();}
   if(reply==='{"accepted":false}\n'){socket.destroy();reject(Error('key_replacement_busy'));}
  });
  socket.once('close',()=>reject(Error('key_replacement_unknown')));
 });
}

export function createGroqReplacementBridge({enabled=false,project='',enrollmentId='',socketPath=GROQ_REPLACEMENT_SOCKET,statusPath=GROQ_REPLACEMENT_STATUS,now=Date.now}={}){
 let posting=false;
 function status(){
  const off={v:1,enabled:false,project:'',state:'unavailable',id:null};
  if(!enabled)return off;
  try{
   const socket=fs.lstatSync(socketPath),parent=fs.lstatSync(path.dirname(statusPath));
   if(!socket.isSocket()||socket.uid!==0||socket.gid!==process.getgid()||(socket.mode&0o777)!==0o660
    ||fs.realpathSync(socketPath)!==socketPath||!parent.isDirectory()||parent.uid!==0||(parent.mode&0o022)!==0) return off;
   const record=JSON.parse(readExistingAdmissionFile(statusPath,512,{rootOnly:true}).text);
   if(Object.keys(record).sort().join(',')!=='id,state,updatedAt,v'||record.v!==1
    ||!['idle','checking','replaced','rejected','unknown'].includes(record.state)||!Number.isSafeInteger(record.updatedAt)
    ||record.updatedAt<0||record.updatedAt>now()+5000||(record.state==='idle'?record.id!==null:!groqReplacementId(record.id)))return off;
   const state=record.state==='checking'&&now()-record.updatedAt>240000?'unknown':record.state;
   return {v:1,enabled:true,project,state,id:record.id};
  }catch{return off;}
 }
 return {status,async request({id,key}){
  const current=status();
  if(!current.enabled)throw Error('key_replacement_unavailable');
  if(posting||current.id===id||['checking','unknown'].includes(current.state))throw Error('key_replacement_busy');
  posting=true;
  try{await replacementRequest(socketPath,{v:1,id,key,enrollmentId,free:true});return {v:1,enabled:true,project,state:'checking',id};}
  finally{posting=false;}
 }};
}

const fingerprint=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export function readExistingAdmissionFile(file,maxBytes=16384,{uid=process.getuid?.(),gid=process.getgid?.(),rootOnly=false}={}){
 let fd;try{
  if(process.platform!=='linux'||typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||fs.realpathSync(file)!==file)stop('admission_configuration_invalid');
  const s=fs.lstatSync(file,{bigint:true});
  if(!s.isFile()||s.nlink!==1n||!(rootOnly?[0n]:[0n,BigInt(uid)]).includes(s.uid)||(s.mode&0o027n)!==0n||(s.mode&0o400n)===0n||((s.mode&0o040n)!==0n&&s.gid!==BigInt(gid))||s.size<1n||s.size>BigInt(maxBytes))stop('admission_configuration_invalid');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  if(fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s))stop('admission_configuration_invalid');
  const bytes=Buffer.alloc(maxBytes+1),n=fs.readSync(fd,bytes,0,bytes.length,0);
  if(n!==Number(s.size)||fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s)||fingerprint(fs.lstatSync(file,{bigint:true}))!==fingerprint(s)||fs.realpathSync(file)!==file)stop('admission_configuration_invalid');
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n)),file,identity:fingerprint(s)};
 }catch{stop('admission_configuration_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readGroqReplacementHistory(file,sha256,current,identity){
 const source=readExistingAdmissionFile(file,32768,{...identity,rootOnly:true});
 const record=JSON.parse(source.text);
 if(canonical(record)+'\n'!==source.text||admissionHash(source.text)!==sha256)stop('groq_replacement_invalid');
 return {...source,record,priorEnrollmentIds:priorGroqEnrollmentIds(record,current)};
}
export function admissionConfigurationDigest({config,enrollmentId,keySha256,markerDirectory}){
 return admissionHash(canonical({v:1,ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,keyId:config.keyId,consoleOrigins:[...config.consoleOrigins].sort(),enrollmentId,keySha256,markerDirectory,legacyBaselineFile:config.admissionLegacyBaselineFile??'',legacyBaselineSha256:config.admissionLegacyBaselineSha256??'',...(config.admissionSignedBridgeEnabled===true?{signedBridgeAdmission:true}:{}),...(config.admissionReusableBoardEnabled===true?{reusableBoardAdmission:true}:{}),...(config.admissionMeasurementRunsEnabled===true?{measurementRunAdmission:true}:{})}));
}
export function readLegacyAdmissionMarkers(directory,expectedNames){
 let fd;try{
  if(process.platform!=='linux'||typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||fs.realpathSync(directory)!==directory||!Array.isArray(expectedNames)||expectedNames.length>64||expectedNames.some(name=>!legacyMarkerName(name))||new Set(expectedNames).size!==expectedNames.length)stop('legacy_review_required');
  const parent=fs.lstatSync(directory,{bigint:true}),uid=BigInt(process.getuid());
  if(!parent.isDirectory()||parent.uid!==uid||(parent.mode&0o777n)!==0o700n)stop('legacy_review_required');
  const names=fs.readdirSync(directory);if(names.length>1024)stop('legacy_review_required');
  // Compare names before opening anything: an unexpected legacy marker is a
  // review gate, never a reason to read another file or infer a new baseline.
  if(canonical(names.filter(name=>name.startsWith('one-call-')).sort())!==canonical([...expectedNames].sort()))stop('legacy_review_required');
  const result=[];
  for(const name of expectedNames){
   const file=path.join(directory,name),s=fs.lstatSync(file,{bigint:true});
   if(!s.isFile()||s.nlink!==1n||s.uid!==uid||(s.mode&0o777n)!==0o600n||s.size<1n||s.size>16384n)stop('legacy_review_required');
   fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   if(fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s))stop('legacy_review_required');
   const bytes=Buffer.alloc(16385),n=fs.readSync(fd,bytes,0,bytes.length,0);
   if(n!==Number(s.size)||fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s)||fingerprint(fs.lstatSync(file,{bigint:true}))!==fingerprint(s))stop('legacy_review_required');
   fs.closeSync(fd);fd=undefined;result.push({name,sha256:admissionHash(bytes.subarray(0,n))});
  }
  if(fingerprint(fs.lstatSync(directory,{bigint:true}))!==fingerprint(parent)||fs.realpathSync(directory)!==directory)stop('legacy_review_required');
  return result;
 }catch{stop('legacy_review_required');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function prepareAdmissionRuntime({activationEnabled=false,config,env=process.env,now=Date.now,fetchImpl=groqHttpsFetch}={}){
 if(activationEnabled!==true)return null;
 if(process.platform!=='linux'||config?.admissionEnabled!==true||config.consoleEnabled!==true||!config.consoleOrigins?.length||env.BRIDGE_PROVIDER!=='groq'||env.GROQ_ENABLED!=='true'||env.GROQ_ONE_SHOT!=='true'||config.assistantId!=='groq:openai/gpt-oss-20b')stop('admission_configuration_invalid');
 if(config.admissionReusableBoardEnabled===true&&config.admissionSignedBridgeEnabled!==true)stop('admission_configuration_invalid');
 if(config.admissionMeasurementRunsEnabled===true&&config.admissionReusableBoardEnabled!==true)stop('admission_configuration_invalid');
 if(config.workspaceEnabled===true&&config.admissionReusableBoardEnabled!==true)stop('admission_configuration_invalid');
 const publicTestEnabled=env.BRIDGE_PUBLIC_TEST_ENABLED==='true';
 if(publicTestEnabled&&(config.workspaceEnabled!==true||env.BRIDGE_PUBLIC_TEST_PROXY!=='caddy-overwrite-v1'||!env.BRIDGE_PUBLIC_TEST_ORIGIN))stop('public_test_configuration_invalid');
 // Anchor to the EXISTING retained enrollment and key. A catalogue cannot invent
 // another enrollment to evade an old shared uncertainty/cost latch.
 const gateFile=readExistingAdmissionFile(env.GROQ_FREE_GATE_FILE),keyFile=readExistingAdmissionFile(env.GROQ_API_KEY_FILE),legacy=JSON.parse(gateFile.text),apiKey=keyFile.text.trim(),e=legacy.costEnrollment;
 if(legacy.v!==3||!validCostEnrollmentMetadata(e)||legacy.owner!==config.ownerId||legacy.task!==config.allowedTaskId||e.owner!==config.ownerId||e.keySha256!==admissionHash(apiKey)||legacy.enrollmentId!==admissionHash(canonical(e)))stop('admission_configuration_invalid');
 let groqKeyExpiresAt=null;
 if(env.GROQ_KEY_EXPIRY_FILE){
  try{groqKeyExpiresAt=recordedGroqKeyExpiry(JSON.parse(readExistingAdmissionFile(env.GROQ_KEY_EXPIRY_FILE,512).text),e.keySha256);}
  catch{/* Optional display metadata can never block startup or authorize work. */}
 }
 const markerDirectory=path.dirname(env.GROQ_ONCE_MARKER_FILE??''),binding={ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,enrollmentId:legacy.enrollmentId,keySha256:e.keySha256,configurationSha256:''};
 if(publicTestEnabled)binding.publicTestOrigin=env.BRIDGE_PUBLIC_TEST_ORIGIN;
 binding.configurationSha256=admissionConfigurationDigest({config,enrollmentId:binding.enrollmentId,keySha256:binding.keySha256,markerDirectory});
 const catalogueLoader=createCatalogueLoader({activationEnabled:true,file:config.admissionCatalogueFile,expectedUid:0,expectedGid:process.getgid()});
 const loadLegacyBaseline=createLegacyBaselineLoader({activationEnabled:true,file:config.admissionLegacyBaselineFile,expectedSha256:config.admissionLegacyBaselineSha256,expectedUid:0,expectedGid:process.getgid()});
 const hasReplacement=Boolean(env.GROQ_KEY_REPLACEMENT_FILE||env.GROQ_KEY_REPLACEMENT_SHA256);
 let history=null,legacyEnrollmentId=binding.enrollmentId;
 if(hasReplacement){
  try{history=readGroqReplacementHistory(env.GROQ_KEY_REPLACEMENT_FILE,env.GROQ_KEY_REPLACEMENT_SHA256,e);}
  catch{/* Keep the console available while the invalid replacement stops new work. */}
  if(history){
   try{const prior=loadLegacyBaseline().enrollmentId;if(history.priorEnrollmentIds.includes(prior))legacyEnrollmentId=prior;}
   catch{/* The existing legacy-inventory check will require review. */}
  }
 }
 const boundFiles=history?[gateFile,keyFile,history]:[gateFile,keyFile];
 const loadBoundFiles=()=>{for(const old of boundFiles){if(fs.realpathSync(old.file)!==old.file||fingerprint(fs.lstatSync(old.file,{bigint:true}))!==old.identity)stop('admission_configuration_changed');}return catalogueLoader();};
 const loadPolicy=()=>{if(hasReplacement&&!history)stop('groq_replacement_invalid');return loadBoundFiles();};
 readBoundAdmissionPolicy(loadBoundFiles,binding);
 const adapter=createAdmissionAssistantAdapter({activationEnabled:true,signedBridgeEnabled:config.admissionSignedBridgeEnabled===true,workspaceEnabled:config.workspaceEnabled===true,publicTestEnabled,reusableBoardEnabled:config.admissionReusableBoardEnabled===true,measurementRunsEnabled:config.admissionMeasurementRunsEnabled===true,bridgeKeyId:config.keyId,loadPolicy,binding,apiKey,markerDirectory,now,fetchImpl,priorEnrollmentIds:history?.priorEnrollmentIds});
 const groqReplacement=createGroqReplacementBridge({enabled:env.BRIDGE_GROQ_KEY_REPLACEMENT_ENABLED==='true'&&config.workspaceEnabled===true,project:e.accountLabel,enrollmentId:binding.enrollmentId,now});
 return {adapter,attach({store,control,auth,baseHtml}){
  if(!auth)stop('admission_configuration_invalid');
  const admissionStore=createAdmissionStore({activationEnabled:true,dbPath:config.dbPath,relayStore:store,now,loadLegacyBaseline,legacyBinding:{...binding,enrollmentId:legacyEnrollmentId},reusableBoardEnabled:config.admissionReusableBoardEnabled===true,measurementRunsEnabled:config.admissionMeasurementRunsEnabled===true,workspaceEnabled:config.workspaceEnabled===true,reusableBinding:{ownerId:binding.ownerId,enrollmentId:binding.enrollmentId},readLegacyMarkers:names=>readLegacyAdmissionMarkers(markerDirectory,names)});
  try{
  adapter.attachStore(admissionStore,{accepting:()=>control.accepting});
  const handler=createAdmissionHandler({activationEnabled:true,store:admissionStore,auth,loadPolicy,binding,origins:config.consoleOrigins,now,currentAvailability:adapter.availability});
  const workspace=createWorkspaceHandler({enabled:config.workspaceEnabled===true,store:admissionStore,auth,loadPolicy,binding,origins:config.consoleOrigins,now,currentAvailability:adapter.availability});
  const publicTest=createPublicTestHandler({enabled:publicTestEnabled,proxyConfigured:env.BRIDGE_PUBLIC_TEST_PROXY==='caddy-overwrite-v1',publicOrigin:env.BRIDGE_PUBLIC_TEST_ORIGIN,auth,store:admissionStore,binding,origins:config.consoleOrigins,now,currentAvailability:adapter.availability,loadPolicy});
  return {handler:async(req,res)=>await publicTest(req,res)||await workspace(req,res)||await handler(req,res),groqKeyExpiresAt,groqReplacement,gradeResult:config.workspaceEnabled===true?input=>{admissionStore.recordAttempt(admissionHash(canonical([binding.ownerId,'quality-grades'])));return admissionStore.saveWorkspaceGrade(input);}:null,readGrade:config.workspaceEnabled===true?ref=>admissionStore.workspaceGrade(ref):null,html:admissionConsoleHtml(baseHtml,{activationEnabled:true,workspaceEnabled:config.workspaceEnabled===true,publicTestEnabled}),dispatchStore:{...store,claimNext:input=>adapter.claimNext(input)},close:()=>admissionStore.close()};
  }catch{admissionStore.close();stop('admission_configuration_invalid');}
 }};
}
