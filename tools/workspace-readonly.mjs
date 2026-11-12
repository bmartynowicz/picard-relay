import {request as httpsRequest} from 'node:https';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createOwnerSessionCache, validCachedSession} from './owner-session-cache.mjs';
import {createWorkspaceAccessCache,validToolAccess} from './workspace-access-cache.mjs';

export const WORKSPACE_READ_LIMITS = Object.freeze({frameBytes:16384, responseBytes:1048576, resultBytes:262144, historyRows:25, reviewEvents:5, cursors:32});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/, cursorPattern=/^[A-Za-z0-9_-]{1,256}$/;
const states=['draft','expired','queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function check(condition,code='invalid_workspace_response'){if(!condition)throw Error(code);}
function keys(value,allowed,required=[]){return object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));}
export function workspaceOrigin(value){
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls_verification_required');
  let url;try{url=new URL(value);}catch{throw Error('invalid_origin');}
  check(url.protocol==='https:'&&(value===url.origin||value===url.origin+'/'),'invalid_origin');
  return url.origin;
}
export async function readPrivateWorkspaceSession(filename){
  check(process.platform!=='win32','use_windows_owner_session_cache');
  check(typeof filename==='string'&&isAbsolute(filename),'private_session_file_required');
  let file;
  try{
    file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=await file.stat();
    check(info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&(info.mode&0o077)===0&&info.size<=8192,'private_session_file_required');
    const bytes=await file.readFile();check(bytes.length<=8192,'private_session_file_required');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw Error('owner_sign_in_required');}finally{await file?.close();}
}

// Fixed HTTPS GET only. No redirect, body, login, provider request or arbitrary URL.
export function readWorkspaceHttps({origin,path,cookie,authorization}){
  return new Promise((resolve,reject)=>{
    const request=httpsRequest(origin+path,{method:'GET',rejectUnauthorized:true,signal:AbortSignal.timeout(10000),
      headers:{Accept:'application/json',Origin:origin,...(authorization?{Authorization:authorization}:{Cookie:cookie})}},response=>{
      if(response.statusCode!==200){response.destroy();resolve({status:response.statusCode});return;}
      if(!/^application\/json(?:;|$)/i.test(response.headers['content-type']??'')){
        response.destroy();reject(Error('invalid_workspace_response'));return;
      }
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>WORKSPACE_READ_LIMITS.responseBytes){response.destroy();reject(Error('workspace_response_too_large'));}
        else chunks.push(chunk);
      });
      response.on('error',()=>reject(Error('workspace_read_failed')));
      response.on('end',()=>{
        try{resolve({status:200,data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))});}
        catch{reject(Error('invalid_workspace_response'));}
      });
    });
    request.on('error',()=>reject(Error('workspace_read_failed')));request.end();
  });
}

function review(value,graded=false){
  if(value===null||value===undefined)return null;
  check(object(value)&&integer(value.revision)&&Array.isArray(value.history)&&value.history.length<=100);
  check(value.revision===value.history.length&&(value.revision===0?value.latest===null:object(value.latest)));
  const project=event=>{
    check(object(event)&&integer(event.revision)&&event.revision>0&&text(event.note,graded?500:2000)&&hash.test(event.resultSha256)&&integer(event.recordedAt));
    check(graded?Number.isInteger(event.score)&&event.score>=1&&event.score<=5:['accepted','changes_requested'].includes(event.decision));
    return {revision:event.revision,...(graded?{score:event.score}:{decision:event.decision}),note:event.note,
      resultSha256:event.resultSha256,recordedAt:event.recordedAt};
  };
  return {revision:value.revision,latest:value.latest?project(value.latest):null,
    history:value.history.slice(-WORKSPACE_READ_LIMITS.reviewEvents).map(project),
    historyTotal:value.history.length,historyTruncated:value.history.length>WORKSPACE_READ_LIMITS.reviewEvents};
}

