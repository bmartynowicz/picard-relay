// Privileged disposable Linux qualification, never an installation entrypoint.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSetup,setupPaths,assertFresh,writePrivateSetup} from '../../scripts/setup-linux-core.mjs';

assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const directory=fs.mkdtempSync('/run/picard-setup-qualification-');fs.chmodSync(directory,0o755);
try{
 const paths=setupPaths(directory+'/target');
 for(const d of [directory+'/target',directory+'/target/opt',directory+'/target/etc',directory+'/target/var',directory+'/target/var/lib',paths.units])fs.mkdirSync(d,{recursive:true,mode:0o755});
 assertFresh(paths);
 fs.mkdirSync(paths.config,{mode:0o750});fs.chownSync(paths.config,0,65534);
 assert.throws(()=>assertFresh(paths),/existing_installation_refused/);
 fs.rmdirSync(paths.config);fs.symlinkSync(directory,paths.config);assert.throws(()=>assertFresh(paths),/existing_installation_refused/);fs.unlinkSync(paths.config);
 for(const d of [paths.config,paths.config+'/credentials',paths.config+'/policy']){fs.mkdirSync(d,{mode:0o750});fs.chownSync(d,0,65534);}
 for(const d of [paths.state,paths.state+'/markers',paths.state+'/owner-auth']){fs.mkdirSync(d,{mode:0o700});fs.chownSync(d,65534,65534);}
 const plan=buildSetup({hostname:'picard.example.com',accountLabel:'Synthetic Free project',organizationId:'org_synthetic',projectId:'proj_synthetic',apiKey:'gsk_SYNTHETIC_ONLY_NOT_A_REAL_KEY_1234',freeConfirmed:true,keyProjectConfirmed:true,networkConfirmed:true},{paths});
 writePrivateSetup(plan,{uid:65534,gid:65534});
 const before=plan.privateFiles.map(v=>fs.readFileSync(v.file));
 assert.throws(()=>writePrivateSetup(plan,{uid:65534,gid:65534}),/EEXIST/);
 plan.privateFiles.forEach((v,i)=>assert.deepEqual(fs.readFileSync(v.file),before[i]));
 const code=fs.readFileSync(paths.config+'/first-sign-in.txt','utf8').match(/Setup code: (.+)/)[1];
 const input=path.join(directory,'test-input.json');fs.writeFileSync(input,JSON.stringify({env:plan.env,code}),{mode:0o644});
 // Drop to an existing non-login UID; no service users or host services created.
 const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),codeRoot=directory+'/code';
 const allowed=JSON.parse(fs.readFileSync(source+'/experimental/updater/policy.example.json','utf8')).allowedFiles;
 for(const file of [...allowed.map(v=>'experimental/runtime-control/'+v),'test/fixtures/setup-linux-owner-use.mjs']){
  const target=codeRoot+'/'+file;fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});fs.writeFileSync(target,fs.readFileSync(source+'/'+file),{mode:0o444});
 }
 const r=spawnSync(process.execPath,[codeRoot+'/test/fixtures/setup-linux-owner-use.mjs',input],{uid:65534,gid:65534,encoding:'utf8',timeout:40000,maxBuffer:65536});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/first_use_and_restart_passed/);
 for(const f of plan.privateFiles){const s=fs.lstatSync(f.file);assert.equal(s.mode&0o777,f.mode);assert.equal(s.nlink,1);assert.equal(s.uid,f.owner==='relay'?65534:0);}
 console.log(JSON.stringify({state:'setup_lifecycle_passed',realLinuxPermissions:true,serviceUid:65534,providerCalls:0,syntheticProviderResponses:1,hostServicesChanged:0}));
}finally{
 // Only the unique root-created fixture tree, never a configured install path.
 assert.match(directory,/^\/run\/picard-setup-qualification-[a-zA-Z0-9]+$/);fs.rmSync(directory,{recursive:true,force:true});
}
