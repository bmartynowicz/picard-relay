import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {setupPaths,assertFresh,validateAnswers,buildSetup,writePrivateSetup,serviceUnits,hash,NODE_VERSION,CADDY_VERSION} from './setup-linux-core.mjs';

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
export async function main(args=process.argv.slice(2)){
 if(args.includes('--help')){console.log('Fresh Linux setup: sudo bash scripts/setup-linux.sh\nRequires an existing systemd Linux host, a hostname pointing to it, inbound TCP 80/443, and an owner-verified Groq Free key. Existing installs are refused. No provider call is made.');return;}
 check(args.length===2,'use_setup_linux_sh');
 check(process.platform==='linux'&&process.getuid()===0&&process.stdin.isTTY&&process.stdout.isTTY,'root_private_terminal_required');
 check(process.versions.node===NODE_VERSION,'pinned_node_required');
 check(fs.existsSync('/run/systemd/system'),'systemd_required');
 const os=fs.readFileSync('/etc/os-release','utf8');
 check(/\n?ID=(?:ubuntu|"?ol"?)\n/.test(os)&&(/VERSION_ID="(?:22\.04|24\.04)"/.test(os)||/\n?ID="?ol"?\n/.test(os)&&/VERSION_ID="9(?:\.[0-9]+)?"/.test(os)),'supported_host_required');
 const paths=setupPaths();assertFresh(paths);
 for(const name of ['picard-relay','picard-relay-web']){
  const r=spawnSync('/usr/bin/systemctl',['show','--property=LoadState','--value',name+'.service'],{encoding:'utf8',timeout:5000});
  check([0,1,4].includes(r.status)&&r.stdout.trim()==='not-found','existing_service_refused');
 }
 for(const name of ['picard-relay','picard-relay-web'])accountAbsent(name);
 for(const port of [80,443,8787])await portUnused(port);
 // Other boot jobs can still be starting on an otherwise usable fresh host.
 // The actual relay/proxy readiness is checked after their own start operation.
 check(['starting','running','degraded'].includes(command('/usr/bin/systemctl',['show','--property=SystemState','--value'])),'running_systemd_required');
 const nodeBytes=checkedInput(args[0],150000000),webBytes=checkedInput(args[1],100000000);
 check(command(args[1],['version']).startsWith('v'+CADDY_VERSION+' '),'pinned_caddy_required');
 const allowed=JSON.parse(fs.readFileSync(path.join(root,'experimental/updater/policy.example.json'),'utf8')).allowedFiles;
 check(allowed.length===20&&new Set(allowed).size===20&&allowed.every(v=>/^src\/[a-z0-9-]+\.mjs$/.test(v)),'runtime_allowlist_invalid');
 const sources=allowed.map(file=>({file,bytes:checkedInput(path.join(root,'experimental/runtime-control',file),262144)}));
 console.log('\nSet up Picard on this machine\nThe installer creates two small services, private credentials and a durable workspace.\nIt does not provision a machine, change your firewall, call AI, or enable the updater.\n');
 const answers={hostname:await question('Relay hostname (for example picard.example.com): '),
  networkConfirmed:await question('Does that hostname point here, with TCP 80 and 443 allowed? Type yes: ')==='yes',
  freeConfirmed:await question('In Groq Console, is this project on the Free plan with no paid fallback? Type yes: ')==='yes',
  accountLabel:await question('A short name for that Groq project: '),organizationId:await question('Groq organization ID: '),projectId:await question('Groq project ID: '),
  keyProjectConfirmed:await question('Is the key from this same Free project? Type yes: ')==='yes',apiKey:await question('Groq key (hidden): ',{secret:true})};
 validateAnswers(answers);
 console.log(`\nReady to install https://${answers.hostname}\nFiles: /opt/picard-relay, /etc/picard-relay, /var/lib/picard-relay and /var/lib/picard-relay-web\nServices: picard-relay and picard-relay-web. Every AI request still needs your exact approval.\n`);
 check(await question('Install on this fresh machine? Type install: ')==='install','setup_cancelled');
 assertFresh(paths);for(const name of ['picard-relay','picard-relay-web'])accountAbsent(name);
 // Reserve first, exclusively. Any partial attempt stays in place for inspection;
 // reruns cannot rotate its identity, overwrite records or reset a cost latch.
 mkdir(paths.code,0,0,0o755);exclusive(paths.code+'/INSTALL-INCOMPLETE','Fresh setup in progress. Preserve these files if setup stops.\n',0o600);
 let started=false;
 try{
  for(const name of ['picard-relay','picard-relay-web'])command('/usr/sbin/useradd',['--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',name]);
  const uid=Number(command('/usr/bin/id',['-u','picard-relay'])),gid=Number(command('/usr/bin/id',['-g','picard-relay']));
  const webUid=Number(command('/usr/bin/id',['-u','picard-relay-web'])),webGid=Number(command('/usr/bin/id',['-g','picard-relay-web']));
  mkdir(paths.config,0,gid,0o750);mkdir(paths.config+'/credentials',0,gid,0o750);mkdir(paths.config+'/policy',0,gid,0o750);
  mkdir(paths.state,uid,gid,0o700);mkdir(paths.state+'/markers',uid,gid,0o700);mkdir(paths.state+'/owner-auth',uid,gid,0o700);mkdir(paths.web,webUid,webGid,0o700);
  mkdir(paths.code+'/bin',0,0,0o755);mkdir(paths.code+'/src',0,0,0o755);
  exclusive(paths.code+'/bin/node',nodeBytes,0o555);exclusive(paths.code+'/bin/caddy',webBytes,0o555);
  for(const {file,bytes} of sources)exclusive(paths.code+'/'+file,bytes,0o444);
  const plan=buildSetup(answers,{paths});answers.apiKey='';writePrivateSetup(plan,{uid,gid});
  const template=fs.readFileSync(path.join(root,'deploy/Caddyfile.workspace.example'),'utf8');
  check(template.includes('relay.example.com {')&&!template.includes('admin off'),'proxy_template_invalid');
  exclusive(paths.code+'/Caddyfile','{\n    admin off\n}\n'+template.replace('relay.example.com {',plan.origin.slice(8)+' {'),0o444);
  // Adapt checks syntax without provisioning TLS/storage under the root account.
  command(paths.code+'/bin/caddy',['adapt','--config',paths.code+'/Caddyfile','--adapter','caddyfile']);
  const units=serviceUnits(paths);
  exclusive(paths.units+'/picard-relay.service',units.relay,0o644);exclusive(paths.units+'/picard-relay-web.service',units.web,0o644);
  command('/usr/bin/systemctl',['daemon-reload']);started=true;
  command('/usr/bin/systemctl',['enable','--now','picard-relay.service','picard-relay-web.service']);
  for(const unit of ['picard-relay','picard-relay-web'])check(command('/usr/bin/systemctl',['is-active',unit])==='active','service_not_active');
  exclusive(paths.code+'/installation.json',JSON.stringify({v:1,kind:'reviewed-source-install',installedAt:new Date().toISOString(),node:NODE_VERSION,caddy:CADDY_VERSION,updaterEnrolled:false,files:sources.map(({file,bytes})=>({file,sha256:hash(bytes)}))},null,2)+'\n',0o444);
  fs.unlinkSync(paths.code+'/INSTALL-INCOMPLETE');
  console.log(`\nInstalled. Open ${plan.origin} to create your owner sign-in.\nYour one-hour setup code is in /etc/picard-relay/first-sign-in.txt.\nRead it privately with: sudo cat /etc/picard-relay/first-sign-in.txt\nThen choose New request. Guide: https://github.com/bmartynowicz/picard-relay/blob/main/docs/SETUP.md\n`);
  try{const r=await fetch(plan.origin+'/auth/state',{redirect:'error',signal:AbortSignal.timeout(15000)});check(r.status===200,'https_not_ready');await r.body?.cancel();console.log('Public HTTPS responds. No AI request was sent.');}
  catch{console.log('Public HTTPS is not confirmed yet. Check DNS and inbound TCP 80/443, then open the address. Do not bypass certificate warnings or rerun setup.');}
 }catch(e){
  if(started){spawnSync('/usr/bin/systemctl',['disable','--now','picard-relay.service','picard-relay-web.service'],{timeout:30000,stdio:'ignore'});}
  console.error('Setup stopped. Partial files and identities were preserved; services started by this attempt were stopped. Do not delete state or rerun to reset it. See docs/SETUP.md.');throw e;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('Picard setup: '+(/^[a-z0-9_]+$/.test(e.message)?e.message:'setup_failed'));process.exitCode=1;});
