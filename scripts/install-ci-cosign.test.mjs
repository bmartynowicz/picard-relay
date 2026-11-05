import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {ASSETS,digestBoundedFile,installVerifiedCosign} from './install-ci-cosign.mjs';
function fixture({badDigest,downloadError,verifyError}={}){
 const calls=[];let signatures=0;
 return {calls,d:{file:name=>'/private/'+name,async download(a){calls.push(['download',a.name]);if(a.name===downloadError)throw Error('download failed');},async digest(a){return a.name===badDigest?'0'.repeat(64):a.sha256;},async executable(name){calls.push(['executable',name]);},async run(name,args){calls.push(['verify',name,args]);if(++signatures===verifyError)throw Error('signature rejected');},async install(name){calls.push(['install',name]);}}};
}
test('no binary executes or installs when any pinned digest is wrong',async()=>{
 for(const asset of ASSETS){const f=fixture({badDigest:asset.name});await assert.rejects(installVerifiedCosign(f.d),/digest_mismatch/);assert.ok(f.calls.every(c=>!['executable','verify','install'].includes(c[0])));}
});
test('download failure cannot execute or install a partial asset set',async()=>{
 const f=fixture({downloadError:'kms.json'});await assert.rejects(installVerifiedCosign(f.d),/download failed/);assert.ok(f.calls.every(c=>!['executable','verify','install'].includes(c[0])));
});
test('either signature failure stops installation',async()=>{
 for(const verifyError of [1,2]){const f=fixture({verifyError});await assert.rejects(installVerifiedCosign(f.d),/signature rejected/);assert.equal(f.calls.filter(c=>c[0]==='verify').length,verifyError);assert.equal(f.calls.some(c=>c[0]==='install'),false);}
});
test('installation follows both original keyless identity and KMS verification',async()=>{
 const f=fixture();await installVerifiedCosign(f.d);const checks=f.calls.filter(c=>c[0]==='verify');assert.equal(checks.length,2);
 assert.deepEqual(checks[0],['verify','bootstrap',['verify-blob','--certificate-identity=keyless@projectsigstore.iam.gserviceaccount.com','--certificate-oidc-issuer=https://accounts.google.com','--bundle','/private/keyless.json','/private/cosign']]);
 assert.deepEqual(checks[1],['verify','bootstrap',['verify-blob','--key','/private/public.key','--bundle','/private/kms.json','/private/cosign']]);assert.deepEqual(f.calls.at(-1),['install','cosign']);
});
test('real file digest rejects empty and oversized files',async()=>{
 const root=await fs.mkdtemp(path.join(process.cwd(),'.cosign-test-')),file=path.join(root,'asset');
 try{await fs.writeFile(file,'abc');assert.equal(await digestBoundedFile(file,3),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');await assert.rejects(digestBoundedFile(file,2),/asset_bounds/);await fs.writeFile(file,'');await assert.rejects(digestBoundedFile(file,3),/asset_bounds/);}
 finally{await fs.rm(file,{force:true});await fs.rmdir(root);}
});
test('Linux digest rejects hard links and symlinks',{skip:process.platform==='win32'},async()=>{
 const root=await fs.mkdtemp(path.join(process.cwd(),'.cosign-test-')),file=path.join(root,'asset'),link=path.join(root,'linked');
 try{await fs.writeFile(file,'abc');await fs.link(file,link);await assert.rejects(digestBoundedFile(file,3),/asset_bounds/);await fs.unlink(link);await fs.symlink(file,link);await assert.rejects(digestBoundedFile(link,3));}
 finally{await fs.rm(link,{force:true});await fs.rm(file,{force:true});await fs.rmdir(root);}
});
