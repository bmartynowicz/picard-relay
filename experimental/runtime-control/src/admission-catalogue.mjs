// Explicitly enabled bounded catalogue reader. No writes or credential read.
import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {canonical} from './protocol.mjs';
import {stop,admissionHash} from './admission-store.mjs';
const fingerprint=s=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export function createLocalCatalogueLoader({mode,file,expectedUid=process.getuid?.(),expectedGid=process.getgid?.()}={}){
 if(mode!=='synthetic-integration-only')stop('production_admission_disabled');
 return createLoader({file,expectedUid,expectedGid});
}
export function createCatalogueLoader({activationEnabled=false,file,expectedUid=0,expectedGid=process.getgid?.()}={}){
 if(activationEnabled!==true)return null;
 return createLoader({file,expectedUid,expectedGid});
}
export function createLegacyBaselineLoader({activationEnabled=false,file,expectedSha256,expectedUid=0,expectedGid=process.getgid?.()}={}){
 if(activationEnabled!==true)return null;
 if(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))stop('legacy_review_required');
 return createLoader({file,expectedUid,expectedGid,expectedSha256,maxBytes:65536,legacy:true});
}
function createLoader({file,expectedUid,expectedGid,expectedSha256=null,maxBytes=32768,legacy=false}){
 if(process.platform!=='linux'||typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||!Number.isSafeInteger(expectedUid)||!Number.isSafeInteger(expectedGid))stop('catalogue_metadata_invalid');
 return function load(){
  const dir=path.dirname(file);let fd;
  try{
   if(fs.realpathSync(dir)!==dir)stop('catalogue_metadata_invalid');
   const parent=fs.lstatSync(dir,{bigint:true}),before=fs.lstatSync(file,{bigint:true});
   if(!parent.isDirectory()||parent.uid!==BigInt(expectedUid)||parent.gid!==BigInt(expectedGid)||(parent.mode&0o777n)!==0o750n||!before.isFile()||before.uid!==BigInt(expectedUid)||before.gid!==BigInt(expectedGid)||(before.mode&0o777n)!==0o640n||before.nlink!==1n||before.size<1n||before.size>BigInt(maxBytes))stop('catalogue_metadata_invalid');
   fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   if(fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(before))stop('catalogue_changed');
   const bytes=Buffer.alloc(maxBytes+1),n=fs.readSync(fd,bytes,0,bytes.length,0);let raw,value;
   if(n!==Number(before.size)||fingerprint(fs.fstatSync(fd,{bigint:true}))!==fingerprint(before)||fingerprint(fs.lstatSync(file,{bigint:true}))!==fingerprint(before))stop('catalogue_changed');
   const after=fs.lstatSync(dir,{bigint:true});if(parent.dev!==after.dev||parent.ino!==after.ino||parent.mode!==after.mode||parent.uid!==after.uid||parent.gid!==after.gid||fs.realpathSync(dir)!==dir)stop('catalogue_changed');
   raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));value=JSON.parse(raw);
   // Canonical JSON rejects duplicate keys, coercion and alternative encodings.
   if(canonical(value)+'\n'!==raw||!value||value.v!==1||expectedSha256!==null&&admissionHash(bytes.subarray(0,n))!==expectedSha256||!legacy&&Object.keys(value).sort().join(',')!=='catalogue,configurationSha256,costEnrollment,v'||legacy&&value.kind!=='PICARD_LEGACY_BASELINE_V1')stop('catalogue_metadata_invalid');
   return value;
  }catch{stop(legacy?'legacy_review_required':'catalogue_unavailable');}finally{if(fd!==undefined)fs.closeSync(fd);}
 };
}
