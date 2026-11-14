// First boot only. Infrastructure contains a short-lived claim hash, never a
// Groq key or owner password. Existing owner auth is preserved during handoff.
import {createHash,randomBytes} from 'node:crypto';
import {buildSetup,setupPaths,validateAnswers} from './setup-linux-core.mjs';
export const BOOTSTRAP_ROOT='/var/lib/picard-first-run';
export const BOOTSTRAP_CODE='/usr/local/lib/picard-first-run';
export const BOOTSTRAP_CONFIG='/etc/picard-first-run';
export const digest=v=>createHash('sha256').update(v).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
export function validateBrowserSetupConfig(c){
 check(c&&Object.keys(c).sort().join(',')==='claimSha256,hostname,v'&&c.v===1&&/^[a-f0-9]{64}$/.test(c.claimSha256),'browser_setup_configuration_invalid');
 // Reserved localhost name supports a real HTTPS development/CI installation.
 // Oracle cloud-init never supplies it; public launches use their own IPv4.
 if(c.hostname==='picard.localhost')return c;
 check(/^picard-(?:[0-9]{1,3}-){3}[0-9]{1,3}\.sslip\.io$/.test(c.hostname),'browser_setup_hostname_invalid');
 const bytes=c.hostname.slice(7,-9).split('-').map(Number);
 check(bytes.length===4&&bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&bytes[0]>0&&bytes[0]<224&&![10,127].includes(bytes[0])&&!(bytes[0]===169&&bytes[1]===254)&&!(bytes[0]===172&&bytes[1]>=16&&bytes[1]<=31)&&!(bytes[0]===192&&bytes[1]===168)&&!(bytes[0]===100&&bytes[1]>=64&&bytes[1]<=127),'browser_setup_public_address_required');
 return c;
}
export function initialBrowserState(c,{now=Date.now(),random=randomBytes}={}){
 validateBrowserSetupConfig(c);
 const identity={ownerId:'owner-'+random(16).toString('hex'),keyId:'setup-'+random(16).toString('hex')};
 const auth={v:1,phase:'bootstrap',revision:0,lastSeenAt:now,rate:{windowStartedAt:now,attempts:0},bootstrap:{codeHash:c.claimSha256,createdAt:now,expiresAt:now+3600000}};
 return {identity,auth,origin:'https://'+c.hostname};
}
export function providerEnrollmentFiles(input,{hostname,identity,paths=setupPaths(),now=Date.now()}={}){
 check(input&&Object.keys(input).sort().join(',')==='accountLabel,apiKey,freeConfirmed,keyProjectConfirmed,organizationId,projectId,requestId,sessionToken,v'&&input.v===1&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId)&&/^[A-Za-z0-9_-]{43}$/.test(input.sessionToken),'browser_enrollment_invalid');
 const answers=validateAnswers({...input,hostname,networkConfirmed:true});
 const plan=buildSetup(answers,{paths,now,identity});
 // Both files already exist and belong to this installation. Never rotate the
 // HMAC or replace the password/session that was just created in the browser.
 const preserved=new Set([plan.env.BRIDGE_HMAC_SECRET_FILE,plan.env.BRIDGE_CONSOLE_AUTH_DIR+'/auth-state.json',paths.config+'/first-sign-in.txt']);
 return {...plan,privateFiles:plan.privateFiles.filter(f=>!preserved.has(f.file))};
}
export function bootstrapUnits(paths=setupPaths()){
 const hardening='NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nUMask=0077\n';
 return {
  'picard-first-run.service':`[Unit]\nDescription=Picard first-run setup\nAfter=network-online.target\nWants=network-online.target\nConditionPathExists=!${paths.config}/relay.env\n[Service]\nUser=board-event-relay\nGroup=board-event-relay\nExecStart=${paths.code}/node --jitless ${BOOTSTRAP_CODE}/scripts/serve-browser-setup.mjs\nReadWritePaths=${paths.state}/owner-auth ${BOOTSTRAP_ROOT}/inbox\nMemoryMax=96M\nTasksMax=16\n${hardening}[Install]\nWantedBy=multi-user.target\n`,
  'picard-first-run-activate.path':`[Unit]\nDescription=Watch one initial Groq connection\n[Path]\nPathExists=${BOOTSTRAP_ROOT}/inbox/request.json\nUnit=picard-first-run-activate.service\n[Install]\nWantedBy=multi-user.target\n`,
  'picard-first-run-activate.service':`[Unit]\nDescription=Connect Picard initial Free enrollment\nConflicts=picard-first-run.service\nAfter=picard-first-run.service\n[Service]\nType=oneshot\nExecStart=${paths.code}/node --jitless ${BOOTSTRAP_CODE}/scripts/activate-browser-setup.mjs\nTimeoutStartSec=60\nMemoryMax=128M\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=${paths.code} ${paths.config} ${paths.state} ${BOOTSTRAP_ROOT} /etc/systemd/system\n`
 };
}
