// One-use setup preparation. Fixed official assets/publisher; no credentials,
// signing, model calls, source overrides or persistent network service.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {ASSETS,installVerifiedCosign,digestBoundedFile} from './install-ci-cosign.mjs';
import {readHttps,releaseUrl,decodeEnvelope} from '../experimental/updater/pull.mjs';
import {validateArtifact} from '../experimental/updater/updater.mjs';
import {verifierArgs} from '../experimental/updater/sigstore-verifier.mjs';
const exec=promisify(execFile),api='https://api.github.com/repos/sigstore/cosign/releases/assets/';
export const SOURCE='https://raw.githubusercontent.com/bmartynowicz/picard-relay/main/releases/stable.json';
const arm=Object.freeze([
 {name:'bootstrap',url:api+'503286299',sha256:'c5d324e091826b0d7a78eb16fef316450b4eb9aaec045611c08ba06f5e73220a',maxBytes:160000000},
 {name:'cosign',url:api+'660068106',sha256:'ade83b7aac62e131cacfe96d958948b2150cc9efec46a570a2649b8e27dedad2',maxBytes:160000000},
 {name:'keyless.json',url:api+'660074813',sha256:'82d1412476b161277e65614a7e21c715fe3612c01d0cf0f77992e8f0081938af',maxBytes:16384},
 {name:'kms.json',url:api+'660074309',sha256:'844c90077824f8134a8ef5c0d13f60ce4b2942d97e072d7e4c211e9f1d495f76',maxBytes:16384},
 ASSETS.find(a=>a.name==='public.key')
].map(Object.freeze));
export function setupCosignAssets(arch){if(arch==='x64')return ASSETS;if(arch==='arm64')return arm;throw Error('unsupported_setup_architecture');}
export function requireCheckoutRuntime(files,read){
 for(const {path:file,bytes} of files)if(!bytes.equals(read(file)))throw Error('signed_runtime_differs_from_checkout');
}
export async function prepareSignedSetup(checkout){
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('root_linux_setup_required');
 const directory=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'picard-setup-trust-'));await fs.chmod(directory,0o700);
 const file=name=>path.join(directory,name),env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',HOME:directory,LANG:'C',GOMAXPROCS:'1',GOMEMLIMIT:'64MiB'};
 const run=(binary,args)=>exec(binary,args,{env,timeout:90000,maxBuffer:32768});
 const cleanup=async()=>{const s=await fs.lstat(directory);if(!s.isDirectory()||s.uid!==0||s.isSymbolicLink()||!path.basename(directory).startsWith('picard-setup-trust-'))throw Error('setup_cleanup_refused');await fs.rm(directory,{recursive:true});};
 let phase='assets';
 try{
  await installVerifiedCosign({file,
   download:a=>exec('/usr/bin/curl',['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--max-redirs','5','--connect-timeout','10','--max-time','90','--max-filesize',String(a.maxBytes),'--header','Accept: application/octet-stream','--header','X-GitHub-Api-Version: 2022-11-28','--output',file(a.name),a.url],{env,timeout:95000,maxBuffer:4096}),
   digest:a=>digestBoundedFile(file(a.name),a.maxBytes),executable:name=>fs.chmod(file(name),0o700),run:(name,args)=>run(file(name),args),
   install:()=>fs.chmod(file('cosign'),0o700)
  },{assets:setupCosignAssets(process.arch)});
  // initialize verifies TUF metadata using the root embedded in the verified
  // official binary. Never trust a bare downloaded trusted_root.json.
  phase='tuf';await run(file('cosign'),['initialize']);
  const trustFile=file('.sigstore/root/tuf-repo-cdn.sigstore.dev/targets/trusted_root.json');
  const trustInfo=await fs.lstat(trustFile);if(!trustInfo.isFile()||trustInfo.isSymbolicLink()||trustInfo.size<1||trustInfo.size>262144)throw Error('setup_trust_unavailable');
  const trust=await fs.readFile(trustFile),policy=JSON.parse(await fs.readFile(path.join(checkout,'experimental/updater/policy.example.json'),'utf8'));
  if(policy.source!==SOURCE||policy.signatureMode!=='sigstore'||policy.allowedFiles.length!==20)throw Error('fixed_setup_policy_required');
  policy.enabled=true;
  phase='release';const packet=decodeEnvelope(await readHttps(releaseUrl(SOURCE)),policy,Date.now());
  const manifest=JSON.parse(packet.manifestBytes),mf=file('manifest.json'),proof=file('proof.json');
  await fs.writeFile(mf,packet.manifestBytes,{flag:'wx',mode:0o600});await fs.writeFile(proof,packet.signature,{flag:'wx',mode:0o600});
  const args=verifierArgs(mf,proof,manifest.sourceCommit);args[args.indexOf('--trusted-root')+1]=trustFile;
  phase='signature';await run(file('cosign'),args);
  const valid=validateArtifact(packet.manifestBytes,packet.bundleBytes,policy,Date.now());
  const source=await Promise.all(valid.files.map(async f=>({file:f.path,bytes:await fs.readFile(path.join(checkout,'experimental/runtime-control',f.path))})));
  phase='checkout';requireCheckoutRuntime(valid.files,name=>source.find(f=>f.file===name).bytes);
  return {...valid,manifestBytes:packet.manifestBytes,policy,trust,cosign:await fs.readFile(file('cosign')),trustSha256:createHash('sha256').update(trust).digest('hex'),cleanup};
 }catch(error){await cleanup();throw Error(/^[a-z_]+$/.test(error.message)?error.message:'setup_trust_'+phase+'_failed');}
}
