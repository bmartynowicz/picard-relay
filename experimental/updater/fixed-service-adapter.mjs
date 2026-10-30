// Preparation only: not wired into updater.mjs, no installation or activation.
import {connect} from 'node:net';
import {lstat,readlink,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const UNIT='board-event-relay.service';
const ROOT='/usr/local/lib/board-event-relay';
const SOCKET='/var/lib/board-event-relay/control.sock';
const SYS='/usr/bin/systemctl';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fail(code){throw Error(code);}
function targetHash(target){if(!/^releases\/[a-f0-9]{64}$/.test(target))fail('invalid_release_target');return target.slice(9);}
export function checkHealth(h,{release,pid,drained=false}={}){
 if(!h||h.v!==1||h.protocolVersion!==1||h.releaseHash!==release||h.updateReady!==true||h.serviceReady!==true||h.resultRecoveryReady!==true||h.pid!==pid||!Number.isSafeInteger(pid)||pid<1)return false;
 if(drained&&(h.drained!==true||h.draining!==true||h.busy!==false||h.accepting!==false||h.acceptingNewWork!==false||h.unresolvedInvoking!==0))return false;
 return true; // providerReady may be false for an intentionally spent/revoked allowance.
}
async function fixedCommand(action){
 const args=action==='pid'?['show',UNIT,'--property=MainPID','--value']:action==='state'?['show',UNIT,'--property=ActiveState','--value']:['--no-ask-password',action,UNIT];
 if(!['pid','state','start','stop'].includes(action))fail('command_not_allowed');
 const {stdout}=await exec(SYS,args,{timeout:60000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LANG:'C'},windowsHide:true});return stdout.trim();
}
async function socketCommand(action){
 if(!['health','drain'].includes(action))fail('control_not_allowed');
 const dir=await lstat('/var/lib/board-event-relay'),sock=await lstat(SOCKET);
 if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0||await realpath('/var/lib/board-event-relay')!=='/var/lib/board-event-relay'||!sock.isSocket()||sock.isSymbolicLink()||(sock.mode&0o777)!==0o600||sock.uid!==dir.uid)fail('unsafe_control_socket');
 return new Promise((resolve,reject)=>{const s=connect(SOCKET);let bytes=0,chunks=[],done=false;const finish=(err,value)=>{if(done)return;done=true;s.destroy();err?reject(err):resolve(value);};s.setTimeout(2000,()=>finish(Error('control_timeout')));s.on('error',()=>finish(Error('control_unavailable')));s.on('connect',()=>s.write(JSON.stringify({v:1,action})+'\n'));s.on('data',b=>{bytes+=b.length;if(bytes>4096){finish(Error('control_oversized'));return;}chunks.push(b);const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes('\n')){try{finish(null,JSON.parse(raw.trim()));}catch{finish(Error('control_invalid'));}}});s.on('end',()=>{if(!done)finish(Error('control_incomplete'));});});
}
async function fixedCurrent(){const link=await lstat(ROOT+'/current');if(!link.isSymbolicLink()||link.uid!==0)fail('unsafe_current');const target=await readlink(ROOT+'/current');targetHash(target);return target;}
// Dependency seam is explicit local testing only. Production uses fixed commands/paths.
export function createOfflineServiceAdapter(deps){return buildAdapter(deps,'offline-test');}
export function createPreparedServiceAdapter(){return buildAdapter({command:fixedCommand,control:socketCommand,current:fixedCurrent,sleep,now:Date.now},'production-fixed-v1');}
function buildAdapter(d,kind){
 let expected=null;
 const pid=async()=>{const s=await d.command('pid');if(!/^[1-9][0-9]*$/.test(s))fail('service_pid_invalid');return Number(s);};
 const quiesce=async()=>{
  const release=targetHash(await d.current()),originalPid=await pid();
  const before=await d.control('health');if(!checkHealth(before,{release,pid:originalPid}))fail('pre_drain_health_failed');
  await d.control('drain');const deadline=d.now()+45000;
  while(d.now()<deadline){const h=await d.control('health');if(await pid()!==originalPid)fail('service_instance_changed');if(checkHealth(h,{release,pid:originalPid,drained:true})){
    await d.command('stop');const state=await d.command('state');if(state!=='inactive')fail('stop_not_confirmed');return true;
   }await d.sleep(250);}
  fail('drain_timeout_no_force_stop');
 };
 return {kind,quiesce,async stop(){if(await d.command('state')==='inactive')return true;return quiesce();},
  async start(target){expected=targetHash(target);if(await d.current()!==target)fail('pointer_changed');if(await d.command('state')!=='inactive')fail('service_not_stopped');await d.command('start');},
  async health({release,noProviderCalls}){if(noProviderCalls!==true||!expected||(release&&release!==expected))return false;const deadline=d.now()+10000;while(d.now()<deadline){try{if(checkHealth(await d.control('health'),{release:expected,pid:await pid()}))return true;}catch{}await d.sleep(250);}return false;}
 };
}
