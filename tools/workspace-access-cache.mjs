import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,writeFile,rename,rm,lstat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {dpapi} from './owner-session-cache.mjs';

export const toolTokenPattern=/^pwt_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/;
export function validToolAccess(v,origin,at=Date.now()){
 return v?.v===1&&v.origin===origin&&toolTokenPattern.test(v.token??'')&&v.clientId===v.token.slice(4,40)
  &&['read','approved-work'].includes(v.mode)&&Number.isSafeInteger(v.expiresAt)&&v.expiresAt>at&&v.expiresAt<=at+2592000000;
}
// Use the real user profile rather than MSIX's per-process LOCALAPPDATA view.
export function createWorkspaceAccessCache({directory=process.platform==='win32'?join(homedir(),'AppData','Local','PicardRelay','ToolAccess'):join(homedir(),'.local','state','picard-relay','tool-access'),now=Date.now}={}){
 directory=resolve(directory);const windows=process.platform==='win32';
 const filename=origin=>join(directory,createHash('sha256').update(origin).digest('hex')+(windows?'.dpapi':'.json'));
 async function checkDirectory(){
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(directory)!==directory||!windows&&(stat.uid!==process.getuid()||(stat.mode&0o077)!==0))throw Error('tool_access_storage_failed');
 }
 return {
  async read(origin){
   let file;
   try{
    await checkDirectory();file=await open(filename(origin),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>16384||!windows&&(stat.uid!==process.getuid()||(stat.mode&0o077)!==0))throw Error();
    let bytes=await file.readFile();if(bytes.length>16384)throw Error();if(windows)bytes=await dpapi('unprotect',bytes,'PicardRelay tool access v1');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!validToolAccess(value,origin,now()))throw Error();return value;
   }catch(error){if(error.code==='ENOENT')return null;throw Error('tool_access_storage_failed');}finally{await file?.close();}
  },
  async write(value){
   if(!validToolAccess(value,value?.origin,now()))throw Error('invalid_tool_access');
   await mkdir(directory,{recursive:true,mode:0o700});await checkDirectory();
   let bytes=Buffer.from(JSON.stringify(value));if(windows)bytes=await dpapi('protect',bytes,'PicardRelay tool access v1');
   const target=filename(value.origin),temporary=target+'.'+randomUUID()+'.tmp';
   try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
  },
  async clear(origin){await checkDirectory();await rm(filename(origin),{force:true});}
 };
}
