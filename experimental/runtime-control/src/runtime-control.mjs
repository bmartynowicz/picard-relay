import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {lstatSync,realpathSync,chmodSync,unlinkSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,basename,isAbsolute,resolve} from 'node:path';
const STATES=new Set(['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain']);
export function physicalReleaseIdentity(moduleUrl=import.meta.url,expected=''){
 const file=realpathSync(fileURLToPath(moduleUrl)),src=dirname(file),releaseDir=dirname(src),actual=basename(releaseDir);
 if(basename(src)!=='src'||basename(dirname(releaseDir))!=='releases'||!/^[a-f0-9]{64}$/.test(actual))return {release:'unversioned-flat',updateReady:false};
 if(actual!==expected)throw Error('control_release_mismatch');
 const immutable=(path,kind)=>{const s=lstatSync(path);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o222)!==0||(kind==='file'?!s.isFile():!s.isDirectory()))throw Error('release_ownership_invalid');return s;};
 immutable(releaseDir,'dir');immutable(src,'dir');const manifestPath=releaseDir+'/manifest.json';const ms=immutable(manifestPath,'file');if(ms.size>16384)throw Error('release_manifest_invalid');
 const raw=readFileSync(manifestPath),hash=bytes=>createHash('sha256').update(bytes).digest('hex');if(hash(raw)!==actual)throw Error('release_manifest_digest_mismatch');
 const manifest=JSON.parse(raw);if(manifest.format!==1||manifest.product!=='picard-relay'||manifest.nodeMajor!==24||manifest.stateSchema!==1||manifest.migration!=='none'||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>32)throw Error('release_manifest_invalid');
 const seen=new Set();for(const spec of manifest.files){if(!/^src\/[a-z][a-z0-9-]*\.mjs$/.test(spec.path)||seen.has(spec.path)||!Number.isSafeInteger(spec.bytes)||spec.bytes<0||spec.bytes>262144||!/^[a-f0-9]{64}$/.test(spec.sha256))throw Error('release_manifest_invalid');seen.add(spec.path);const path=releaseDir+'/'+spec.path;const st=immutable(path,'file');if(st.size!==spec.bytes||hash(readFileSync(path))!==spec.sha256)throw Error('release_source_mismatch');}
 const required=['adapters','dispatcher','groq-adapter','groq-once-adapter','https-fetch','oracle-service','protocol','receiver','relay-store','selected-assistant','runtime-control'];
 if(required.some(name=>!seen.has('src/'+name+'.mjs'))||readdirSync(src).some(name=>!seen.has('src/'+name)))throw Error('release_files_mismatch');
 return {release:actual,updateReady:true};
}
export function createRuntimeControl({socketPath='',releaseHash='',stats=()=>[],providerReady=()=>false,resultRecoveryReady=()=>false,serviceReady=()=>false}={}){
 const identity=socketPath||releaseHash?physicalReleaseIdentity(import.meta.url,releaseHash):{release:'control-disabled',updateReady:false};
 let draining=false,busy=false,server=null,owned=false,socketInode=null;
 const sockets=new Set();
 const health=()=>{const ledgerStateCounts=Object.fromEntries(stats().filter(r=>STATES.has(r.state)&&Number.isSafeInteger(r.count)&&r.count>=0).map(r=>[r.state,r.count]));const unresolvedInvoking=ledgerStateCounts.invoking??0;return {v:1,protocolVersion:1,release:identity.release,releaseHash:identity.release,updateReady:identity.updateReady,pid:process.pid,serviceReady:serviceReady()===true,resultRecoveryReady:resultRecoveryReady()===true,providerReady:providerReady()===true,accepting:!draining&&providerReady()===true,acceptingNewWork:!draining&&providerReady()===true,busy,draining,drained:draining&&!busy&&unresolvedInvoking===0,unresolvedInvoking,ledgerStateCounts};};
 const drain=()=>{draining=true;return health();};
 async function start(){
  if(!socketPath&&!releaseHash)return;
  if(!/^[a-f0-9]{64}$/.test(releaseHash)||!isAbsolute(socketPath)||resolve(socketPath)!==socketPath)throw Error('control_configuration_invalid');
  const dir=dirname(socketPath),s=lstatSync(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||s.uid!==process.getuid()||realpathSync(dir)!==dir)throw Error('control_directory_invalid');
  try{lstatSync(socketPath);throw Error('control_socket_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  server=createServer(sock=>{
   sockets.add(sock);sock.once('close',()=>sockets.delete(sock));sock.on('error',()=>{});sock.setTimeout(2000,()=>sock.destroy());let data='',done=false;
   sock.on('data',chunk=>{if(done)return;data+=chunk.toString('utf8');if(Buffer.byteLength(data)>256){done=true;sock.end('{"v":1,"error":"invalid_command"}\n');return;}if(!data.includes('\n'))return;done=true;
    try{const parsed=JSON.parse(data.trim());if(Object.keys(parsed).length!==2||parsed.v!==1||!['health','drain'].includes(parsed.action))throw Error();sock.end(JSON.stringify(parsed.action==='drain'?drain():health())+'\n');}
    catch{sock.end('{"v":1,"error":"invalid_command"}\n');}
   });
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(socketPath,()=>{try{owned=true;chmodSync(socketPath,0o600);socketInode=lstatSync(socketPath).ino;yes();}catch(e){no(e);}});});
 }
 async function close(){drain();for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));if(owned){try{const current=lstatSync(socketPath);if(!current.isSocket()||current.ino!==socketInode)throw Error('control_socket_replaced');unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}owned=false;}}
 return {start,close,health,drain,get accepting(){return !draining;},get busy(){return busy;},tryBegin(){if(draining||busy)return false;busy=true;return true;},finish(){busy=false;}};
}
