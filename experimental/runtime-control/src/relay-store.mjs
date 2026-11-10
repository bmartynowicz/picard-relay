import {DatabaseSync} from 'node:sqlite';
import {canonical,validateWork} from './protocol.mjs';
import {encodeInvocationError,decodeInvocationError,isIncompleteDiagnostic} from './adapters.mjs';
// Unserializable proof: created only after the terminal SQLite transaction
// commits. A row read back after restart, copied object or failed commit is not
// authority to acknowledge an adapter's current reservation.
const incompleteFailureReceipts=new WeakMap();
export function isDurableIncompleteFailureReceipt(row,eventId){const proof=incompleteFailureReceipts.get(row);return !!proof&&proof.eventId===eventId&&row.event_id===eventId&&row.state==='failed'&&row.last_error===proof.lastError;}
const JOB_STATES=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'];
export const JOB_REASON_CODES=Object.freeze(['queued','claimed','invoking','completed','result_missing','outcome_uncertain','output_incomplete','scope_expired','scope_revoked','provider_quota','provider_payment','approval_unavailable','request_rejected','recorded_failure','unknown']);
export function recentJobReason(state,lastError,resultAvailable){
 const {code,diagnostic}=decodeInvocationError(lastError);
 if(state==='uncertain'||code==='groq_outcome_uncertain'||code==='invocation_outcome_uncertain')return 'outcome_uncertain';
 if(state==='failed'&&code==='groq_output_incomplete'&&isIncompleteDiagnostic(diagnostic))return 'output_incomplete';
 if(['queued','claimed','invoking'].includes(state))return state;
 if(state==='completed')return resultAvailable?'completed':'result_missing';
 if(state==='cancelled'||['owner_revoked','scope_revoked','scope_revoked_or_expired'].includes(code))return 'scope_revoked';
 if(code==='scope_expired')return 'scope_expired';
 if(code==='groq_quota_exhausted')return 'provider_quota';
 if(code==='groq_payment_required')return 'provider_payment';
 if(['groq_free_scope_unavailable','groq_once_allowance_unavailable','groq_cost_enrollment_stopped'].includes(code))return 'approval_unavailable';
 if(['groq_request_rejected','groq_scope_mismatch'].includes(code))return 'request_rejected';
 return state==='failed'||state==='blocked'?'recorded_failure':'unknown';
}

const usageCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000;
const usageSlug=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(value);
function codexUsageRecord(value){
 const keys='cachedInputTokens,comparisonId,effort,id,inputTokens,model,outputTokens,recordedAt,tools,v,variant';
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys||value.v!==1
  ||typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.id)
  ||!Number.isSafeInteger(value.recordedAt)||value.recordedAt<1||value.recordedAt>8_640_000_000_000_000
  ||!usageSlug(value.model)||!(value.effort===null||usageSlug(value.effort))
  ||![value.inputTokens,value.cachedInputTokens,value.outputTokens].every(usageCount)
  ||value.cachedInputTokens>value.inputTokens||value.inputTokens+value.outputTokens===0
  ||!Array.isArray(value.tools)||value.tools.length>20||!value.tools.every(usageSlug))return null;
 const tools=[...new Set(value.tools)].sort();
 if(value.comparisonId===null?value.variant!==null:
  !usageSlug(value.comparisonId)||!(value.variant==='baseline'&&!tools.length||value.variant==='assisted'&&tools.length))return null;
 return {...value,tools,totalTokens:value.inputTokens+value.outputTokens};
}

