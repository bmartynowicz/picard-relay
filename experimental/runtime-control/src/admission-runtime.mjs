// Preparation and attachment are separate. Nothing activates on module import.
import fs from 'node:fs';
import path from 'node:path';
import {canonical} from './protocol.mjs';
import {createCatalogueLoader,createLegacyBaselineLoader} from './admission-catalogue.mjs';
import {createAdmissionStore,admissionHash,legacyMarkerName,stop} from './admission-store.mjs';
import {readBoundAdmissionPolicy} from './admission-policy.mjs';
import {validCostEnrollmentMetadata} from './admission-enrollment.mjs';
import {createAdmissionAssistantAdapter} from './admission-dispatch.mjs';
import {createAdmissionHandler,createWorkspaceHandler} from './admission-handler.mjs';
import {admissionConsoleHtml} from './admission-ui.mjs';
import {groqHttpsFetch} from './https-fetch.mjs';
import {TextDecoder} from 'node:util';

const fingerprint=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export function readExistingAdmissionFile(file,maxBytes=16384){
 let fd;try{
  if(process.platform!=='linux'||typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||fs.realpathSync(file)!==file)stop('admission_configuration_invalid');
  const s=fs.lstatSync(file,{bigint:true}),uid=BigInt(process.getuid()),gid=BigInt(process.getgid());
  if(!s.isFile()||s.nlink!==1n||![0n,uid].includes(s.uid)||(s.mode&0o027n)!==0n||(s.mode&0o400n)===0n||((s.mode&0o040n)!==0n&&s.gid!==gid)||s.size<1n||s.size>BigInt(maxBytes))stop('admission_configuration_invalid');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  if(fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s))stop('admission_configuration_invalid');
  const bytes=Buffer.alloc(maxBytes+1),n=fs.readSync(fd,bytes,0,bytes.length,0);
  if(n!==Number(s.size)||fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(s)||fingerprint(fs.lstatSync(file,{bigint:true}))!==fingerprint(s)||fs.realpathSync(file)!==file)stop('admission_configuration_invalid');
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n)),file,identity:fingerprint(s)};
 }catch{stop('admission_configuration_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function admissionConfigurationDigest({config,enrollmentId,keySha256,markerDirectory}){
 return admissionHash(canonical({v:1,ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,keyId:config.keyId,consoleOrigins:[...config.consoleOrigins].sort(),enrollmentId,keySha256,markerDirectory,legacyBaselineFile:config.admissionLegacyBaselineFile??'',legacyBaselineSha256:config.admissionLegacyBaselineSha256??'',...(config.admissionSignedBridgeEnabled===true?{signedBridgeAdmission:true}:{}),...(config.admissionReusableBoardEnabled===true?{reusableBoardAdmission:true}:{})}));
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
 if(config.workspaceEnabled===true&&config.admissionReusableBoardEnabled!==true)stop('admission_configuration_invalid');
 // Anchor to the EXISTING retained enrollment and key. A catalogue cannot invent
 // another enrollment to evade an old shared uncertainty/cost latch.
 const gateFile=readExistingAdmissionFile(env.GROQ_FREE_GATE_FILE),keyFile=readExistingAdmissionFile(env.GROQ_API_KEY_FILE),legacy=JSON.parse(gateFile.text),apiKey=keyFile.text.trim(),e=legacy.costEnrollment;
 if(legacy.v!==3||!validCostEnrollmentMetadata(e)||legacy.owner!==config.ownerId||legacy.task!==config.allowedTaskId||e.owner!==config.ownerId||e.keySha256!==admissionHash(apiKey)||legacy.enrollmentId!==admissionHash(canonical(e)))stop('admission_configuration_invalid');
 const markerDirectory=path.dirname(env.GROQ_ONCE_MARKER_FILE??''),binding={ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,enrollmentId:legacy.enrollmentId,keySha256:e.keySha256,configurationSha256:''};
 binding.configurationSha256=admissionConfigurationDigest({config,enrollmentId:binding.enrollmentId,keySha256:binding.keySha256,markerDirectory});
 const catalogueLoader=createCatalogueLoader({activationEnabled:true,file:config.admissionCatalogueFile,expectedUid:0,expectedGid:process.getgid()});
 const loadLegacyBaseline=createLegacyBaselineLoader({activationEnabled:true,file:config.admissionLegacyBaselineFile,expectedSha256:config.admissionLegacyBaselineSha256,expectedUid:0,expectedGid:process.getgid()});
 const loadPolicy=()=>{for(const old of [gateFile,keyFile]){if(fs.realpathSync(old.file)!==old.file||fingerprint(fs.lstatSync(old.file,{bigint:true}))!==old.identity)stop('admission_configuration_changed');}return catalogueLoader();};
 readBoundAdmissionPolicy(loadPolicy,binding);
 const adapter=createAdmissionAssistantAdapter({activationEnabled:true,signedBridgeEnabled:config.admissionSignedBridgeEnabled===true,workspaceEnabled:config.workspaceEnabled===true,reusableBoardEnabled:config.admissionReusableBoardEnabled===true,bridgeKeyId:config.keyId,loadPolicy,binding,apiKey,markerDirectory,now,fetchImpl});
 return {adapter,attach({store,control,auth,baseHtml}){
  if(!auth)stop('admission_configuration_invalid');
  const admissionStore=createAdmissionStore({activationEnabled:true,dbPath:config.dbPath,relayStore:store,now,loadLegacyBaseline,legacyBinding:binding,reusableBoardEnabled:config.admissionReusableBoardEnabled===true,workspaceEnabled:config.workspaceEnabled===true,reusableBinding:{ownerId:binding.ownerId,enrollmentId:binding.enrollmentId},readLegacyMarkers:names=>readLegacyAdmissionMarkers(markerDirectory,names)});
  try{
  adapter.attachStore(admissionStore,{accepting:()=>control.accepting});
  const handler=createAdmissionHandler({activationEnabled:true,store:admissionStore,auth,loadPolicy,binding,origins:config.consoleOrigins,now,currentAvailability:adapter.availability});
  const workspace=createWorkspaceHandler({enabled:config.workspaceEnabled===true,store:admissionStore,auth,loadPolicy,binding,origins:config.consoleOrigins,now,currentAvailability:adapter.availability});
  return {handler:async(req,res)=>await workspace(req,res)||await handler(req,res),html:admissionConsoleHtml(baseHtml,{activationEnabled:true,workspaceEnabled:config.workspaceEnabled===true}),dispatchStore:{...store,claimNext:input=>adapter.claimNext(input)},close:()=>admissionStore.close()};
  }catch{admissionStore.close();stop('admission_configuration_invalid');}
 }};
}