export function createReadOnlyWorkspace({origin,sessionFile,readSession,transport=readWorkspaceHttps,now=Date.now}={}){
  origin=workspaceOrigin(origin);
  const load=readSession??(sessionFile?()=>readPrivateWorkspaceSession(sessionFile):async()=>await createWorkspaceAccessCache().read(origin)??await createOwnerSessionCache().read(origin));
  let session=null;const cursors=new Set();
  const valid=value=>validToolAccess(value,origin,now())||validCachedSession(value,origin,now());
  async function get(path,reference=false){
    check(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls_verification_required');
    if(!valid(session)){
      try{session=await load(origin);}catch{throw Error('owner_sign_in_required');}
    }
    check(valid(session),'owner_sign_in_required');
    let response;try{response=await transport({origin,path,...(session.token?{authorization:'Bearer '+session.token}:{cookie:session.cookie})});}
    catch(error){throw Error(['workspace_response_too_large','invalid_workspace_response'].includes(error.message)?error.message:'workspace_read_failed');}
    if(response.status===401){session=null;throw Error('owner_sign_in_required');}
    if(response.status>=300&&response.status<400)throw Error('workspace_redirect_rejected');
    if(response.status===403)throw Error('workspace_access_denied');
    if(response.status===404)throw Error(reference?'request_not_found':'workspace_not_enabled');
    check(response.status===200,'workspace_read_failed');
    check(object(response.data)&&response.data.v===1&&text(response.data.observedAt,40)&&Number.isFinite(Date.parse(response.data.observedAt)));
    return response.data;
  }
  function output(value){
    const result={readOnly:true,...value};const encoded=JSON.stringify(result);
    check(Buffer.byteLength(encoded)<=WORKSPACE_READ_LIMITS.resultBytes,'workspace_response_too_large');
    // Never reflect the authentication cookie, even if an upstream response echoes it.
    check(!encoded.includes(session.token??session.cookie.split('=')[1]),'invalid_workspace_response');
    return result;
  }
  function result(value,ref){
    check(states.includes(value.state));
    if(value.draft){
      const p=value.draft.payload;
      check(object(p)&&uuid.test(p.requestId)&&hash.test(p.eventId)&&(uuid.test(ref)?p.requestId===ref:p.eventId===ref));
      check(object(p.context)&&text(p.context.title,200)&&text(p.context.latestFinding,4000)&&text(p.request?.text,4000)&&text(p.taskId,200));
      return {ref:p.eventId,requestId:p.requestId,state:value.state,observedAt:value.observedAt,
        request:{title:p.context.title,text:p.request.text,context:p.context.latestFinding,taskId:p.taskId},
        resultAvailable:false,result:null,review:null,grade:null};
    }
    check(value.ref===ref&&hash.test(ref)&&typeof value.resultAvailable==='boolean'&&object(value.request));
    check(text(value.request.title,200)&&text(value.request.text,4000)&&text(value.request.context,4000)&&text(value.request.taskId,200));
    let saved=null;
    if(value.resultAvailable){
      check(value.state==='completed'&&text(value.result?.body,16000)&&['information','question'].includes(value.result.kind)
        &&hash.test(value.result.sha256)&&createHash('sha256').update(value.result.body).digest('hex')===value.result.sha256);
      saved={body:value.result.body,kind:value.result.kind,sha256:value.result.sha256};
    }
    const reviews=review(value.review),grades=review(value.grade,true);
    if(saved)for(const history of [reviews,grades])if(history){
      for(const entry of [...history.history,...(history.latest?[history.latest]:[])])check(entry.resultSha256===saved.sha256);
    }
    return {ref,state:value.state,observedAt:value.observedAt,request:{title:value.request.title,text:value.request.text,context:value.request.context,taskId:value.request.taskId},
      resultAvailable:value.resultAvailable,result:saved,review:reviews,grade:grades};
  }
  return {
    async status(args={}){
      check(keys(args,[]),'invalid_arguments');const v=await get('/workspace/config');
      check(v.enabled===true&&typeof v.ready==='boolean'&&(v.blockingCode===null||text(v.blockingCode,100))&&text(v.provider,100)&&text(v.model,100));
      check(object(v.limits)&&object(v.usage)&&Array.isArray(v.usage.jobs)&&v.usage.jobs.length<=states.length);
      const limits={};for(const key of ['maxCalls','maxOutputTokens','maxRequestCharacters','maxContextCharacters','maxTitleCharacters','maxCombinedInputBytes','requestLifetimeMs','approvalLifetimeMs','activeJobs','attemptsPerMinute']){
        check(integer(v.limits[key]));limits[key]=v.limits[key];
      }
      for(const key of ['tools','paidFallback']){check(typeof v.limits[key]==='boolean');limits[key]=v.limits[key];}
      check(integer(v.limits.retries));limits.retries=v.limits.retries;
      check(v.usage.measuredTokens===null||integer(v.usage.measuredTokens));
      check(v.usage.billedUsd===null||typeof v.usage.billedUsd==='number'&&Number.isFinite(v.usage.billedUsd)&&v.usage.billedUsd>=0);
      check(typeof v.usage.liveBillingVerified==='boolean');
      const jobs=v.usage.jobs.map(row=>{check(states.includes(row.state)&&integer(row.count));return {state:row.state,count:row.count};});
      return output({observedAt:v.observedAt,ready:v.ready,blockingCode:v.blockingCode,provider:v.provider,model:v.model,limits,
        usage:{jobs,measuredTokens:v.usage.measuredTokens??null,billedUsd:v.usage.billedUsd??null,liveBillingVerified:v.usage.liveBillingVerified===true}});
    },
    async list(args={}){
      check(keys(args,['cursor'])&&(!Object.hasOwn(args,'cursor')||cursorPattern.test(args.cursor)&&cursors.has(args.cursor)),'invalid_arguments');
      const v=await get('/workspace/history'+(args.cursor?'?cursor='+encodeURIComponent(args.cursor):''));
      check(Array.isArray(v.rows)&&v.rows.length<=WORKSPACE_READ_LIMITS.historyRows&&(v.nextCursor===null||cursorPattern.test(v.nextCursor)));
      const rows=v.rows.map(row=>{
        check(hash.test(row.ref)&&text(row.title,200)&&states.includes(row.state));
        const projected={ref:row.ref,title:row.title,state:row.state};
        for(const key of ['createdAt','updatedAt'])if(row[key]!==undefined){check(row[key]===null||integer(row[key]));projected[key]=row[key];}
        if(typeof row.resultAvailable==='boolean')projected.resultAvailable=row.resultAvailable;
        return projected;
      });
      if(v.nextCursor){cursors.add(v.nextCursor);if(cursors.size>WORKSPACE_READ_LIMITS.cursors)cursors.delete(cursors.values().next().value);}
      return output({observedAt:v.observedAt,rows,nextCursor:v.nextCursor});
    },
    async get(args){
      check(keys(args,['ref'],['ref'])&&(uuid.test(args.ref)||hash.test(args.ref)),'invalid_arguments');
      const isDraft=uuid.test(args.ref);
      let value=await get('/workspace/'+(isDraft?'drafts/':'requests/')+args.ref,true);
      const projected=result(value,args.ref);
      if(isDraft&&value.registered===true){
        value=await get('/workspace/requests/'+projected.ref,true);
        return output(result(value,projected.ref));
      }
      return output(projected);
    },
  };
}
