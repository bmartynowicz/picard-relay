import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {labelFreshSetupExecutables} from './setup-linux-selinux.mjs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {setupPaths,assertFresh,validateAnswers,buildSetup,writePrivateSetup,serviceUnits,hash,NODE_VERSION,CADDY_VERSION} from './setup-linux-core.mjs';
import {prepareSignedSetup} from './setup-linux-trust.mjs';
import {RELAY_USER,SETUP_UNITS,installInitialRelease,installHostSupport} from './setup-linux-host.mjs';
import {checkHealth} from '../experimental/updater/fixed-service-adapter.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function check(ok,code){if(!ok)throw Error(code);}
function command(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',timeout:30000,maxBuffer:65536,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});check(r.status===0,'setup_command_failed_'+path.basename(exe));return r.stdout.trim();}
async function question(label,{secret=false}={}){
 const output=secret?new Writable({write(_data,_encoding,done){done();}}):process.stdout;
 const terminal=createInterface({input:process.stdin,output,terminal:true,historySize:0}),cancel=new AbortController();
 terminal.once('close',()=>cancel.abort());terminal.once('SIGINT',()=>terminal.close());
 if(secret)process.stdout.write(label);
 try{const value=await terminal.question(secret?'':label,{signal:cancel.signal});check(value.length<=512,'answer_too_long');return value.trim();}
 finally{terminal.close();if(secret)process.stdout.write('\n');}
}
export async function portUnused(port){
 for(const host of ['0.0.0.0','::'])await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',e=>host==='::'&&e.code==='EAFNOSUPPORT'?resolve():reject(Error('port_in_use_'+port)));s.listen({host,port,exclusive:true},()=>s.close(resolve));});
}
function mkdir(dir,uid,gid,mode){fs.mkdirSync(dir,{mode});fs.chownSync(dir,uid,gid);fs.chmodSync(dir,mode);}
function exclusive(file,body,mode){fs.writeFileSync(file,body,{flag:'wx',mode});fs.chmodSync(file,mode);}
function accountAbsent(name){const r=spawnSync('/usr/bin/getent',['passwd',name],{timeout:5000});check(r.status===2,'existing_account_refused');const g=spawnSync('/usr/bin/getent',['group',name],{timeout:5000});check(g.status===2,'existing_group_refused');}
function checkedInput(file,max){const s=fs.lstatSync(file);check(s.isFile()&&s.nlink===1&&s.size>0&&s.size<=max&&!s.isSymbolicLink(),'invalid_setup_input');return fs.readFileSync(file);}
async function healthyInstalledRuntime(paths,release){
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  try{
   const pid=Number(command('/usr/bin/systemctl',['show','board-event-relay.service','--property=MainPID','--value']));
   const h=await new Promise((resolve,reject)=>{const socket=net.createConnection(paths.state+'/control.sock');let raw='';
    socket.setTimeout(1000,()=>socket.destroy(Error('startup_health_timeout')));socket.on('error',reject);
    socket.on('connect',()=>socket.write('{"v":1,"action":"health"}\n'));
    socket.on('data',b=>{raw+=b.toString('utf8');if(raw.length>4096){socket.destroy(Error('startup_health_oversize'));return;}if(raw.includes('\n')){socket.destroy();try{resolve(JSON.parse(raw.trim()));}catch(e){reject(e);}}});
    socket.on('end',()=>reject(Error('startup_health_incomplete')));
   });
   if(checkHealth(h,{release,pid}))return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('installed_runtime_not_ready');
}
export async function main(args=process.argv.slice(2)){
 if(args.includes('--help')){console.log('Fresh Linux setup: sudo bash scripts/setup-linux.sh\nRequires an existing systemd Linux host, a hostname pointing to it, inbound TCP 80/443, and an owner-verified Groq Free key. Existing installs are refused. No provider call is made.');return;}
 check(args.length===2,'use_setup_linux_sh');
 check(process.platform==='linux'&&process.getuid()===0&&process.stdin.isTTY&&process.stdout.isTTY,'root_private_terminal_required');
 check(process.versions.node===NODE_VERSION,'pinned_node_required');
 check(fs.existsSync('/run/systemd/system'),'systemd_required');
 check(!fs.existsSync('/proc/sys/crypto/fips_enabled')||fs.readFileSync('/proc/sys/crypto/fips_enabled','utf8').trim()!=='1','fips_host_not_qualified');
 const os=fs.readFileSync('/etc/os-release','utf8');
 check(/\n?ID=(?:ubuntu|"?ol"?)\n/.test(os)&&(/VERSION_ID="(?:22\.04|24\.04)"/.test(os)||/\n?ID="?ol"?\n/.test(os)&&/VERSION_ID="9(?:\.[0-9]+)?"/.test(os)),'supported_host_required');
 const paths=setupPaths();assertFresh(paths);
 for(const name of new Set([...SETUP_UNITS,'picard-relay.service','picard-updater.service','picard-update-fetch.service','picard-owner-update.service','picard-updater-activity.service','picard-groq-replacement@.service'])){
  // systemd cannot show a bare template: probe a never-started instance so an
  // existing template is still detected without creating or starting a unit.
  const r=spawnSync('/usr/bin/systemctl',['show','--property=LoadState','--value',name.replace('@.service','@setup-probe.service')],{encoding:'utf8',timeout:5000});
  check([0,1,4].includes(r.status)&&r.stdout.trim()==='not-found','existing_service_refused');
 }
 for(const name of [RELAY_USER,'picard-relay-web','picard-relay'])accountAbsent(name);
 for(const port of [80,443,8787])await portUnused(port);
 // Other boot jobs can still be starting on an otherwise usable fresh host.
 // The actual relay/proxy readiness is checked after their own start operation.
 check(['starting','running','degraded'].includes(command('/usr/bin/systemctl',['show','--property=SystemState','--value'])),'running_systemd_required');
 const nodeBytes=checkedInput(args[0],150000000),webBytes=checkedInput(args[1],100000000);
 check(command(args[1],['version']).startsWith('v'+CADDY_VERSION+' '),'pinned_caddy_required');
 console.log('Verifying the official signing tool and the fixed signed Picard release.');
 const signed=await prepareSignedSetup(root);
 try{
 console.log('\nSet up Picard on this machine\nThe installer creates the relay and HTTPS services, protected owner sign-in and Free workspace.\nUpdate and Replace key are connected. Signed updates are checked every five minutes and on request.\nOracle Linux installs standard SELinux labeling tools if needed.\nNo cloud machine, firewall change or AI call is made.\n');
 const answers={hostname:await question('Relay hostname (for example picard.example.com): '),
  networkConfirmed:await question('Does that hostname point here, with TCP 80 and 443 allowed? Type yes: ')==='yes',
  freeConfirmed:await question('In Groq Console, is this project on the Free plan with no paid fallback? Type yes: ')==='yes',
  accountLabel:await question('A short name for that Groq project: '),organizationId:await question('Groq organization ID: '),projectId:await question('Groq project ID: '),
  keyProjectConfirmed:await question('Is the key from this same Free project? Type yes: ')==='yes',apiKey:await question('Groq key (hidden): ',{secret:true})};
 validateAnswers(answers);
 console.log(`\nReady to install https://${answers.hostname}\nSigned runtime: ${signed.manifest.version}. Update and Replace key enabled.\nFiles: ${paths.code}, ${paths.config}, ${paths.state} and protected host-support directories.\nEvery AI request still needs your exact approval.\n`);
 check(await question('Install on this fresh machine? Type install: ')==='install','setup_cancelled');
 assertFresh(paths);for(const name of [RELAY_USER,'picard-relay-web','picard-relay'])accountAbsent(name);
 // Reserve first, exclusively. Any partial attempt stays in place for inspection;
 // reruns cannot rotate its identity, overwrite records or reset a cost latch.
 mkdir(paths.code,0,0,0o755);exclusive(paths.code+'/INSTALL-INCOMPLETE','Fresh setup in progress. Preserve these files if setup stops.\n',0o600);
 let started=false;
 try{
  for(const name of [RELAY_USER,'picard-relay-web'])command('/usr/sbin/useradd',['--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',name]);
  const uid=Number(command('/usr/bin/id',['-u',RELAY_USER])),gid=Number(command('/usr/bin/id',['-g',RELAY_USER]));
  const webUid=Number(command('/usr/bin/id',['-u','picard-relay-web'])),webGid=Number(command('/usr/bin/id',['-g','picard-relay-web']));
  mkdir(paths.config,0,gid,0o750);mkdir(paths.config+'/credentials',0,gid,0o750);mkdir(paths.config+'/policy',0,gid,0o750);
  mkdir(paths.state,uid,gid,0o700);mkdir(paths.state+'/markers',uid,gid,0o700);mkdir(paths.state+'/owner-auth',uid,gid,0o700);mkdir(paths.web,webUid,webGid,0o700);
  mkdir(paths.code+'/bin',0,0,0o755);
  exclusive(paths.code+'/node',nodeBytes,0o555);exclusive(paths.code+'/bin/caddy',webBytes,0o555);
  installInitialRelease(paths,signed);
  const plan=buildSetup(answers,{paths});answers.apiKey='';writePrivateSetup(plan,{uid,gid});
  installHostSupport({paths,checkout:root,signed,uid,gid});
  const selinux=labelFreshSetupExecutables(paths);
  const template=fs.readFileSync(path.join(root,'deploy/Caddyfile.workspace.example'),'utf8');
  check(template.includes('relay.example.com {')&&!template.includes('admin off'),'proxy_template_invalid');
  exclusive(paths.code+'/Caddyfile','{\n    admin off\n}\n'+template.replace('relay.example.com {',plan.origin.slice(8)+' {'),0o444);
  // Adapt checks syntax without provisioning TLS/storage under the root account.
  command(paths.code+'/bin/caddy',['adapt','--config',paths.code+'/Caddyfile','--adapter','caddyfile']);
  const units=serviceUnits(paths);
  exclusive(paths.units+'/board-event-relay.service',units.relay,0o644);exclusive(paths.units+'/picard-relay-web.service',units.web,0o644);
  command('/usr/bin/systemctl',['daemon-reload']);started=true;
  command('/usr/bin/systemctl',['enable','--now',...SETUP_UNITS]);
  for(const unit of SETUP_UNITS)check(command('/usr/bin/systemctl',['is-active',unit])==='active','service_not_active');
  await healthyInstalledRuntime(paths,signed.release);
  command('/usr/bin/systemctl',['start','picard-updater-activity.service']);
  exclusive(paths.code+'/installation.json',JSON.stringify({v:1,kind:'signed-source-install',installedAt:new Date().toISOString(),node:NODE_VERSION,caddy:CADDY_VERSION,version:signed.manifest.version,releaseHash:signed.release,sourceCommit:signed.manifest.sourceCommit,updaterEnrolled:true,keyReplacementEnrolled:true,selinux,trustSha256:signed.trustSha256,files:signed.files.map(({path:file,bytes})=>({file,sha256:hash(bytes)}))},null,2)+'\n',0o444);
  fs.unlinkSync(paths.code+'/INSTALL-INCOMPLETE');
  console.log(`\nInstalled. Open ${plan.origin} to create your owner sign-in.\nYour one-hour setup code is in ${paths.config}/first-sign-in.txt.\nRead it privately with: sudo cat ${paths.config}/first-sign-in.txt\nThen choose New request. Update and Replace key are connected.\nGuide: https://github.com/bmartynowicz/picard-relay/blob/main/docs/SETUP.md\n`);
  try{const r=await fetch(plan.origin+'/auth/state',{redirect:'error',signal:AbortSignal.timeout(15000)});check(r.status===200,'https_not_ready');await r.body?.cancel();console.log('Public HTTPS responds. No AI request was sent.');}
  catch{console.log('Public HTTPS is not confirmed yet. Check DNS and inbound TCP 80/443, then open the address. Do not bypass certificate warnings or rerun setup.');}
 }catch(e){
  if(started){spawnSync('/usr/bin/systemctl',['disable','--now',...SETUP_UNITS],{timeout:30000,stdio:'ignore'});}
  console.error('Setup stopped. Partial files and identities were preserved; services started by this attempt were stopped. Do not delete state or rerun to reset it. See docs/SETUP.md.');throw e;
 }
 }finally{await signed.cleanup();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('Picard setup: '+(/^[a-z0-9_]+$/.test(e.message)?e.message:'setup_failed'));process.exitCode=1;});