function openCodexUsage(db,owner){
 db.exec(`CREATE TABLE IF NOT EXISTS relay_codex_usage(
  owner TEXT NOT NULL,id TEXT NOT NULL,recorded_at INTEGER NOT NULL,comparison_id TEXT,variant TEXT,record TEXT NOT NULL,
  PRIMARY KEY(owner,id),UNIQUE(owner,comparison_id,variant)
 );
 CREATE INDEX IF NOT EXISTS relay_codex_usage_time ON relay_codex_usage(owner,recorded_at DESC,id);`);
 const byId=db.prepare('SELECT record FROM relay_codex_usage WHERE owner=? AND id=?');
 const byPair=db.prepare('SELECT record FROM relay_codex_usage WHERE owner=? AND comparison_id=? AND variant=?');
 const insert=db.prepare('INSERT OR IGNORE INTO relay_codex_usage(owner,id,recorded_at,comparison_id,variant,record) VALUES(?,?,?,?,?,?)');
 const recent=db.prepare('SELECT record FROM relay_codex_usage WHERE owner=? ORDER BY recorded_at DESC,id LIMIT 12');
 const prune=db.prepare('DELETE FROM relay_codex_usage WHERE owner=? AND id IN (SELECT id FROM relay_codex_usage WHERE owner=? ORDER BY recorded_at DESC,id LIMIT -1 OFFSET 1000)');
 return {
  record(value){
   const run=codexUsageRecord(value);
   if(!run)return 'invalid';
   const json=canonical(run);
   db.exec('BEGIN IMMEDIATE');
   try{
    const added=insert.run(owner,run.id,run.recordedAt,run.comparisonId,run.variant,json).changes===1;
    const status=added?'saved':byId.get(owner,run.id)?.record===json?'duplicate':'conflict';
    if(added)prune.run(owner,owner);
    db.exec('COMMIT');
    return status;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  list(){
   return recent.all(owner).map(({record})=>{
    const run=JSON.parse(record);
    let comparisonId=run.variant==='assisted'?run.comparisonId:null;
    if(run.variant===null&&run.tools.length&&!byPair.get(owner,run.id,'assisted'))comparisonId=run.id;
    const baseline=comparisonId&&JSON.parse(byPair.get(owner,comparisonId,'baseline')?.record??'null');
    // A baseline recorded after a standalone Picard run can name that run's ID.
    // The comparison is projected at read time, keeping both saved records immutable.
    const inOrder=run.variant==='assisted'||baseline?.recordedAt>=run.recordedAt;
    const baselineTokens=baseline&&inOrder&&baseline.model===run.model&&baseline.effort===run.effort?baseline.totalTokens:null;
    return {...run,baselineTokens,
     baselineFreshTokens:baselineTokens===null?null:baselineTokens-baseline.cachedInputTokens,
     savedTokens:baselineTokens===null?null:baselineTokens-run.totalTokens};
   });
  }
 };
}
// Production ledger contains immutable work/results, not replacement Board
// messages, questions or approvals. The Board remains their only persistence owner.
export function createRelayStore({dbPath,now=Date.now,canAccept=()=>true}={}){
 if(!dbPath)throw Error('durable_storage_required');
 const db=new DatabaseSync(dbPath);db.exec(`PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS relay_jobs(event_id TEXT PRIMARY KEY,owner TEXT NOT NULL,task TEXT NOT NULL,message_id TEXT NOT NULL,grant_id TEXT NOT NULL,grant_expires INTEGER NOT NULL,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,state TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,claimed_by TEXT,claimed_until INTEGER,response_id TEXT,result_json TEXT,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS relay_nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS relay_revocations(owner TEXT NOT NULL,task TEXT NOT NULL,grant_id TEXT NOT NULL,PRIMARY KEY(owner,task,grant_id));
 CREATE INDEX IF NOT EXISTS relay_jobs_state_time ON relay_jobs(state,created_at,event_id);
 CREATE UNIQUE INDEX IF NOT EXISTS relay_jobs_owner_message ON relay_jobs(owner,message_id);`);
 const get=id=>db.prepare('SELECT * FROM relay_jobs WHERE event_id=?').get(id)??null;
 const error=code=>Object.assign(Error(code),{code});
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
 function authorized(row){return row&&row.grant_expires>now()&&!db.prepare('SELECT 1 FROM relay_revocations WHERE owner=? AND task=? AND grant_id=?').get(row.owner,row.task,row.grant_id);}
 async function accept(payload){
  const p=await validateWork(payload),at=now();if(p.grantExpiresAt<=at)throw error('scope_expired');
  return transaction(()=>{
   if(db.prepare('SELECT 1 FROM relay_revocations WHERE owner=? AND task=? AND grant_id=?').get(p.ownerId,p.taskId,p.grantId))throw error('scope_revoked');
   const old=get(p.eventId);
   if(old){if(old.owner!==p.ownerId||old.task!==p.taskId||old.message_id!==p.requestId||old.payload_hash!==p.payloadHash||old.payload_json!==canonical(p))throw error('idempotency_conflict');return old;}
   if(!canAccept())throw error('relay_draining');
   if(db.prepare('SELECT COUNT(*) AS n FROM relay_jobs').get().n>=10000)throw error('queue_capacity');
   db.prepare("INSERT INTO relay_jobs(event_id,owner,task,message_id,grant_id,grant_expires,payload_hash,payload_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?)").run(p.eventId,p.ownerId,p.taskId,p.requestId,p.grantId,p.grantExpiresAt,p.payloadHash,canonical(p),at,at);return get(p.eventId);
  });
 }
 function claimNext({workerId,claimTtlMs}){
  const at=now();
  return transaction(()=>{
   // Unknown external outcome is a stop condition, never a second inference.
   for(const row of db.prepare("SELECT event_id,last_error FROM relay_jobs WHERE state='invoking' AND claimed_until<=? AND result_json IS NULL").all(at)){
    const {diagnostic}=decodeInvocationError(row.last_error);
    db.prepare("UPDATE relay_jobs SET state='uncertain',last_error=?,updated_at=? WHERE event_id=?").run(diagnostic?encodeInvocationError('invocation_outcome_uncertain',diagnostic):'invocation_outcome_uncertain',at,row.event_id);
   }
   db.prepare("UPDATE relay_jobs SET state='blocked',last_error='scope_expired',updated_at=? WHERE state IN('queued','claimed','invoking') AND grant_expires<=?").run(at,at);
   const row=db.prepare("SELECT * FROM relay_jobs WHERE state='queued' OR (state IN('claimed','invoking') AND claimed_until<=? AND (state='claimed' OR result_json IS NOT NULL)) ORDER BY created_at,event_id LIMIT 1").get(at);
   if(!row)return null;
   if(!authorized(row)){db.prepare("UPDATE relay_jobs SET state='cancelled',last_error='scope_revoked' WHERE event_id=?").run(row.event_id);return null;}
   const result=db.prepare("UPDATE relay_jobs SET state='claimed',attempt=attempt+1,claimed_by=?,claimed_until=?,updated_at=? WHERE event_id=? AND (state='queued' OR (state IN('claimed','invoking') AND claimed_until<=?))").run(workerId,Math.min(at+claimTtlMs,row.grant_expires),at,row.event_id,at);
   if(result.changes!==1)return null;const claimed=get(row.event_id);return {...claimed,request_id:claimed.event_id};
  });
 }
 function owned(input){const row=get(input.requestId);if(!row||!authorized(row)||!['claimed','invoking'].includes(row.state)||row.attempt!==input.attempt||row.claimed_by!==input.workerId||row.claimed_until<=now())throw error('claim_mismatch');return row;}
 function startInvocation(input){return transaction(()=>{owned(input);db.prepare("UPDATE relay_jobs SET state='invoking',updated_at=? WHERE event_id=?").run(now(),input.requestId);});}
 function recordInvocationDiagnostic(input){return transaction(()=>{owned(input);db.prepare('UPDATE relay_jobs SET last_error=?,updated_at=? WHERE event_id=?').run(encodeInvocationError('invocation_in_progress',input.diagnostic),now(),input.requestId);});}
 function renewLease(input){return transaction(()=>{const row=owned(input);db.prepare('UPDATE relay_jobs SET claimed_until=?,updated_at=? WHERE event_id=?').run(Math.min(now()+input.claimTtlMs,row.grant_expires),now(),input.requestId);});}
 function transition(input,state,code=null){
  const row=transaction(()=>{const row=owned(input);if(state==='completed'&&!row.result_json)throw error('result_missing');if(state==='failed'&&row.state==='invoking'&&!row.result_json&&!(code==='groq_output_incomplete'&&isIncompleteDiagnostic(input.diagnostic)))state='uncertain';const lastError=code&&input.diagnostic?encodeInvocationError(code,input.diagnostic):code;db.prepare('UPDATE relay_jobs SET state=?,last_error=?,claimed_by=NULL,claimed_until=NULL,updated_at=? WHERE event_id=?').run(state,lastError,now(),input.requestId);return get(input.requestId);});
  if(row.state==='failed'&&code==='groq_output_incomplete'&&isIncompleteDiagnostic(input.diagnostic))incompleteFailureReceipts.set(row,Object.freeze({eventId:row.event_id,lastError:row.last_error}));
  return row;
 }
 function getTaskContext({owner,task,requestId}){const row=get(requestId);if(!row||row.owner!==owner||row.task!==task||!authorized(row))throw error('identity_mismatch');const payload=JSON.parse(row.payload_json);return {owner,task,requestId,grantId:payload.grantId,requestText:payload.request.text,taskContext:payload.context,messageId:payload.requestId,attempt:row.attempt,payloadHash:row.payload_hash,responseId:row.response_id};}
 function appendReply(input){return transaction(()=>{
  const row=owned(input),p=JSON.parse(row.payload_json);
  if(input.owner!==row.owner||input.task!==row.task||input.requestId!==row.event_id||input.eventId!==`resp:${row.event_id}`)throw error('identity_mismatch');
  if(input.kind!=='answer'&&input.kind!=='question'||input.statusChange!==null||typeof input.body!=='string'||!input.body.trim()||input.body.length>16000)throw error('invalid_reply');
  const outcome=input.kind==='question'?{kind:'question',question:input.body.trim()}:{kind:'information'};
  if(input.kind==='question'&&input.body.trim().length>2000||input.outcomeKind!==outcome.kind)throw error('invalid_outcome');
  const result={v:1,eventId:p.eventId,ownerId:p.ownerId,taskId:p.taskId,requestId:p.requestId,grantId:p.grantId,assistantId:p.assistantId,payloadHash:p.payloadHash,responseId:`resp:${p.eventId}`,body:input.body.trim(),outcome};
  const encoded=canonical(result);if(row.result_json&&row.result_json!==encoded)throw error('idempotency_conflict');
  db.prepare('UPDATE relay_jobs SET response_id=?,result_json=?,updated_at=? WHERE event_id=?').run(result.responseId,encoded,now(),row.event_id);
  return {replayed:!!row.result_json,reply:{reply_id:result.responseId}};
 });}
 function cancel(owner,task,grantId){return transaction(()=>{db.prepare('INSERT OR IGNORE INTO relay_revocations VALUES(?,?,?)').run(owner,task,grantId);db.prepare("UPDATE relay_jobs SET state='cancelled',last_error='owner_revoked',updated_at=? WHERE owner=? AND task=? AND grant_id=? AND state!='completed'").run(now(),owner,task,grantId);});}
 function consumeNonce(nonce,expires){db.prepare('DELETE FROM relay_nonces WHERE expires<=?').run(now());return db.prepare('INSERT OR IGNORE INTO relay_nonces VALUES(?,?)').run(nonce,expires).changes===1;}
 // Network diagnostics must use an explicit authenticated owner and, when
 // configured, the allowed task. Never derive these counts from global stats:
 // a reused database can retain work from an earlier service configuration.
 function scopedStats({ownerId,allowedTaskId=''}={}){
  if(typeof ownerId!=='string'||!ownerId||ownerId.length>200||typeof allowedTaskId!=='string'||allowedTaskId.length>200)throw error('diagnostic_scope_invalid');
  return allowedTaskId
   ?db.prepare('SELECT state,COUNT(*) AS count FROM relay_jobs WHERE owner=? AND task=? GROUP BY state').all(ownerId,allowedTaskId)
   :db.prepare('SELECT state,COUNT(*) AS count FROM relay_jobs WHERE owner=? GROUP BY state').all(ownerId);
 }
 function recentJobs({ownerId,allowedTaskId='',limit=25,cursor=null}={}){
  const deny=()=>{throw error('job_history_unavailable');};
  if(typeof ownerId!=='string'||!ownerId||ownerId.length>200||typeof allowedTaskId!=='string'||allowedTaskId.length>200||!Number.isSafeInteger(limit)||limit<1||limit>50)deny();
  const where='owner=?'+(allowedTaskId?' AND task=?':''),scope=allowedTaskId?[ownerId,allowedTaskId]:[ownerId];let boundary=null;
  if(cursor!==null){
   try{if(typeof cursor!=='string'||cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))deny();const raw=Buffer.from(cursor,'base64url');if(raw.toString('base64url')!==cursor)deny();boundary=JSON.parse(raw.toString('utf8'));if(Object.keys(boundary).sort().join(',')!=='createdAt,ref,v'||boundary.v!==1||!Number.isSafeInteger(boundary.createdAt)||boundary.createdAt<0||boundary.createdAt>8640000000000000||!/^[a-f0-9]{64}$/.test(boundary.ref??'')||!db.prepare('SELECT 1 FROM relay_jobs WHERE '+where+' AND event_id=? AND created_at=?').get(...scope,boundary.ref,boundary.createdAt))deny();}catch{deny();}
  }
  // Project in SQLite: prompts, identities, bodies and provider metadata are
  // never selected. The cursor row must belong to this exact configured scope.
  const rows=db.prepare("SELECT substr(event_id,1,65) AS event_id,substr(state,1,32) AS state,CASE WHEN typeof(created_at)='integer' AND created_at BETWEEN 0 AND 8640000000000000 THEN created_at ELSE NULL END AS created_at,CASE WHEN typeof(updated_at)='integer' AND updated_at BETWEEN 0 AND 8640000000000000 THEN updated_at ELSE NULL END AS updated_at,CASE WHEN typeof(last_error)='text' AND length(last_error)<=1024 THEN last_error ELSE NULL END AS last_error,(response_id IS NOT NULL AND result_json IS NOT NULL) AS result_available FROM relay_jobs WHERE "+where+(boundary?' AND (created_at<? OR (created_at=? AND event_id<?))':'')+' ORDER BY relay_jobs.created_at DESC,relay_jobs.event_id DESC LIMIT ?').all(...scope,...(boundary?[boundary.createdAt,boundary.createdAt,boundary.ref]:[]),limit+1);
  const page=rows.slice(0,limit).map(row=>{
   if(!/^[a-f0-9]{64}$/.test(row.event_id??''))deny();
   const state=JOB_STATES.includes(row.state)?row.state:'unknown',time=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?value:null;
   const resultAvailable=state==='completed'&&row.result_available===1;
   return {ref:row.event_id,state,createdAt:time(row.created_at),updatedAt:time(row.updated_at),resultAvailable,reasonCode:recentJobReason(state,row.last_error,resultAvailable)};
  });
  const last=page.at(-1);if(rows.length>limit&&last?.createdAt===null)deny();
  const nextCursor=rows.length>limit?Buffer.from(JSON.stringify({v:1,createdAt:last.createdAt,ref:last.ref})).toString('base64url'):null;
  const result={rows:page,nextCursor};if(Buffer.byteLength(JSON.stringify(result))>16384)deny();return result;
 }
 return {accept,claimNext,startInvocation,recordInvocationDiagnostic,renewLease,getTaskContext,appendReply,cancel,consumeNonce,get,scopedStats,recentJobs,openCodexUsage:owner=>openCodexUsage(db,owner),close:()=>db.close(),getReplyByRequestId:id=>{const r=get(id);return r?.response_id?{reply_id:r.response_id}:null;},markCompleted:i=>transition(i,'completed'),markBlocked:i=>transition(i,'blocked',i.error),markFailed:i=>transition(i,'failed',i.error),stats:()=>db.prepare('SELECT state,COUNT(*) AS count FROM relay_jobs GROUP BY state').all()};
}
