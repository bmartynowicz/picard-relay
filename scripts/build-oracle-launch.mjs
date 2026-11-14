// Explicit publication boundary. No checkout archive, state, credentials, or
// runtime dependencies are copied implicitly. Downloads are not page assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
// Git's Windows checkout conversion must not change the signed source bytes or
// turn cloud-init/bash into CRLF scripts. Every allowlisted source is UTF-8 text.
const textBytes=bytes=>Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/g,'\n'));
export const HOST_FILES=Object.freeze([
 ...['setup-linux.sh','setup-linux.mjs','setup-linux-core.mjs','setup-linux-host.mjs','setup-linux-trust.mjs','setup-linux-selinux.mjs','install-ci-cosign.mjs','browser-setup-core.mjs','browser-setup-ui.mjs','serve-browser-setup.mjs','install-browser-setup.mjs','activate-browser-setup.mjs','serve-groq-key-replacement.mjs','stage-groq-key-replacement.mjs'].map(n=>'scripts/'+n),
 ...['Caddyfile.workspace.example','picard-groq-replacement.socket','picard-groq-replacement@.service'].map(n=>'deploy/'+n),
 ...['policy.example.json','updater.mjs','sigstore-verifier.mjs','fixed-service-adapter.mjs','pull.mjs','run-once.mjs','fetch-release.mjs','owner-request.mjs','activity-report.mjs','launch-versioned.mjs','picard-updater.service','picard-updater.timer','picard-owner-update.service','picard-owner-update.path','picard-updater-activity.service','picard-updater-activity.timer','picard-update-fetch.service.in'].map(n=>'experimental/updater/'+n)
]);
export const STACK_FILES=Object.freeze(['.terraform.lock.hcl','versions.tf','variables.tf','main.tf','outputs.tf','schema.yaml','cloud-init.tftpl','free-guard/main.tf']);
function tar(entries){
 const parts=[];
 for(const [name,body] of entries){
  if(Buffer.byteLength(name)>100||!/^[-a-zA-Z0-9_./@]+$/.test(name)||name.includes('..'))throw Error('unsafe_package_path');
  const header=Buffer.alloc(512),oct=(n,length)=>n.toString(8).padStart(length-1,'0')+'\0';
  header.write(name);header.write(oct(0o444,8),100);header.write(oct(0,8),108);header.write(oct(0,8),116);header.write(oct(body.length,12),124);header.write(oct(0,12),136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);
  header.write([...header].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  parts.push(header,body,Buffer.alloc((512-body.length%512)%512));
 }return Buffer.concat([...parts,Buffer.alloc(1024)]);
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc>>>1^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function zip(entries){
 const parts=[],central=[];let offset=0;
 for(const [name,body] of entries){const filename=Buffer.from(name),crc=crc32(body),h=Buffer.alloc(30),c=Buffer.alloc(46);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(body.length,22);h.writeUInt16LE(filename.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
  parts.push(h,filename,body);central.push(c,filename);offset+=h.length+filename.length+body.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...parts,directory,end]);
}
export async function oracleLaunchAssets({checkout=root}={}){
 const policy=JSON.parse(await fs.readFile(path.join(checkout,'experimental/updater/policy.example.json'),'utf8'));
 if(policy.allowedFiles.length!==20||policy.allowedFiles.some(p=>!/^src\/[a-z0-9-]+\.mjs$/.test(p)))throw Error('fixed_runtime_required');
 const names=[...HOST_FILES,...policy.allowedFiles.map(p=>'experimental/runtime-control/'+p)].sort();
 const host=gzipSync(tar(await Promise.all(names.map(async p=>{const file=path.join(checkout,p),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2000000)throw Error('package_source_invalid');return [p,textBytes(await fs.readFile(file))];}))),{level:9});
 host[9]=255; // gzip OS=unknown: identical reviewed archive on Windows and Linux.
 if(host.length>5000000)throw Error('host_package_too_large');
 const hash=sha(host),hostName='oracle-host-'+hash+'.tgz',base='https://bmartynowicz.github.io/picard-relay/';
 const constants=Buffer.from(JSON.stringify({locals:{picard_artifact_url:base+hostName,picard_artifact_sha256:hash}})+'\n');
 const stack=zip([...await Promise.all(STACK_FILES.map(async p=>[p,textBytes(await fs.readFile(path.join(checkout,'deploy/oracle',p)))])),['artifact.tf.json',constants]]);
 return {[hostName]:host,'oracle-stack.zip':stack};
}
export async function buildOracleLaunch(output){await fs.mkdir(output,{recursive:true});if((await fs.readdir(output)).length)throw Error('oracle_output_not_empty');const assets=await oracleLaunchAssets();for(const [name,body] of Object.entries(assets))await fs.writeFile(path.join(output,name),body,{flag:'wx'});return Object.fromEntries(Object.entries(assets).map(([n,b])=>[n,{bytes:b.length,sha256:sha(b)}]));}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await buildOracleLaunch(path.resolve(process.argv[2]??'dist/oracle')),null,2));
