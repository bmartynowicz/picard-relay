import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

const cookiePattern=/^__Host-PicardSession=[A-Za-z0-9_-]{43}$/;
export function validCachedSession(value,origin,now=Date.now()){
 return value?.v===1&&value.origin===origin&&cookiePattern.test(value.cookie??'')
  &&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&value.expiresAt<=now+28_800_000;
}
export async function dpapi(action,data,entropy='PicardRelay CLI owner session v1'){
 const script=`$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; $b=[Convert]::FromBase64String($r.data); $e=[Text.Encoding]::UTF8.GetBytes($r.entropy); if($r.action -eq 'protect'){$v=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)} elseif($r.action -eq 'unprotect'){$v=[Security.Cryptography.ProtectedData]::Unprotect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)} else {throw 'invalid action'}; [Console]::Out.Write([Convert]::ToBase64String($v)) } catch { [Console]::Error.Write('secure_session_storage_failed'); exit 1 }`;
 const executable=join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 return await new Promise((resolve,reject)=>{
  const child=spawn(executable,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let size=0;const timer=setTimeout(()=>child.kill(),10000);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32768)child.kill();else chunks.push(chunk);});
  child.stderr.resume();child.once('error',()=>{clearTimeout(timer);reject(Error('secure_session_storage_failed'));});
  child.once('close',code=>{clearTimeout(timer);const text=Buffer.concat(chunks).toString().trim();
   if(code!==0||size>32768||!/^[A-Za-z0-9+/]+=*$/.test(text))reject(Error('secure_session_storage_failed'));
   else resolve(Buffer.from(text,'base64'));
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action,entropy,data:Buffer.from(data).toString('base64')}));
 });
}
export function createOwnerSessionCache({directory=join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'PicardRelay','OwnerCLI'),platform=process.platform,now=Date.now}={}){
 const filename=origin=>join(directory,createHash('sha256').update(origin).digest('hex')+'.dpapi');
 const clear=async origin=>{if(platform==='win32')await rm(filename(origin),{force:true});};
 return {
  supported:platform==='win32',clear,
  async read(origin){
   if(platform!=='win32')return null;
   try{
    const encrypted=await readFile(filename(origin));if(encrypted.length>16384)throw Error('invalid_cache');
    const data=JSON.parse((await dpapi('unprotect',encrypted)).toString('utf8'));
    if(!validCachedSession(data,origin,now()))throw Error('invalid_cache');return data;
   }catch(error){if(error.code!=='ENOENT')await clear(origin);return null;}
  },
  async write(value){
   if(platform!=='win32')return false;
   if(!validCachedSession(value,value.origin,now()))throw Error('invalid_cached_session');
   const encrypted=await dpapi('protect',Buffer.from(JSON.stringify(value)));
   await mkdir(directory,{recursive:true,mode:0o700});
   const path=filename(value.origin),temp=path+'.'+process.pid+'.tmp';
   try{await writeFile(temp,encrypted,{flag:'wx',mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
   return true;
  }
 };
}
