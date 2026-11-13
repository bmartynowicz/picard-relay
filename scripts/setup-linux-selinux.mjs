// Fresh-install executable labels only. No permissive domains, policy modules,
// network booleans, existing-host migration or global enforcement changes.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

export function labelFreshSetupExecutables(paths){
 if(!fs.existsSync('/sys/fs/selinux/enforce'))return {enabled:false};
 if(process.getuid?.()!==0||paths.code!=='/usr/local/lib/board-event-relay')throw Error('fixed_root_selinux_setup_required');
 const env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'};
 const run=(exe,args,timeout=30000)=>execFileSync(exe,args,{env,timeout,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
 if(!fs.existsSync('/usr/sbin/semanage')){
  // A fresh Oracle host may not have the persistent labeling management CLI.
  // Use only its existing signed OS repositories, after owner confirmation.
  try{run('/usr/bin/dnf',['-q','-y','install','policycoreutils-python-utils'],180000);}
  catch{throw Error('selinux_management_tools_install_failed');}
 }
 const executables=[paths.code+'/node',paths.code+'/bin/caddy'];
 for(const file of executables){
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||s.nlink!==1||(s.mode&0o022)||fs.realpathSync(file)!==file)throw Error('unsafe_setup_executable');
  // bin_t is the distribution's ordinary custom-service executable type.
  // Leaving executables as lib_t keeps these services in systemd's init_t.
  // Persist only these two exact rules, so restorecon does not undo the fix.
  const exact=file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try{run('/usr/sbin/semanage',['fcontext','-a','-t','bin_t',exact]);run('/usr/sbin/restorecon',['--',file]);run('/usr/sbin/matchpathcon',['-V',file]);}
  catch{throw Error('selinux_executable_label_failed');}
 }
 return {enabled:true,executableType:'bin_t',servicePolicy:'distribution-default-custom-service',enforcementChanged:false};
}
