// Fresh-host enrollment of the existing fixed service contract. No migration,
// generic root command endpoint, model call, or rollback of durable workspace data.
import fs from 'node:fs';
import path from 'node:path';

export const RELAY_USER='board-event-relay';
export const SETUP_UNITS=Object.freeze(['board-event-relay.service','picard-relay-web.service','picard-groq-replacement.socket','picard-owner-update.path','picard-updater.timer','picard-updater-activity.timer']);
const updaterFiles=['updater.mjs','sigstore-verifier.mjs','fixed-service-adapter.mjs','pull.mjs','run-once.mjs','fetch-release.mjs','owner-request.mjs','activity-report.mjs','launch-versioned.mjs'];
const templates=['picard-updater.service','picard-updater.timer','picard-owner-update.service','picard-owner-update.path','picard-updater-activity.service','picard-updater-activity.timer'];
export function exclusiveFile(file,body,mode=0o444){fs.writeFileSync(file,body,{flag:'wx',mode});fs.chmodSync(file,mode);}
function directory(dir,uid=0,gid=0,mode=0o755){fs.mkdirSync(dir,{mode});fs.chownSync(dir,uid,gid);fs.chmodSync(dir,mode);}
export function installInitialRelease(paths,signed){
 if(process.getuid?.()!==0||!/^[a-f0-9]{64}$/.test(signed.release))throw Error('signed_setup_required');
 const release=paths.code+'/releases/'+signed.release;
 directory(paths.code+'/releases');directory(release);directory(release+'/src');
 for(const f of signed.files)exclusiveFile(release+'/'+f.path,f.bytes);
 exclusiveFile(release+'/manifest.json',signed.manifestBytes);
 fs.chmodSync(release+'/src',0o555);fs.chmodSync(release,0o555);
 fs.symlinkSync('releases/'+signed.release,paths.code+'/current');
 exclusiveFile(paths.code+'/state.json',JSON.stringify({highestSequence:signed.manifest.sequence})+'\n',0o644);
}
export function installHostSupport({paths,checkout,signed,uid,gid}){
 if(process.getuid?.()!==0)throw Error('root_setup_required');
 for(const d of [paths.updater,paths.updaterConfig,paths.keySupport])directory(d);
 directory(paths.updaterState,0,0,0o700);directory(paths.inbox,uid,gid,0o700);
 directory(paths.updateStatus);directory(paths.updateQueue,0,gid,0o770);directory(paths.keyStatus,0,gid,0o750);
 directory(paths.config+'/admission',0,gid,0o750);directory(paths.units+'/board-event-relay.service.d');
 exclusiveFile(paths.updaterConfig+'/policy.json',JSON.stringify(signed.policy,null,2)+'\n');
 exclusiveFile(paths.updaterConfig+'/trusted_root.json',signed.trust);
 exclusiveFile(paths.updaterConfig+'/openssl.cnf','# Bundled Node OpenSSL defaults. FIPS hosts are refused by setup.\n');
 exclusiveFile(paths.updater+'/cosign',signed.cosign,0o555);
 fs.symlinkSync(paths.code+'/node',paths.updater+'/node');
 for(const file of updaterFiles)exclusiveFile(paths.updater+'/'+file,fs.readFileSync(path.join(checkout,'experimental/updater',file)));
 exclusiveFile(paths.updateStatus+'/request.json',JSON.stringify({v:1,state:'idle',requestedAt:null,finishedAt:null,retryAt:null})+'\n',0o644);
 exclusiveFile(paths.keyStatus+'/status.json',JSON.stringify({v:1,state:'idle',id:null,updatedAt:Date.now()})+'\n',0o640);fs.chownSync(paths.keyStatus+'/status.json',0,gid);
 const keyFiles=['scripts/serve-groq-key-replacement.mjs','scripts/stage-groq-key-replacement.mjs','experimental/updater/fixed-service-adapter.mjs',...signed.files.map(f=>'experimental/runtime-control/'+f.path)];
 for(const file of keyFiles){const target=paths.keySupport+'/'+file;fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});exclusiveFile(target,fs.readFileSync(path.join(checkout,file)));}
 const unit=(name,text)=>exclusiveFile(paths.units+'/'+name,text,0o644);
 const environment=text=>text.replace('[Service]\n','[Service]\nEnvironment=OPENSSL_CONF='+paths.updaterConfig+'/openssl.cnf\n');
 for(const name of templates){let text=fs.readFileSync(path.join(checkout,'experimental/updater',name),'utf8');
  // Schedule from enrollment, not from boot time that may already be in the past.
  if(name==='picard-updater.timer')text=text.replace('OnBootSec=5min','OnActiveSec=5min');
  unit(name,name.endsWith('.service')?environment(text):text);
 }
 unit('picard-update-fetch.service',environment(fs.readFileSync(path.join(checkout,'experimental/updater/picard-update-fetch.service.in'),'utf8').replaceAll('@VERIFIED_RELAY_USER@',RELAY_USER)));
 for(const name of ['picard-groq-replacement.socket','picard-groq-replacement@.service']){
  const text=fs.readFileSync(path.join(checkout,'deploy',name),'utf8');unit(name,name.endsWith('.service')?environment(text):text);
 }
}
