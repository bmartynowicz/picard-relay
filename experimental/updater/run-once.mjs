// Fixed entrypoint: installation and policy enrollment are separate approvals.
import {access,writeFile} from 'node:fs/promises';
import {loadAdministratorPolicy,applyPreparedUpdate} from './updater.mjs';
import {pullSignedRelease} from './pull.mjs';
const HOLD='/var/lib/picard-updater/HOLD';
try{
 if(process.getuid()!==0)throw Error('administrator_required');
 let hold=false;try{await access(HOLD);hold=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(hold){console.log(JSON.stringify({state:'held'}));process.exit(0);}
 const policy=await loadAdministratorPolicy('/etc/picard-updater/policy.json',0);
 if(policy.enabled!==true){console.log(JSON.stringify({state:'disabled'}));process.exit(0);}
 if(policy.source!=='https://raw.githubusercontent.com/bmartynowicz/picard-relay/main/releases/stable.json'||policy.signatureMode!=='sigstore')throw Error('enrollment_mismatch');
 const packet=await pullSignedRelease(policy);const result=await applyPreparedUpdate({policy,...packet});console.log(JSON.stringify(result));
}catch(e){
 if(e.message==='replay_or_downgrade'){console.log(JSON.stringify({state:'no_new_release'}));process.exit(0);}
 // No task text, secrets, remote error payloads or shell output enters the checkpoint.
 const code=/^[a-z_]+$/.test(e.message)?e.message:'update_failed';
 await writeFile(HOLD,JSON.stringify({state:'held',code,at:new Date().toISOString()}),{mode:0o600,flag:'wx'}).catch(()=>{});
 console.error(JSON.stringify({state:'held',code}));process.exitCode=1;
}
