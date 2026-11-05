// Release-only tool. Same v3.1.3 bootstrap pin and v3.1.4 signature checks as
// cosign-installer b9c35392b7c1401bcc77d30c9b07cf4b1c7a7b07; official asset API
// avoids the failing release-download route. Never shipped to relay hosts.
import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const api='https://api.github.com/repos/sigstore/cosign/releases/assets/';
export const ASSETS=Object.freeze([
 {name:'bootstrap',url:api+'503286005',sha256:'4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71',maxBytes:160000000},
 {name:'cosign',url:api+'660069428',sha256:'424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa',maxBytes:160000000},
 {name:'keyless.json',url:api+'660074981',sha256:'355244bb0186e950ced20f03106640ba3a4630e1223d0467ff34bcebe10bb18a',maxBytes:16384},
 {name:'kms.json',url:api+'660074423',sha256:'b1282021bf1d6f1031d5df46cba12386c9b438d56d276d72f4df184a0008512b',maxBytes:16384},
 {name:'public.key',url:'https://raw.githubusercontent.com/sigstore/cosign/v3.1.4/release/release-cosign.pub',sha256:'f4cea466e5e887a45da5031757fa1d32655d83420639dc1758749b744179f126',maxBytes:4096},
].map(Object.freeze));
export async function digestBoundedFile(file,maxBytes){
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const s=await handle.stat();if(!s.isFile()||s.nlink!==1||s.size<1||s.size>maxBytes)throw Error('cosign_asset_bounds');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;if(bytes>maxBytes)throw Error('cosign_asset_bounds');hash.update(chunk);}
  return hash.digest('hex');
 }finally{await handle.close();}
}
// Explicit dependency seam for offline verification-order tests. CLI has fixed
// URLs, pins, identities and commands; no source or runner-selection input.
export async function installVerifiedCosign(d){
 for(const asset of ASSETS){await d.download(asset);if(await d.digest(asset)!==asset.sha256)throw Error('cosign_digest_mismatch:'+asset.name);}
 await d.executable('bootstrap');
 await d.run('bootstrap',['verify-blob','--certificate-identity=keyless@projectsigstore.iam.gserviceaccount.com','--certificate-oidc-issuer=https://accounts.google.com','--bundle',d.file('keyless.json'),d.file('cosign')]);
 await d.run('bootstrap',['verify-blob','--key',d.file('public.key'),'--bundle',d.file('kms.json'),d.file('cosign')]);
 await d.install('cosign');
}
export async function main(){
 if(process.platform!=='linux'||process.arch!=='x64'||process.argv.length!==2||!path.isAbsolute(process.env.RUNNER_TEMP??'')||!path.isAbsolute(process.env.GITHUB_PATH??''))throw Error('fixed_linux_ci_required');
 const directory=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP,'picard-cosign-'));await fs.chmod(directory,0o700);
 const file=name=>path.join(directory,name),exec=promisify(execFile),abort=new AbortController();
 const deadline=setTimeout(()=>abort.abort(),180000);deadline.unref();
 try{
  await installVerifiedCosign({file,
   async download(asset){await exec('/usr/bin/curl',['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--max-redirs','5','--connect-timeout','10','--max-time','90','--max-filesize',String(asset.maxBytes),'--header','Accept: application/octet-stream','--header','X-GitHub-Api-Version: 2022-11-28','--output',file(asset.name),asset.url],{timeout:100000,maxBuffer:8192,signal:abort.signal});},
   digest:asset=>digestBoundedFile(file(asset.name),asset.maxBytes),
   executable:name=>fs.chmod(file(name),0o700),
   run:(name,args)=>exec(file(name),args,{timeout:30000,maxBuffer:16384,signal:abort.signal}),
   async install(){await fs.chmod(file('cosign'),0o700);await fs.appendFile(process.env.GITHUB_PATH,directory+'\n');}
  });
  console.log('Cosign v3.1.4 installed after pinned digests and both signature checks.');
 }finally{clearTimeout(deadline);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
