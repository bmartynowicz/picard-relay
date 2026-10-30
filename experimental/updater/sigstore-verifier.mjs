import {mkdtemp,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const IDENTITY='https://github.com/bmartynowicz/picard-relay/.github/workflows/sign-release.yml@refs/heads/main';
export const ISSUER='https://token.actions.githubusercontent.com';
const BINARY='/usr/local/lib/picard-updater/cosign';
const TRUST='/etc/picard-updater/trusted_root.json';
export function verifierArgs(manifestPath,bundlePath,sourceCommit){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('source_commit_required');
 return ['verify-blob','--bundle',bundlePath,'--trusted-root',TRUST,'--certificate-identity',IDENTITY,'--certificate-oidc-issuer',ISSUER,'--certificate-github-workflow-repository','bmartynowicz/picard-relay','--certificate-github-workflow-ref','refs/heads/main','--certificate-github-workflow-sha',sourceCommit,'--timeout','30s','--max-workers','1',manifestPath];
}
export async function verifySigstoreManifest(manifest,proof){
 if(!Buffer.isBuffer(manifest)||manifest.length>16384||!Buffer.isBuffer(proof)||proof.length>65536)throw Error('sigstore_size_limit');
 const m=JSON.parse(manifest),p=JSON.parse(proof);if(!p.mediaType?.startsWith('application/vnd.dev.sigstore.bundle'))throw Error('sigstore_bundle_required');
 for(const file of [BINARY,TRUST]){
  let parent=dirname(file);for(;;){const d=await lstat(parent);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==0||(d.mode&0o022))throw Error('sigstore_trust_parent_invalid');if(parent==='/')break;parent=dirname(parent);}
  const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('sigstore_trust_not_installed');}
 const dir=await mkdtemp(join(tmpdir(),'picard-verify-'));
 try {const mf=join(dir,'manifest.json'),bf=join(dir,'bundle.json');await writeFile(mf,manifest,{mode:0o600,flag:'wx'});await writeFile(bf,proof,{mode:0o600,flag:'wx'});
  await exec(BINARY,verifierArgs(mf,bf,m.sourceCommit),{timeout:35000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',HOME:'/var/lib/picard-updater',GOMAXPROCS:'1',GOMEMLIMIT:'64MiB'},windowsHide:true});return true;
 }catch{throw Error('sigstore_verification_failed');}finally{await rm(dir,{recursive:true,force:true});}
}
