// Disabled admission extension. Reuses existing ledger tables without migration.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {createRelayStore} from './relay-store.mjs';
import {canonical} from './protocol.mjs';
import {decodeInvocationError,encodeInvocationError} from './adapters.mjs';

const PREFIX='picard-admission:v1:';
const ASSOCIATION_EXPIRY=Number.MAX_SAFE_INTEGER;
export const admissionHash=value=>createHash('sha256').update(value).digest('hex');
export class AdmissionError extends Error{constructor(code){super(code);this.code=code;}}
export const stop=code=>{throw new AdmissionError(code);};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export const legacyMarkerName=value=>typeof value==='string'&&/^one-call-[A-Za-z0-9_-]{1,100}\.json$/.test(value);
const availability=value=>value?.acceptingRequests===true&&value.pendingUncertainty===false&&value.costContradiction===false;
function fixturePath(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||path.basename(file)!=='admission-fixture.sqlite')stop('fixture_storage_required');
 const dir=path.dirname(file),marker=path.join(dir,'fixture-only.marker');
 if(fs.realpathSync(dir)!==dir)stop('fixture_storage_required');
 const s=fs.lstatSync(marker);
 if(!s.isFile()||s.nlink!==1||fs.readFileSync(marker,'utf8')!=='PICARD_SYNTHETIC_ADMISSION_ONLY\n')stop('fixture_storage_required');
 for(const name of [file,file+'-wal',file+'-shm'])if(fs.existsSync(name)){const s=fs.lstatSync(name);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)stop('fixture_storage_required');}
}
export function createLocalAdmissionStore(options={}){
 if(options.mode!=='synthetic-integration-only')stop('production_admission_disabled');
 fixturePath(options.dbPath);return createStore({...options,localTestOnly:true});
}
export function createAdmissionStore({activationEnabled=false,...options}={}){
 if(activationEnabled!==true)return null;
 const file=options.dbPath,dir=path.dirname(file??'');
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||fs.realpathSync(dir)!==dir)stop('admission_storage_invalid');
 const parent=fs.lstatSync(dir),state=fs.lstatSync(file);
 if(!parent.isDirectory()||parent.uid!==process.getuid?.()||(parent.mode&0o777)!==0o700||!state.isFile()||state.isSymbolicLink()||state.nlink!==1||state.uid!==process.getuid?.()||(state.mode&0o022)!==0)stop('admission_storage_invalid');
 if(!options.relayStore)stop('admission_storage_invalid');
 return createStore({...options,localTestOnly:false});
}
function createStore({dbPath,now=Date.now,randomNonce=()=>randomBytes(32).toString('base64url'),beforeCommit=()=>{},relayStore=null,localTestOnly,loadLegacyBaseline=null,readLegacyMarkers=null,legacyBinding=null}){
 // Reuse the existing schema in an explicitly marked disposable database.
 const relay=relayStore??createRelayStore({dbPath,now});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
 const get=id=>db.prepare('SELECT * FROM relay_jobs WHERE event_id=?').get(id)??null;
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();beforeCommit();db.exec('COMMIT');return result;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}};
 const clock=()=>{const at=now();if(!integer(at))stop('clock_invalid');return at;};
 function decode(row){try{const at=row.nonce.lastIndexOf(':');const value=JSON.parse(Buffer.from(row.nonce.slice(at+1),'base64url').toString('utf8'));if(canonical(value)!==Buffer.from(row.nonce.slice(at+1),'base64url').toString('utf8'))stop('approval_record_invalid');return value;}catch{stop('approval_record_invalid');}}
 function key(scope,nonceHash,record){return PREFIX+'challenge:'+scope+':'+nonceHash+':'+Buffer.from(canonical(record)).toString('base64url');}
 function challengeRow(scope,nonceHash){
  if(!hex(scope)||!hex(nonceHash))stop('approval_invalid');
  const rows=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ? LIMIT 2').all(PREFIX+'challenge:'+scope+':'+nonceHash+':*');
  if(rows.length!==1)stop('approval_invalid');return rows[0];
 }
 function prune(at){
  // Never remove bridge nonces, consumed grants, jobs or historical uncertainty.
  db.prepare('DELETE FROM relay_nonces WHERE (nonce GLOB ? OR nonce GLOB ?) AND expires<=?').run(PREFIX+'attempt:*',PREFIX+'challenge:*',at);
  const rows=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ?').all(PREFIX+'challenge:*');
  if(rows.length>128)stop('approval_capacity');
  for(const row of rows){const c=decode(row);if(c.used===false&&integer(c.expiresAt)&&c.expiresAt<=at)db.prepare('DELETE FROM relay_nonces WHERE nonce=?').run(row.nonce);}
 }
 function recordAttempt(scope){
  return transaction(()=>{const at=clock();prune(at);
   if(!hex(scope))stop('approval_invalid');
   const prefix=PREFIX+'attempt:'+scope+':';
   if(db.prepare('SELECT COUNT(*) AS n FROM relay_nonces WHERE nonce GLOB ?').get(prefix+'*').n>=10)stop('admission_rate_limited');
   const nonce=randomNonce();if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))stop('nonce_unavailable');
   db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(prefix+admissionHash(nonce),at+60000);
  });
 }
 function issue({scope,sessionSha256,catalogueSha256,entryId,slotId,inputSha256,catalogueExpiresAt}){
  return transaction(()=>{const at=clock();prune(at);
   if(!hex(scope)||!hex(sessionSha256)||!hex(catalogueSha256)||!hex(inputSha256)||!integer(catalogueExpiresAt)||catalogueExpiresAt<=at)stop('approval_invalid');
   if(db.prepare('SELECT COUNT(*) AS n FROM relay_nonces WHERE nonce GLOB ?').get(PREFIX+'challenge:'+scope+':*').n>=16)stop('approval_capacity');
   const nonce=randomNonce();if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))stop('nonce_unavailable');const hash=admissionHash(nonce);
   if(db.prepare('SELECT 1 FROM relay_nonces WHERE nonce GLOB ?').get(PREFIX+'challenge:'+scope+':'+hash+':*'))stop('nonce_unavailable');
   const record={v:1,sessionSha256,catalogueSha256,entryId,slotId,inputSha256,createdAt:at,expiresAt:Math.min(at+60000,catalogueExpiresAt),used:false};
   db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(key(scope,hash,record),catalogueExpiresAt);
   return {nonce,expiresAt:record.expiresAt};
  });
 }
 function inspect({scope,nonce,sessionSha256,catalogueSha256,entryId,slotId,inputSha256}){
  if(typeof nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(nonce))stop('approval_invalid');
  const row=challengeRow(scope,admissionHash(nonce)),c=decode(row),at=clock();
  if(Object.keys(c).sort().join(',')!=='catalogueSha256,createdAt,entryId,expiresAt,inputSha256,sessionSha256,slotId,used,v'||c.v!==1||c.sessionSha256!==sessionSha256||c.catalogueSha256!==catalogueSha256||c.entryId!==entryId||c.slotId!==slotId||c.inputSha256!==inputSha256||!integer(c.createdAt)||!integer(c.expiresAt)||c.createdAt>at||row.expires<=at||typeof c.used!=='boolean')stop('approval_invalid');
  return {row,record:c};
 }
 function commit({proof,plan,catalogue,selection,currentAvailability,revalidate}){
  return transaction(()=>{
   const {row,record:c}=inspect(proof),at=clock(),p=plan.intent.payload,old=get(p.eventId);
   if(old){
    let prior;try{prior=JSON.parse(old.payload_json);}catch{stop('existing_record_invalid');}
    const entry=catalogue.entries.find(e=>e.entryId===selection.entryId),slot=entry?.slots.find(s=>s.slotId===selection.slotId);
    const issued=Date.parse(prior.request?.createdAt),life=prior.grantExpiresAt-issued;
    const copy={...prior};delete copy.payloadHash;
    if(!slot||old.owner!==p.ownerId||old.task!==p.taskId||old.message_id!==slot.requestId||old.grant_id!==slot.grantId||old.payload_hash!==prior.payloadHash||old.grant_expires!==prior.grantExpiresAt||prior.eventId!==slot.eventId||prior.ownerId!==p.ownerId||prior.taskId!==p.taskId||prior.requestId!==slot.requestId||prior.grantId!==slot.grantId||prior.assistantId!==catalogue.assistantId||prior.request?.text!==entry.requestText||prior.request?.answerTo!==null||canonical(prior.context)!==canonical(entry.taskContext)||admissionHash(canonical(copy))!==prior.payloadHash||!integer(issued)||issued<catalogue.notBefore||issued>=catalogue.expiresAt||issued>at||prior.grantExpiresAt>catalogue.expiresAt||life<1000||life>catalogue.maxRequestLifetimeMs)stop('existing_record_invalid');
    if(!['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].includes(old.state))stop('existing_record_invalid');
    return {duplicate:true,ref:old.event_id,state:old.state};
   }
   // A used proof without its original row is corruption, never a new admission.
   if(c.used)stop('approval_record_invalid');
   if(c.expiresAt<=at||p.grantExpiresAt<=at)stop('approval_expired');
   if(!hex(catalogue.enrollmentId)||plan.gate?.enrollmentId!==catalogue.enrollmentId)stop('approval_record_invalid');
   if(!availability(currentAvailability())||hasEnrollmentUncertainty(catalogue.enrollmentId))stop('admission_blocked');
   if(db.prepare('SELECT 1 FROM relay_revocations WHERE owner=? AND task=? AND grant_id=?').get(p.ownerId,p.taskId,p.grantId))stop('scope_revoked');
   if(grantSeenElsewhere(p.grantId,p.eventId))stop('scope_revoked');
   if(db.prepare('SELECT COUNT(*) AS n FROM relay_jobs').get().n>=10000)stop('queue_capacity');
   if(typeof revalidate!=='function'||revalidate()!==true)stop('catalogue_unavailable');
   if(!legacyAdmissionReady(catalogue.enrollmentId))stop('admission_blocked');
   db.prepare("INSERT INTO relay_jobs(event_id,owner,task,message_id,grant_id,grant_expires,payload_hash,payload_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?)").run(p.eventId,p.ownerId,p.taskId,p.requestId,p.grantId,p.grantExpiresAt,p.payloadHash,canonical(p),at,at);
   // This is durable stop metadata, never authentication or invocation authority.
   // It outlives catalogue/approval expiry and is atomic with the original job.
   db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(PREFIX+'enrollment:'+catalogue.enrollmentId+':'+p.eventId,ASSOCIATION_EXPIRY);
   db.prepare('UPDATE relay_nonces SET nonce=? WHERE nonce=?').run(key(proof.scope,admissionHash(proof.nonce),{...c,used:true}),row.nonce);
   return {duplicate:false,ref:p.eventId,state:'queued'};
  });
 }
 function isApproved({catalogue,entry,slot,catalogueSha256}){
  if(!db.prepare('SELECT 1 FROM relay_nonces WHERE nonce=? AND expires=?').get(PREFIX+'enrollment:'+catalogue.enrollmentId+':'+slot.eventId,ASSOCIATION_EXPIRY))return false;
  const signed=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ? LIMIT 2').all(PREFIX+'signed-bridge:'+slot.eventId+':*');
  if(signed.length){
   if(signed.length!==1||signed[0].expires!==ASSOCIATION_EXPIRY)return false;
   const c=decode(signed[0]),row=get(slot.eventId);
   return exact(c,['v','source','catalogueSha256','entryId','slotId','inputSha256','payloadHash','workSha256','createdAt'])&&c.v===1&&c.source==='authenticated-signed-bridge'&&c.catalogueSha256===catalogueSha256&&c.entryId===entry.entryId&&c.slotId===slot.slotId&&c.inputSha256===entry.inputSha256&&integer(c.createdAt)&&c.createdAt<=clock()&&row?.payload_hash===c.payloadHash&&hex(c.workSha256)&&admissionHash(row.payload_json)===c.workSha256;
  }
  const scope=admissionHash(canonical([catalogue.ownerId,catalogue.taskId]));
  const rows=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ? LIMIT 129').all(PREFIX+'challenge:'+scope+':*');
  if(rows.length>128)return false;
  return rows.some(row=>{const c=decode(row);return c.used===true&&row.expires>clock()&&c.catalogueSha256===catalogueSha256&&c.entryId===entry.entryId&&c.slotId===slot.slotId&&c.inputSha256===entry.inputSha256;});
 }
 function commitSignedBridge({payload,catalogue,selection,catalogueSha256,currentAvailability,revalidate}){
  // Only the explicitly enabled adapter calls this after receiver HMAC checks.
  // This is a distinct audit source, never a fabricated browser-session proof.
  return transaction(()=>{
   const at=clock(),p=payload,entry=catalogue.entries.find(e=>e.entryId===selection.entryId),slot=entry?.slots.find(s=>s.slotId===selection.slotId),issued=Date.parse(p?.request?.createdAt),copy={...p};delete copy.payloadHash;
   if(!slot||!hex(catalogueSha256)||!hex(catalogue.enrollmentId)||p?.v!==1||p.eventId!==slot.eventId||p.ownerId!==catalogue.ownerId||p.taskId!==catalogue.taskId||p.requestId!==slot.requestId||p.grantId!==slot.grantId||p.assistantId!==catalogue.assistantId||p.request?.text!==entry.requestText||p.request?.answerTo!==null||canonical(p.context)!==canonical(entry.taskContext)||admissionHash(canonical(copy))!==p.payloadHash||admissionHash(canonical([p.ownerId,p.taskId,p.requestId]))!==p.eventId||!integer(issued)||new Date(issued).toISOString()!==p.request.createdAt||issued<catalogue.notBefore||issued>at||issued>=catalogue.expiresAt||!integer(p.grantExpiresAt)||p.grantExpiresAt-issued<1000||p.grantExpiresAt-issued>catalogue.maxRequestLifetimeMs||p.grantExpiresAt>catalogue.expiresAt)stop('existing_record_invalid');
   const old=get(p.eventId);
   if(old){
    if(old.payload_json!==canonical(p)||old.payload_hash!==p.payloadHash||old.owner!==p.ownerId||old.task!==p.taskId||old.message_id!==p.requestId||old.grant_id!==p.grantId||old.grant_expires!==p.grantExpiresAt||!isApproved({catalogue,entry,slot,catalogueSha256}))stop('existing_record_invalid');
    return {duplicate:true,ref:p.eventId,state:old.state};
   }
   if(p.grantExpiresAt<=at||at>=catalogue.expiresAt)stop('approval_expired');
   if(!availability(currentAvailability())||hasEnrollmentUncertainty(catalogue.enrollmentId))stop('admission_blocked');
   if(db.prepare('SELECT 1 FROM relay_revocations WHERE owner=? AND task=? AND grant_id=?').get(p.ownerId,p.taskId,p.grantId)||grantSeenElsewhere(p.grantId,p.eventId))stop('scope_revoked');
   if(db.prepare('SELECT COUNT(*) AS n FROM relay_jobs').get().n>=10000)stop('queue_capacity');
   if(typeof revalidate!=='function'||revalidate()!==true)stop('catalogue_unavailable');
   if(!legacyAdmissionReady(catalogue.enrollmentId))stop('admission_blocked');
   const approval={v:1,source:'authenticated-signed-bridge',catalogueSha256,entryId:entry.entryId,slotId:slot.slotId,inputSha256:entry.inputSha256,payloadHash:p.payloadHash,workSha256:admissionHash(canonical(p)),createdAt:at};
   db.prepare("INSERT INTO relay_jobs(event_id,owner,task,message_id,grant_id,grant_expires,payload_hash,payload_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?)").run(p.eventId,p.ownerId,p.taskId,p.requestId,p.grantId,p.grantExpiresAt,p.payloadHash,canonical(p),at,at);
   db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(PREFIX+'enrollment:'+catalogue.enrollmentId+':'+p.eventId,ASSOCIATION_EXPIRY);
   db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(PREFIX+'signed-bridge:'+p.eventId+':'+Buffer.from(canonical(approval)).toString('base64url'),ASSOCIATION_EXPIRY);
   return {duplicate:false,ref:p.eventId,state:'queued'};
  });
 }
 function grantSeenElsewhere(grantId,eventId){return !!db.prepare('SELECT 1 FROM relay_jobs WHERE grant_id=? AND event_id<>? LIMIT 1').get(grantId,eventId);}
 function legacyAdmissionReady(enrollmentId){
  // Historical jobs have no enrollment column. Never infer an association from
  // age, state, the current catalogue, or the absence of an active cost latch.
  // This read-only inventory is separate from reloadable admission authority.
  try{
   if(!hex(enrollmentId))return false;
   const associations=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ? LIMIT 10001').all(PREFIX+'enrollment:*');
   const associated=new Set();
   if(associations.length>10000)return false;
   for(const a of associations){const match=/^picard-admission:v1:enrollment:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(a.nonce);if(!match||a.expires!==ASSOCIATION_EXPIRY||associated.has(match[2])||!get(match[2]))return false;associated.add(match[2]);}
   const jobs=db.prepare('SELECT event_id FROM relay_jobs LIMIT 10001').all();if(jobs.length>10000)return false;
   const legacy=jobs.filter(row=>!associated.has(row.event_id));if(legacy.length>64)return false;
   // Disposable fixtures may start empty; production always needs an explicit
   // root-controlled, hash-pinned inventory, including an empty one.
   if(localTestOnly&&!loadLegacyBaseline&&!readLegacyMarkers)return legacy.length===0;
   if(typeof loadLegacyBaseline!=='function'||typeof readLegacyMarkers!=='function')return false;
   const baseline=loadLegacyBaseline();
   if(baseline&&typeof baseline.then==='function'){void Promise.resolve(baseline).catch(()=>{});return false;}
   if(!exact(baseline,['v','kind','enrollmentId','ownerId','taskId','assistantId','observedAt','rows'])||baseline.v!==1||baseline.kind!=='PICARD_LEGACY_BASELINE_V1'||baseline.enrollmentId!==enrollmentId||!legacyBinding||['ownerId','taskId','assistantId','enrollmentId'].some(key=>baseline[key]!==legacyBinding[key])||!integer(baseline.observedAt)||baseline.observedAt>clock()||!Array.isArray(baseline.rows)||baseline.rows.length!==legacy.length)return false;
   const ids=new Set(legacy.map(row=>row.event_id)),markers=new Map();
   for(const entry of baseline.rows){
    if(!exact(entry,['eventId','grantId','state','rowSha256','markerName','markerSha256','acknowledgement'])||!hex(entry.eventId)||!ids.delete(entry.eventId)||typeof entry.grantId!=='string'||!entry.grantId||entry.grantId.length>200||!['completed','uncertain'].includes(entry.state)||!hex(entry.rowSha256)||!legacyMarkerName(entry.markerName)||!hex(entry.markerSha256)||markers.has(entry.markerName))return false;
    const row=get(entry.eventId);if(row.grant_id!==entry.grantId||row.state!==entry.state||admissionHash(canonical(row))!==entry.rowSha256)return false;
    if(entry.state==='completed'){if(entry.acknowledgement!==null)return false;}
    else{
     const ack=entry.acknowledgement;
     // These are references to separately reviewed evidence, not a runtime
     // claim that an approval string proves consent or resolves the outcome.
     if(!exact(ack,['eventId','grantId','approvalRef','receiptSha256'])||ack.eventId!==entry.eventId||ack.grantId!==entry.grantId||typeof ack.approvalRef!=='string'||!/^[\x20-\x7e]{1,300}$/.test(ack.approvalRef)||!hex(ack.receiptSha256))return false;
    }
    markers.set(entry.markerName,entry.markerSha256);
   }
   const observed=readLegacyMarkers([...markers.keys()].sort());
   if(observed&&typeof observed.then==='function'){void Promise.resolve(observed).catch(()=>{});return false;}
   if(!Array.isArray(observed)||observed.length!==markers.size)return false;
   for(const item of observed){if(!exact(item,['name','sha256'])||!markers.has(item.name)||markers.get(item.name)!==item.sha256)return false;markers.delete(item.name);}
   return ids.size===0&&markers.size===0;
  }catch{return false;}
 }
 function hasEnrollmentUncertainty(enrollmentId,{excludeInvokingEventId=null}={}){
  if(!hex(enrollmentId)||excludeInvokingEventId!==null&&!hex(excludeInvokingEventId))stop('admission_scope_invalid');
  if(!legacyAdmissionReady(enrollmentId))return true;
  const prefix=PREFIX+'enrollment:'+enrollmentId+':';
  const rows=db.prepare("SELECT n.nonce,n.expires,j.event_id,j.state,(j.response_id IS NOT NULL AND j.result_json IS NOT NULL) AS saved FROM relay_nonces n LEFT JOIN relay_jobs j ON j.event_id=substr(n.nonce,?) WHERE n.nonce GLOB ? LIMIT 10001").all(prefix.length+1,prefix+'*');
  if(rows.length>10000)return true;
  return rows.some(row=>{
   if(row.expires!==ASSOCIATION_EXPIRY||!hex(row.event_id)||row.nonce!==prefix+row.event_id||!['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].includes(row.state))return true;
   if(row.state==='uncertain')return true;
   // A restarted process cannot treat another pending invocation as fresh work.
   // Only answer() may exclude its own exact currently leased invocation.
   return row.state==='invoking'&&!row.saved&&row.event_id!==excludeInvokingEventId;
  });
 }
 function reconcileEligible(ids){
  if(!Array.isArray(ids)||ids.length>8||ids.some(id=>!hex(id)))stop('admission_scope_invalid');
  return transaction(()=>{const at=clock();for(const id of ids){const row=get(id);if(!row)continue;
   if(row.state==='invoking'&&row.claimed_until<=at&&!row.result_json){const {diagnostic}=decodeInvocationError(row.last_error);db.prepare("UPDATE relay_jobs SET state='uncertain',last_error=?,updated_at=? WHERE event_id=?").run(diagnostic?encodeInvocationError('invocation_outcome_uncertain',diagnostic):'invocation_outcome_uncertain',at,id);}
   else if(['queued','claimed','invoking'].includes(row.state)&&row.grant_expires<=at)db.prepare("UPDATE relay_jobs SET state='blocked',last_error='scope_expired',updated_at=? WHERE event_id=?").run(at,id);
  }});
 }
 function claimEligible({ids,workerId,claimTtlMs}){
  if(!Array.isArray(ids)||ids.length>8||ids.some(id=>!hex(id))||typeof workerId!=='string'||!workerId||!Number.isSafeInteger(claimTtlMs)||claimTtlMs<1000||claimTtlMs>900000)stop('admission_scope_invalid');
  return transaction(()=>{const at=clock(),rows=ids.map(get).filter(Boolean).filter(r=>r.state==='queued'||r.state==='claimed'&&r.claimed_until<=at||r.state==='invoking'&&r.claimed_until<=at&&r.result_json).sort((a,b)=>a.created_at-b.created_at||a.event_id.localeCompare(b.event_id));
   const row=rows[0];if(!row)return null;
   if(row.grant_expires<=at||db.prepare('SELECT 1 FROM relay_revocations WHERE owner=? AND task=? AND grant_id=?').get(row.owner,row.task,row.grant_id)){db.prepare("UPDATE relay_jobs SET state='cancelled',last_error='scope_revoked',updated_at=? WHERE event_id=?").run(at,row.event_id);return null;}
   const changed=db.prepare("UPDATE relay_jobs SET state='claimed',attempt=attempt+1,claimed_by=?,claimed_until=?,updated_at=? WHERE event_id=? AND state=?").run(workerId,Math.min(at+claimTtlMs,row.grant_expires),at,row.event_id,row.state);
   if(changed.changes!==1)return null;const claimed=get(row.event_id);return {...claimed,request_id:claimed.event_id};
  });
 }
 return Object.freeze({localTestOnly,mayInvoke:false,get,recordAttempt,issue,inspect,commit,commitSignedBridge,relay,isApproved,grantSeenElsewhere,legacyAdmissionReady,hasEnrollmentUncertainty,reconcileEligible,claimEligible,
  close(){db.close();if(!relayStore)relay.close();},
 });
}
