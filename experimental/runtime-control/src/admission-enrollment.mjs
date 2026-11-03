const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validCostEnrollmentMetadata(e){
 const fields=['v','provider','model','owner','accountLabel','organizationId','projectId','keySha256','accountPlan','noPaidFallback','verifiedAt','enrolledAt','evidenceRef','keyAssociationEvidenceRef'];
 return exact(e,fields)&&e.v===1&&e.provider==='groq'&&e.model==='openai/gpt-oss-20b'&&e.accountPlan==='Free'&&e.noPaidFallback===true&&['owner','accountLabel','organizationId','projectId','evidenceRef','keyAssociationEvidenceRef'].every(k=>typeof e[k]==='string'&&e[k].trim().length>0&&e[k].length<=500)&&/^[a-f0-9]{64}$/.test(e.keySha256)&&Number.isSafeInteger(e.verifiedAt)&&e.verifiedAt>=0&&Number.isSafeInteger(e.enrolledAt)&&e.enrolledAt>=e.verifiedAt;
}
