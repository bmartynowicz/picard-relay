import * as fs from 'node:fs';import path from 'node:path';import https from 'node:https';
import {TextDecoder} from 'node:util';
import {ManualClientError} from './manual-client.mjs';
const fail=code=>{throw new ManualClientError(code);};
const uid=()=>process.getuid?.();
function identity(s){return [s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');}
function canonicalPath(p){if(typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p||fs.realpathSync(p)!==p)fail('private_path_invalid');return p;}
export function readPrivateFile(file,{maxBytes=24576,owner=null}={}){
 canonicalPath(file);const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.nlink!==1n||(before.mode&0o777n)!==0o600n||before.size<1n||before.size>BigInt(maxBytes)||owner!==null&&before.uid!==BigInt(owner))fail('private_file_invalid');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const opened=fs.fstatSync(fd,{bigint:true});if(identity(opened)!==identity(before))fail('private_file_changed');const data=Buffer.alloc(maxBytes+1);const n=fs.readSync(fd,data,0,maxBytes+1,0);if(n!==Number(before.size)||identity(fs.fstatSync(fd,{bigint:true}))!==identity(before)||identity(fs.lstatSync(file,{bigint:true}))!==identity(before))fail('private_file_changed');try{return new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,n));}catch{fail('private_encoding_invalid');}}finally{fs.closeSync(fd);}
}
function directory(dir){canonicalPath(dir);const s=fs.lstatSync(dir);if(!s.isDirectory()||s.uid!==uid()||(s.mode&0o777)!==0o700)fail('private_directory_invalid');return s;}
function syncDir(dir){const fd=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function writePrivateNew(file,data){const dir=path.dirname(file);directory(dir);const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(dir);}
export function createPrivateJournal(dir){
 if(process.platform!=='linux')fail('linux_operator_required');
 if(!fs.existsSync(dir)){directory(path.dirname(dir));try{fs.mkdirSync(dir,{mode:0o700});syncDir(path.dirname(dir));}catch(e){if(e.code!=='EEXIST')throw e;}}directory(dir);
 const file=id=>{if(!/^[a-f0-9]{64}$/.test(id))fail('intent_invalid');return path.join(dir,id+'.intent.json');};
 function load(id){directory(dir);const p=file(id);let raw;try{raw=readPrivateFile(p,{maxBytes:32768,owner:uid()});}catch(e){if(e.code==='ENOENT')return null;throw e;}let v;try{v=JSON.parse(raw);}catch{fail('journal_invalid');}if(v?.v!==1||v.eventId!==id||!/^[a-f0-9]{64}$/.test(v.payloadHash??'')||v.intent?.payload?.eventId!==id||v.intent?.payload?.payloadHash!==v.payloadHash)fail('journal_invalid');return v;}
 return {load:async id=>load(id),reserve:async intent=>{const p=intent.payload,record={v:1,eventId:p.eventId,payloadHash:p.payloadHash,intent};try{writePrivateNew(file(p.eventId),JSON.stringify(record)+'\n');return {created:true,payloadHash:p.payloadHash};}catch(error){if(error.code!=='EEXIST')throw error;const old=load(p.eventId);return {created:false,payloadHash:old.payloadHash};}},record:async(id,value)=>{directory(dir);if(!load(id))fail('journal_invalid');const raw=JSON.stringify({v:1,observedAt:new Date().toISOString(),value});if(Buffer.byteLength(raw)>16384)fail('receipt_too_large');for(let n=0;n<64;n++){try{writePrivateNew(path.join(dir,id+'.receipt-'+String(n).padStart(2,'0')+'.json'),raw+'\n');return;}catch(e){if(e.code!=='EEXIST')throw e;}}fail('journal_receipt_capacity');}};
}
export function loadOperatorProfile(file,origin){
 if(process.platform!=='linux'||!Number.isSafeInteger(uid()))fail('linux_operator_required');
 const raw=readPrivateFile(file,{maxBytes:65536,owner:uid()}),wanted=new Set(['BRIDGE_ENABLED','BRIDGE_KEY_ID','BRIDGE_HMAC_SECRET_FILE','BRIDGE_OWNER_ID','BRIDGE_ASSISTANT_ID','BRIDGE_ALLOWED_TASK_ID','BRIDGE_CONSOLE_ORIGINS','GROQ_FREE_GATE_FILE','GROQ_ENABLED','GROQ_ONE_SHOT','BRIDGE_PROVIDER']);const env={};
 for(const line of raw.split(/\r?\n/)){if(!line||line.startsWith('#'))continue;const split=line.indexOf('=');if(split<1)continue;const name=line.slice(0,split);if(!wanted.has(name))continue;if(Object.hasOwn(env,name))fail('configuration_unavailable');let value=line.slice(split+1).trim();if(value.length>1&&value[0]===value.at(-1)&&['"',"'"].includes(value[0]))value=value.slice(1,-1);env[name]=value;}
 let origins,gate;try{origins=JSON.parse(env.BRIDGE_CONSOLE_ORIGINS);gate=JSON.parse(readPrivateFile(env.GROQ_FREE_GATE_FILE,{maxBytes:16384}));}catch{fail('configuration_unavailable');}
 if(env.BRIDGE_ENABLED!=='true'||env.BRIDGE_PROVIDER!=='groq'||env.GROQ_ENABLED!=='true'||env.GROQ_ONE_SHOT!=='true'||env.BRIDGE_ASSISTANT_ID!=='groq:openai/gpt-oss-20b'||!Array.isArray(origins)||origins.length>4||!origins.includes(origin))fail('configuration_unavailable');
 return {config:{origin,ownerId:env.BRIDGE_OWNER_ID,allowedTaskId:env.BRIDGE_ALLOWED_TASK_ID,assistantId:env.BRIDGE_ASSISTANT_ID,keyId:env.BRIDGE_KEY_ID,gate},readHmacSecret:()=>readPrivateFile(env.BRIDGE_HMAC_SECRET_FILE,{maxBytes:4096}).trim()};
}
// Injection is solely a deterministic test seam; the CLI uses native HTTPS.
export function createNativeRelayTransport(requestImpl=https.request){return async function transport(request){
 const url=new URL(request.url);if(url.protocol!=='https:'||url.pathname!=='/bridge/v1'||url.search||url.hash||url.username||url.password||request.method!=='POST'||request.redirect!=='manual'||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('transport_scope_invalid');
 if(request.signal.aborted)fail('response_unconfirmed');
 const body=Buffer.from(await request.text());if(body.length>24576)fail('request_too_large');
 return new Promise((resolve,reject)=>{let req;try{req=requestImpl(url,{method:'POST',rejectUnauthorized:true,headers:Object.fromEntries(request.headers),signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])},res=>{let n=0,parts=[],stopped=false;res.on('data',part=>{if(stopped)return;part=Buffer.from(part);n+=part.length;if(n>24576){stopped=true;parts=[];reject(new ManualClientError('response_too_large'));res.destroy();return;}parts.push(part);});res.on('error',()=>reject(new ManualClientError('response_unconfirmed')));res.on('aborted',()=>reject(new ManualClientError('response_unconfirmed')));res.on('end',()=>{if(stopped)return;try{resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:{'x-bridge-response':String(res.headers['x-bridge-response']??'')}}));}catch{reject(new ManualClientError('response_invalid'));}});});req.on('error',()=>reject(new ManualClientError('response_unconfirmed')));req.end(body);}catch{reject(new ManualClientError('response_unconfirmed'));}});
};}
export const nativeRelayTransport=createNativeRelayTransport();
