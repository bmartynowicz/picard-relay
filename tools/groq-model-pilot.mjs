#!/usr/bin/env node
// Explicit operator pilot. Never selected by the normal service or MCP runtime.
import {openSync,writeFileSync,fsyncSync,closeSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {readExistingAdmissionFile} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {groqReviewProfile,groqReviewProfileDigest,validCostEnrollmentMetadata} from '../experimental/runtime-control/src/admission-enrollment.mjs';
import {createGroqOnceAdapter} from '../experimental/runtime-control/src/groq-once-adapter.mjs';
import {inputDigest,costEnrollmentDigest} from '../experimental/runtime-control/src/groq-adapter.mjs';
import {groqHttpsFetch} from '../experimental/runtime-control/src/https-fetch.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=()=>{throw Error('model_pilot_scope_unavailable');};
function privateMarkerPath(file){
 if(typeof file!=='string'||!isAbsolute(file)||resolve(file)!==file)fail();
 const parent=dirname(file),s=lstatSync(parent);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700||realpathSync(parent)!==parent)fail();
 return file;
}
export function inspectModelPilot(gateFile,{now=Date.now}={}){
 const source=readExistingAdmissionFile(gateFile,16384,{rootOnly:true}),gate=JSON.parse(source.text),e=gate?.costEnrollment;
 const profile=groqReviewProfile(gate?.model,{alternateModelsEnabled:true});
 if(!profile||gate.v!==3||e?.v!==2||!validCostEnrollmentMetadata(e,{alternateModelsEnabled:true})||gate.provider!=='groq'||e.model!==gate.model||e.owner!==gate.owner||gate.enrollmentId!==costEnrollmentDigest(e)||gate.maxCalls!==1||gate.harmlessTestOnly!==true||gate.accountPlan!=='Free'||gate.noPaidFallback!==true||gate.maxCompletionTokens!==4096||e.enrolledAt>gate.requestIssuedAt||gate.requestIssuedAt>now()||gate.requestExpiresAt<=now()||gate.requestExpiresAt-gate.requestIssuedAt>3600000||gate.requestExpiresAt<=gate.requestIssuedAt)fail();
 const input={owner:gate.owner,task:gate.task,requestId:gate.eventId,invocationId:gate.eventId,attempt:1,requestText:gate.approvedRequestText,context:{grantId:gate.grantId,taskContext:gate.taskContext}};
 const c=gate.taskContext;
 if(!['public-source-review','sanitized-source-proposal'].includes(gate.purpose)||!['owner','task','grantId'].every(k=>typeof gate[k]==='string'&&gate[k].length>0&&gate[k].length<=200)||![gate.requestIssuedAt,gate.requestExpiresAt].every(n=>Number.isSafeInteger(n)&&n>=0)||typeof gate.approvedRequestText!=='string'||!gate.approvedRequestText||gate.approvedRequestText.length>4000||!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join(',')!=='latestFinding,nextAction,title'||typeof c.title!=='string'||!c.title||c.title.length>200||typeof c.nextAction!=='string'||c.nextAction.length>1500||typeof c.latestFinding!=='string'||c.latestFinding.length>4000||Buffer.byteLength(JSON.stringify({request:gate.approvedRequestText,context:c}))>12000)fail();
 if(inputDigest(input)!==gate.approvedInputSha256||typeof gate.eventId!=='string'||!/^[a-f0-9]{64}$/.test(gate.eventId)||typeof gate.markerDirectory!=='string'||!isAbsolute(gate.markerDirectory)||resolve(gate.markerDirectory)!==gate.markerDirectory)fail();
 return {source,gate,profile,input};
}
export async function runModelPilot({gateFile,keyFile,enabled=false,now=Date.now,fetchImpl=groqHttpsFetch}={}){
 if(enabled!==true||process.platform!=='linux')fail();
 const {source,gate,profile,input}=inspectModelPilot(gateFile,{now}),secret=readExistingAdmissionFile(keyFile,2048,{rootOnly:true}),apiKey=secret.text.trim();
 // Location comes from the protected approval, never a caller-selected fresh path.
 const markerPath=privateMarkerPath(join(gate.markerDirectory,'groq-model-pilot-'+gate.eventId+'.consumed')),resultFile=markerPath+'.result.json';
 try{lstatSync(resultFile);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
 if(hash(apiKey)!==gate.costEnrollment.keySha256)fail();
 const fetchBound=async(url,options)=>{
  // The operator may withdraw either protected file before the call boundary.
  for(const old of [source,secret])if(readExistingAdmissionFile(old.file,old===source?16384:2048,{rootOnly:true}).identity!==old.identity)fail();
  return fetchImpl(url,options);
 };
 const adapter=createGroqOnceAdapter({enabled:true,apiKey,gate,markerPath,now,fetchImpl:fetchBound,model:profile.model,alternateModelsEnabled:true});
 if(adapter.ready!==true)fail();
 const answer=await adapter.answer(input),bodySha256=hash(answer.body);
 const result={v:1,provider:'groq',model:profile.model,modelProfileSha256:groqReviewProfileDigest(profile),enrollmentId:gate.enrollmentId,owner:gate.owner,task:gate.task,eventId:gate.eventId,inputSha256:gate.approvedInputSha256,bodySha256,answer};
 let fd;try{fd=openSync(resultFile,'wx',0o600);writeFileSync(fd,JSON.stringify(result)+'\n');fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}
 const parent=openSync(dirname(resultFile),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
 return {state:'completed',model:profile.model,eventId:gate.eventId,resultFile,bodySha256,providerUsage:answer.providerUsage??null,billedUsd:null};
}
export function readModelPilotResult(resultFile){
 const saved=JSON.parse(readExistingAdmissionFile(resultFile,32768).text),profile=groqReviewProfile(saved?.model,{alternateModelsEnabled:true});
 if(saved?.v!==1||saved.provider!=='groq'||!profile||saved.modelProfileSha256!==groqReviewProfileDigest(profile)||typeof saved.answer?.body!=='string'||hash(saved.answer.body)!==saved.bodySha256||saved.answer.requestId!==saved.eventId||saved.answer.owner!==saved.owner||saved.answer.task!==saved.task||saved.answer.kind!=='answer'||saved.answer.outcomeKind!=='information'||saved.answer.statusChange!==null)fail();
 return saved;
}
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{'gate-file':{type:'string'},'key-file':{type:'string'},'result-file':{type:'string'},'enable-model-evaluation':{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log('inspect --gate-file ROOT_APPROVED_GATE\nrun --gate-file ROOT_APPROVED_GATE --key-file ROOT_KEY --enable-model-evaluation\nresult --result-file SAVED_RESULT\nLinux operator pilot only. Existing service/MCP model is unchanged. No approval creation, provider retries or fallback.');return;}
 if(positionals.length!==1)fail();
 if(positionals[0]==='inspect'){
  const {gate,profile}=inspectModelPilot(values['gate-file']);
  console.log(JSON.stringify({state:'inspected_only',model:profile.model,eventId:gate.eventId,inputSha256:gate.approvedInputSha256,modelProfileSha256:groqReviewProfileDigest(profile),expiresAt:gate.requestExpiresAt,providerCalls:0}));
 }else if(positionals[0]==='run')console.log(JSON.stringify(await runModelPilot({gateFile:values['gate-file'],keyFile:values['key-file'],enabled:values['enable-model-evaluation']===true})));
 else if(positionals[0]==='result')console.log(JSON.stringify(readModelPilotResult(values['result-file'])));
 else fail();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Model pilot stopped. Preserve its gate, consumed marker and saved evidence; do not retry provider work.');process.exitCode=1;});
