// Noninteractive first boot on a NEW machine only. No provider credentials,
// owner password, account API, inference call or existing-host upgrade.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {get} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setupPaths,assertFresh,serviceUnits,NODE_VERSION,CADDY_VERSION} from './setup-linux-core.mjs';
import {prepareSignedSetup} from './setup-linux-trust.mjs';
import {installHostSupport,installInitialRelease,exclusiveFile} from './setup-linux-host.mjs';
import {portUnused} from './setup-linux.mjs';
import {labelFreshSetupExecutables} from './setup-linux-selinux.mjs';
import {BOOTSTRAP_CODE,BOOTSTRAP_CONFIG,BOOTSTRAP_ROOT,initialBrowserState,bootstrapUnits,validateBrowserSetupConfig} from './browser-setup-core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check=(v,c)=>{if(!v)throw Error(c);};
const command=(exe,args)=>{const r=spawnSync(exe,args,{encoding:'utf8',timeout:30000,maxBuffer:32768,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});check(r.status===0,'browser_setup_command_failed');return r.stdout.trim();};
export const FIRST_RUN_FILES=Object.freeze(['scripts/browser-setup-core.mjs','scripts/browser-setup-ui.mjs','scripts/serve-browser-setup.mjs','scripts/activate-browser-setup.mjs','scripts/setup-linux-core.mjs','scripts/setup-linux-host.mjs','experimental/updater/fixed-service-adapter.mjs','deploy/Caddyfile.workspace.example']);
export async function main(args=process.argv.slice(2)){
 check(process.platform==='linux'&&process.getuid()===0&&process.versions.node===NODE_VERSION&&args.length===2,'root_pinned_linux_setup_required');
 check(fs.existsSync('/run/systemd/system'),'systemd_required');
 check(!fs.existsSync('/proc/sys/crypto/fips_enabled')||fs.readFileSync('/proc/sys/crypto/fips_enabled','utf8').trim()!=='1','fips_host_not_qualified');
 const paths=setupPaths();assertFresh(paths);
 for(const p of [BOOTSTRAP_CODE,BOOTSTRAP_CONFIG,BOOTSTRAP_ROOT])check(!fs.existsSync(p),'existing_browser_setup_refused');
 for(const user of ['board-event-relay','picard-relay-web'])for(const type of ['passwd','group'])check(spawnSync('/usr/bin/getent',[type,user]).status===2,'existing_account_refused');
 for(const port of [80,443,8787])await portUnused(port);
 const file='/etc/picard-oracle-launch.json',info=fs.lstatSync(file);
 check(info.isFile()&&!info.isSymbolicLink()&&info.uid===0&&info.nlink===1&&(info.mode&0o777)===0o600&&info.size<=1024,'private_launch_config_required');
 const config=validateBrowserSetupConfig(JSON.parse(fs.readFileSync(file,'utf8'))),initial=initialBrowserState(config);
 for(const [file,max] of [[args[0],150000000],[args[1],100000000]]){const s=fs.lstatSync(file);check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size>0&&s.size<=max,'pinned_asset_required');}
 check(command(args[1],['version']).startsWith('v'+CADDY_VERSION+' '),'pinned_caddy_required');
 const signed=await prepareSignedSetup(root);let started=false;
 const mkdir=(p,uid=0,gid=0,mode=0o755)=>{fs.mkdirSync(p,{mode});fs.chownSync(p,uid,gid);fs.chmodSync(p,mode);};
 try{
  assertFresh(paths);mkdir(paths.code);exclusiveFile(paths.code+'/INSTALL-INCOMPLETE','Browser first-run installation. Preserve this state if setup stops.\n',0o600);
  for(const user of ['board-event-relay','picard-relay-web'])command('/usr/sbin/useradd',['--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',user]);
  const uid=Number(command('/usr/bin/id',['-u','board-event-relay'])),gid=Number(command('/usr/bin/id',['-g','board-event-relay']));
  const webUid=Number(command('/usr/bin/id',['-u','picard-relay-web'])),webGid=Number(command('/usr/bin/id',['-g','picard-relay-web']));
  mkdir(paths.config,0,gid,0o750);mkdir(paths.config+'/credentials',0,gid,0o750);mkdir(paths.config+'/policy',0,gid,0o750);
  mkdir(paths.state,uid,gid,0o700);mkdir(paths.state+'/markers',uid,gid,0o700);mkdir(paths.state+'/owner-auth',uid,gid,0o700);mkdir(paths.web,webUid,webGid,0o700);mkdir(paths.code+'/bin');
  exclusiveFile(paths.code+'/node',fs.readFileSync(args[0]),0o555);exclusiveFile(paths.code+'/bin/caddy',fs.readFileSync(args[1]),0o555);installInitialRelease(paths,signed);
  exclusiveFile(paths.state+'/owner-auth/auth-state.json',JSON.stringify(initial.auth)+'\n',0o600);fs.chownSync(paths.state+'/owner-auth/auth-state.json',uid,gid);
  exclusiveFile(paths.config+'/credentials/hmac',randomBytes(48).toString('base64url')+'\n',0o640);fs.chownSync(paths.config+'/credentials/hmac',0,gid);
  installHostSupport({paths,checkout:root,signed,uid,gid});labelFreshSetupExecutables(paths);
  mkdir(BOOTSTRAP_CODE);mkdir(BOOTSTRAP_CONFIG);mkdir(BOOTSTRAP_ROOT,0,gid,0o750);mkdir(BOOTSTRAP_ROOT+'/inbox',uid,gid,0o700);
  for(const name of [...FIRST_RUN_FILES,...signed.files.map(f=>'experimental/runtime-control/'+f.path)]){
   const target=BOOTSTRAP_CODE+'/'+name;fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});
   // cloud-init uses umask 077. These contain public reviewed code, not secrets;
   // the unprivileged setup service must be able to traverse every code parent.
   for(let dir=path.dirname(target);dir!==BOOTSTRAP_CODE;dir=path.dirname(dir))fs.chmodSync(dir,0o755);
   exclusiveFile(target,fs.readFileSync(path.join(root,name)));
  }
  exclusiveFile(BOOTSTRAP_CONFIG+'/config.json',JSON.stringify(config)+'\n',0o644);exclusiveFile(BOOTSTRAP_CONFIG+'/identity.json',JSON.stringify(initial.identity)+'\n',0o644);
  exclusiveFile(BOOTSTRAP_ROOT+'/status.json','{"v":1,"state":"waiting"}\n',0o640);fs.chownSync(BOOTSTRAP_ROOT+'/status.json',0,gid);
  const units=serviceUnits(paths);exclusiveFile(paths.units+'/board-event-relay.service',units.relay,0o644);exclusiveFile(paths.units+'/picard-relay-web.service',units.web,0o644);
  for(const [name,body] of Object.entries(bootstrapUnits(paths)))exclusiveFile(paths.units+'/'+name,body,0o644);
  const proxy='{\n admin off\n}\n'+config.hostname+' {\n @setupRead {\n method GET\n path / /auth/state /setup/progress\n }\n handle @setupRead {\n reverse_proxy 127.0.0.1:8787\n }\n @setupWrite {\n method POST\n path /auth/setup /auth/login /auth/logout /setup/groq\n }\n handle @setupWrite {\n request_body {\n max_size 2KB\n }\n reverse_proxy 127.0.0.1:8787\n }\n handle {\n respond 404\n }\n}\n';
  exclusiveFile(paths.code+'/Caddyfile',proxy);command(paths.code+'/bin/caddy',['adapt','--config',paths.code+'/Caddyfile','--adapter','caddyfile']);
  exclusiveFile(paths.code+'/installation.json',JSON.stringify({v:1,kind:'signed-browser-first-run',version:signed.manifest.version,releaseHash:signed.release,sourceCommit:signed.manifest.sourceCommit,installedAt:new Date().toISOString()})+'\n',0o444);
  command('/usr/bin/systemctl',['daemon-reload']);started=true;command('/usr/bin/systemctl',['enable','--now','picard-first-run.service','picard-first-run-activate.path','picard-relay-web.service']);
  for(const name of ['picard-first-run.service','picard-first-run-activate.path','picard-relay-web.service'])check(command('/usr/bin/systemctl',['is-active',name])==='active','first_run_service_not_active');
  let ready=false;
  for(let i=0;i<40;i++){try{
   // Native HTTP preserves the virtual-host header. Fetch deliberately ignores
   // a Host override and would probe the wrong origin on this loopback socket.
   const healthy=await new Promise((resolve,reject)=>{const req=get({hostname:'127.0.0.1',port:8787,path:'/auth/state',headers:{Host:config.hostname}},res=>{let raw='';res.on('data',c=>{raw+=c;if(raw.length>512)req.destroy(Error('health_too_large'));});res.on('end',()=>{try{resolve(res.statusCode===200&&JSON.parse(raw).enrolled===false);}catch{resolve(false);}});});req.setTimeout(1000,()=>req.destroy(Error('health_timeout')));req.on('error',reject);});
   if(healthy){ready=true;break;}
  }catch{}await new Promise(r=>setTimeout(r,250));}
  check(ready,'first_run_health_failed');
  fs.unlinkSync(paths.code+'/INSTALL-INCOMPLETE');
  console.log(JSON.stringify({state:'first_run_installed',origin:initial.origin,version:signed.manifest.version,providerCalls:0,claimExpiresAt:initial.auth.bootstrap.expiresAt}));
 }catch(error){if(started)spawnSync('/usr/bin/systemctl',['disable','--now','picard-first-run.service','picard-first-run-activate.path','picard-relay-web.service'],{timeout:30000,stdio:'ignore'});throw error;}
 finally{await signed.cleanup();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(JSON.stringify({state:'first_run_stopped',code:/^[a-z0-9_]+$/.test(e.message)?e.message:'setup_failed'}));process.exitCode=1;});
