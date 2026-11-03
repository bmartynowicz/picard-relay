// No listener or provider. Real disposable SQLite plus request/response harness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../experimental/runtime-control/src/protocol.mjs';
import {createLocalAdmissionStore} from '../../experimental/finite-admission/local-store.mjs';
import {createLocalAdmissionHandler} from '../../experimental/finite-admission/local-handler.mjs';

export const token='A'.repeat(43),otherToken='B'.repeat(43),origin='https://fixture.invalid';
export function syntheticLegacyBaseline(f,rows=[]){return {v:1,kind:'PICARD_LEGACY_BASELINE_V1',enrollmentId:f.binding.enrollmentId,ownerId:f.binding.ownerId,taskId:f.binding.taskId,assistantId:f.binding.assistantId,observedAt:f.now(),rows};}
export async function fixture(t,{slots=2,legacyOptions={}}={}){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-admission-test-'));fs.writeFileSync(path.join(dir,'fixture-only.marker'),'PICARD_SYNTHETIC_ADMISSION_ONLY\n');
 let at=Date.now(),faultCommitNumber=null,commits=0,failResponse=false,authCalls=0,policyReads=0,activeToken=token,available={acceptingRequests:true,pendingUncertainty:false,costContradiction:false};const extraStores=[];
 const enrollment={v:1,owner:'fixture-owner',provider:'groq',model:'openai/gpt-oss-20b',accountLabel:'Synthetic integration',organizationId:'fixture-org',projectId:'fixture-project',keySha256:await digest('SYNTHETIC_ADMISSION_KEY_ONLY'),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-86400000,enrolledAt:at-10000,evidenceRef:'SYNTHETIC_RETAINED',keyAssociationEvidenceRef:'SYNTHETIC_KEY_ASSOCIATION'};
 const taskId='fixture-task',requestText='Propose a synthetic literal.',taskContext={title:'Synthetic only',nextAction:'No provider',latestFinding:'No live data'};
 const entry={entryId:'literal',purpose:'sanitized-source-proposal',requestText,taskContext,inputSha256:await digest(canonical({requestText,taskContext})),slots:[]};
 for(let i=0;i<slots;i++){const requestId=randomUUID();entry.slots.push({slotId:'slot-'+i,requestId,grantId:randomUUID(),eventId:await digest(canonical([enrollment.owner,taskId,requestId]))});}
 const catalogue={v:1,kind:'FINITE_ADMISSION_PROTOTYPE_ONLY',ownerId:enrollment.owner,taskId,assistantId:'groq:'+enrollment.model,enrollmentId:await digest(canonical(enrollment)),notBefore:at-1000,expiresAt:at+3600000,maxRequestLifetimeMs:600000,entries:[entry]};
 const binding={ownerId:catalogue.ownerId,taskId,assistantId:catalogue.assistantId,enrollmentId:catalogue.enrollmentId,keySha256:enrollment.keySha256,configurationSha256:'b'.repeat(64)};
 const policy={v:1,catalogue,costEnrollment:enrollment,configurationSha256:binding.configurationSha256};
 const dbPath=path.join(dir,'admission-fixture.sqlite');let store;
 const open=()=>createLocalAdmissionStore({mode:'synthetic-integration-only',dbPath,now:()=>at,...legacyOptions,beforeCommit:()=>{commits++;if(commits===faultCommitNumber)throw Error('PRIVATE_DISK_SENTINEL');}});
 store=open();
 const handler=(targetStore=store)=>createLocalAdmissionHandler({mode:'synthetic-integration-only',store:targetStore,auth:{authenticate:async value=>{authCalls++;return value===activeToken;}},loadPolicy:()=>{policyReads++;return policy;},binding,origins:[origin],now:()=>at,currentAvailability:()=>available,afterCommit:()=>{if(failResponse)throw Error('PRIVATE_RESPONSE_SENTINEL');}});
 async function request(url,{body,raw,headers={},method=body===undefined&&raw===undefined?'GET':'POST',adapter=handler()}={}){
  const input=raw===undefined?(body===undefined?[]:[Buffer.from(canonical(body))]):[Buffer.isBuffer(raw)?raw:Buffer.from(raw)];const req=Readable.from(input);Object.assign(req,{url,method,headers:{host:'fixture.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'__Host-PicardSession='+token,...headers}});
  let status=null,responseHeaders=null,responseBody=null;const res={writeHead(s,h){status=s;responseHeaders=h;},end(b){responseBody=b;}};const handled=await adapter(req,res);return {handled,status,headers:responseHeaders,body:responseBody===null?null:JSON.parse(responseBody)};
 }
 const selection={entryId:entry.entryId,slotId:entry.slots[0].slotId};
 const challenge=async(selected=selection)=>{const r=await request('/request-approvals',{body:selected});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const submit=async(c,extra={})=>request('/requests',{body:{...selection,nonce:c.nonce,approvedInputSha256:entry.inputSha256,approve:true,...extra}});
 t.after(()=>{for(const extra of extraStores)extra.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,dbPath,request,challenge,submit,selection,entry,catalogue,policy,enrollment,binding,get store(){return store;},now:()=>at,tick:ms=>at+=ms,availability:v=>available=v,breakResponse:()=>failResponse=true,fixResponse:()=>failResponse=false,rotateSession:()=>activeToken=otherToken,faultAt:n=>faultCommitNumber=n,get commits(){return commits;},get authCalls(){return authCalls;},get policyReads(){return policyReads;},trackStore:value=>extraStores.push(value),restart:()=>{store.close();store=open();},independentHandler:()=>{const second=open();extraStores.push(second);return handler(second);}};
}
