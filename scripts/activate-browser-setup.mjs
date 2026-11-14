// One finite initial enrollment. No shell input, provider call, retry or reset.
import fs from 'node:fs';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createOwnerAuth} from '../experimental/runtime-control/src/oracle-service.mjs';
import {checkHealth} from '../experimental/updater/fixed-service-adapter.mjs';
import {setupPaths,writePrivateSetup} from './setup-linux-core.mjs';
import {SETUP_UNITS} from './setup-linux-host.mjs';
import {BOOTSTRAP_CODE,BOOTSTRAP_ROOT,BOOTSTRAP_CONFIG,providerEnrollmentFiles,digest,validateBrowserSetupConfig} from './browser-setup-core.mjs';
const check=(v,c)=>{if(!v)throw Error(c);};
function command(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',timeout:30000,maxBuffer:16384,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});check(r.status===0,'activation_command_failed');return r.stdout.trim();}
export async function main(){
 check(process.platform==='linux'&&process.getuid()===0,'root_linux_required');
 const paths=setupPaths(),uid=Number(command('/usr/bin/id',['-u','board-event-relay'])),gid=Number(command('/usr/bin/id',['-g','board-event-relay']));
 const status=value=>{const temp=BOOTSTRAP_ROOT+'/.status-'+process.pid;fs.writeFileSync(temp,JSON.stringify({v:1,...value})+'\n',{mode:0o640,flag:'wx'});fs.chownSync(temp,0,gid);fs.chmodSync(temp,0o640);fs.renameSync(temp,BOOTSTRAP_ROOT+'/status.json');};
 const inputPath=BOOTSTRAP_ROOT+'/inbox/request.json',claim=BOOTSTRAP_ROOT+'/claimed-request.json';
 let raw,inputFd;
 try{
  // Remove the path trigger before any validation or fallible configuration
  // write. Never automatically replay an uncertain/partial initial enrollment.
  inputFd=fs.openSync(inputPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const state=fs.fstatSync(inputFd);check(state.isFile()&&state.uid===uid&&state.nlink===1&&(state.mode&0o777)===0o600&&state.size>0&&state.size<=4096,'private_request_required');
  if(fs.existsSync(claim)||fs.existsSync(BOOTSTRAP_ROOT+'/activation.json')){fs.renameSync(inputPath,BOOTSTRAP_ROOT+'/refused-request-'+Date.now()+'.json');throw Error('prior_activation_preserved');}
  fs.renameSync(inputPath,claim);
  const moved=fs.lstatSync(claim);check(moved.isFile()&&!moved.isSymbolicLink()&&moved.ino===state.ino&&moved.dev===state.dev&&moved.nlink===1,'request_changed');
  fs.fchownSync(inputFd,0,0);raw=fs.readFileSync(inputFd);check(raw.length===state.size&&raw.length<=4096,'request_changed');fs.closeSync(inputFd);inputFd=undefined;
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const config=validateBrowserSetupConfig(JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG+'/config.json','utf8'))),identity=JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG+'/identity.json','utf8'));
  const auth=createOwnerAuth({stateDir:paths.state+'/owner-auth',expectedUid:uid});
  check(await auth.authenticate(input.sessionToken,{fresh:true}),'recent_owner_sign_in_required');
  const plan=providerEnrollmentFiles(input,{hostname:config.hostname,identity});
  for(const file of [paths.config+'/relay.env',paths.state+'/relay.db',paths.state+'/STOP'])check(!fs.existsSync(file),'existing_work_refused');
  check(fs.readdirSync(paths.state+'/markers').length===0,'existing_markers_refused');
  const originalAuth=fs.readFileSync(paths.state+'/owner-auth/auth-state.json');
  const journal=fs.openSync(BOOTSTRAP_ROOT+'/activation.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(journal,JSON.stringify({v:1,requestId:input.requestId,inputSha256:digest(raw),startedAt:Date.now(),state:'consumed-no-replay'})+'\n');fs.fsyncSync(journal);}finally{fs.closeSync(journal);}
  status({state:'connecting'});writePrivateSetup(plan,{uid,gid});input.apiKey='';input.sessionToken='';
  const proxy='{\n admin off\n}\n'+fs.readFileSync(BOOTSTRAP_CODE+'/deploy/Caddyfile.workspace.example','utf8').replace('relay.example.com {',config.hostname+' {');
  const candidate=paths.code+'/Caddyfile.enrollment';fs.writeFileSync(candidate,proxy,{flag:'wx',mode:0o444});fs.chmodSync(candidate,0o444);
  command(paths.code+'/bin/caddy',['adapt','--config',candidate,'--adapter','caddyfile']);fs.renameSync(candidate,paths.code+'/Caddyfile');
  command('/usr/bin/systemctl',['enable',...SETUP_UNITS]);command('/usr/bin/systemctl',['start','board-event-relay.service','picard-groq-replacement.socket','picard-owner-update.path','picard-updater.timer','picard-updater-activity.timer']);
  let ready=false;
  for(let i=0;i<40;i++){
   try{
    const pid=Number(command('/usr/bin/systemctl',['show','board-event-relay.service','--property=MainPID','--value']));
    const h=await new Promise((resolve,reject)=>{const s=net.createConnection(paths.state+'/control.sock');let out='';s.setTimeout(1000,()=>s.destroy(Error('health_timeout')));s.on('error',reject);s.on('connect',()=>s.write('{"v":1,"action":"health"}\n'));s.on('data',c=>{out+=c.toString();if(out.length>4096)s.destroy(Error('health_too_large'));else if(out.includes('\n')){s.destroy();try{resolve(JSON.parse(out));}catch{reject(Error('health_invalid'));}}});s.on('end',()=>reject(Error('health_incomplete')));});
    const release=fs.readlinkSync(paths.code+'/current').slice(9);if(checkHealth(h,{release,pid})){ready=true;break;}
   }catch{}await new Promise(r=>setTimeout(r,500));
  }
  check(ready,'runtime_not_ready');check(fs.readFileSync(paths.state+'/owner-auth/auth-state.json').equals(originalAuth),'owner_state_changed');
  command('/usr/bin/systemctl',['restart','picard-relay-web.service']);
  command('/usr/bin/systemctl',['disable','--now','picard-first-run-activate.path']);command('/usr/bin/systemctl',['disable','picard-first-run.service']);
  const installation=JSON.parse(fs.readFileSync(paths.code+'/installation.json','utf8'));
  const finished=paths.code+'/installation.complete';fs.writeFileSync(finished,JSON.stringify({...installation,updaterEnrolled:true,keyReplacementEnrolled:true,firstRunCompletedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o444});fs.chmodSync(finished,0o444);fs.renameSync(finished,paths.code+'/installation.json');
  status({state:'ready'});fs.unlinkSync(claim);
  console.log(JSON.stringify({state:'browser_setup_complete',providerCalls:0,ownerPreserved:true}));
 }catch(e){try{status({state:'failed'});}catch{}spawnSync('/usr/bin/systemctl',['disable','--now','picard-first-run-activate.path','board-event-relay.service'],{timeout:30000,stdio:'ignore'});console.error(JSON.stringify({state:'browser_setup_stopped',code:/^[a-z0-9_]+$/.test(e.message)?e.message:'activation_failed'}));process.exitCode=1;}
 finally{if(inputFd!==undefined)fs.closeSync(inputFd);raw?.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
