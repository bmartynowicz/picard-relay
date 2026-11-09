import {createHash} from 'node:crypto';
import {canonical} from './protocol.mjs';

const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validCostEnrollmentMetadata(e){
 const fields=['v','provider','model','owner','accountLabel','organizationId','projectId','keySha256','accountPlan','noPaidFallback','verifiedAt','enrolledAt','evidenceRef','keyAssociationEvidenceRef'];
 return exact(e,fields)&&e.v===1&&e.provider==='groq'&&e.model==='openai/gpt-oss-20b'&&e.accountPlan==='Free'&&e.noPaidFallback===true&&['owner','accountLabel','organizationId','projectId','evidenceRef','keyAssociationEvidenceRef'].every(k=>typeof e[k]==='string'&&e[k].trim().length>0&&e[k].length<=500)&&/^[a-f0-9]{64}$/.test(e.keySha256)&&Number.isSafeInteger(e.verifiedAt)&&e.verifiedAt>=0&&Number.isSafeInteger(e.enrolledAt)&&e.enrolledAt>=e.verifiedAt;
}

// A provider expiry is operator-recorded for this exact key. A grant,
// catalogue deadline, or old Free-plan observation cannot supply it.
export function recordedGroqKeyExpiry(record,keySha256){
 if(!exact(record,['v','keySha256','expiresAt'])||record.v!==1||!/^[a-f0-9]{64}$/.test(keySha256??'')
  ||record.keySha256!==keySha256||typeof record.expiresAt!=='string'||record.expiresAt.length!==24)return null;
 const expiresAt=Date.parse(record.expiresAt);
 return Number.isFinite(expiresAt)&&expiresAt>=0&&new Date(expiresAt).toISOString()===record.expiresAt?expiresAt:null;
}
const enrollmentId=e=>createHash('sha256').update(canonical(e)).digest('hex');
export function priorGroqEnrollmentIds(record,current){
 if(!validCostEnrollmentMetadata(current)||!exact(record,['v','activeEnrollmentId','previous'])||record.v!==1
  ||record.activeEnrollmentId!==enrollmentId(current)||!Array.isArray(record.previous)||record.previous.length<1||record.previous.length>8)throw Error('groq_replacement_invalid');
 const ids=new Set(),keys=new Set([current.keySha256]);
 for(const prior of record.previous){
  if(!validCostEnrollmentMetadata(prior)||['owner','organizationId','projectId'].some(k=>prior[k]!==current[k])
   ||prior.enrolledAt>current.enrolledAt||keys.has(prior.keySha256))throw Error('groq_replacement_invalid');
  keys.add(prior.keySha256);ids.add(enrollmentId(prior));
 }
 return [...ids];
}
