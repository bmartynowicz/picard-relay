import {DatabaseSync} from 'node:sqlite';
import {canonical,validateWork} from './protocol.mjs';
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
   db.prepare("UPDATE relay_jobs SET state='uncertain',last_error='invocation_outcome_uncertain',updated_at=? WHERE state='invoking' AND claimed_until<=? AND result_json IS NULL").run(at,at);
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
 function renewLease(input){return transaction(()=>{const row=owned(input);db.prepare('UPDATE relay_jobs SET claimed_until=?,updated_at=? WHERE event_id=?').run(Math.min(now()+input.claimTtlMs,row.grant_expires),now(),input.requestId);});}
 function transition(input,state,code=null){return transaction(()=>{const row=owned(input);if(state==='completed'&&!row.result_json)throw error('result_missing');if(state==='failed'&&row.state==='invoking'&&!row.result_json)state='uncertain';db.prepare('UPDATE relay_jobs SET state=?,last_error=?,claimed_by=NULL,claimed_until=NULL,updated_at=? WHERE event_id=?').run(state,code,now(),input.requestId);return get(input.requestId);});}
 function getTaskContext({owner,task,requestId}){const row=get(requestId);if(!row||row.owner!==owner||row.task!==task||!authorized(row))throw error('identity_mismatch');const payload=JSON.parse(row.payload_json);return {owner,task,requestId,requestText:payload.request.text,taskContext:payload.context,messageId:payload.requestId,attempt:row.attempt,payloadHash:row.payload_hash,responseId:row.response_id};}
 function appendReply(input){return transaction(()=>{
  const row=owned(input),p=JSON.parse(row.payload_json);
  if(input.owner!==row.owner||input.task!==row.task||input.requestId!==row.event_id||input.eventId!==`resp:${row.event_id}`)throw error('identity_mismatch');
  if(input.kind!=='answer'&&input.kind!=='question'||input.statusChange!==null||typeof input.body!=='string'||!input.body.trim()||input.body.length>4000)throw error('invalid_reply');
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
 return {accept,claimNext,startInvocation,renewLease,getTaskContext,appendReply,cancel,consumeNonce,get,scopedStats,close:()=>db.close(),getReplyByRequestId:id=>{const r=get(id);return r?.response_id?{reply_id:r.response_id}:null;},markCompleted:i=>transition(i,'completed'),markBlocked:i=>transition(i,'blocked',i.error),markFailed:i=>transition(i,'failed',i.error),stats:()=>db.prepare('SELECT state,COUNT(*) AS count FROM relay_jobs GROUP BY state').all()};
}
