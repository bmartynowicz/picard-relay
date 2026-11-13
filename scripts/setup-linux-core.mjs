// Fresh-host setup only. No provider calls, approval renewal or existing-state migration.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';
import {createBootstrapState} from '../experimental/runtime-control/src/oracle-service.mjs';
import {admissionConfigurationDigest} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {validCostEnrollmentMetadata} from '../experimental/runtime-control/src/admission-enrollment.mjs';
import {validateCatalogueSync} from '../experimental/runtime-control/src/admission-plan.mjs';

export const NODE_VERSION='24.22.1', CADDY_VERSION='2.11.9';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
const json=value=>canonical(value)+'\n';
const runtime='groq:openai/gpt-oss-20b';
export function setupPaths(root=''){
 requireThat(root===''||/^\/[A-Za-z0-9_./-]+$/.test(root)&&path.resolve(root)===root,'invalid_setup_root');
 return {code:root+'/usr/local/lib/board-event-relay',config:root+'/etc/board-event-relay',state:root+'/var/lib/board-event-relay',web:root+'/var/lib/picard-relay-web',units:root+'/etc/systemd/system',
  updater:root+'/usr/local/lib/picard-updater',updaterConfig:root+'/etc/picard-updater',updaterState:root+'/var/lib/picard-updater',inbox:root+'/var/lib/picard-updater-inbox',updateStatus:root+'/var/lib/picard-updater-status',updateQueue:root+'/var/lib/picard-update-requests',keySupport:root+'/usr/local/lib/picard-groq-replacement',keyStatus:root+'/var/lib/picard-groq-replacement',
  legacy:[root+'/opt/picard-relay',root+'/etc/picard-relay',root+'/var/lib/picard-relay',root+'/etc/systemd/system/picard-relay.service']};
}
export function validateAnswers(a){
 requireThat(typeof a.hostname==='string'&&a.hostname.length<=253&&a.hostname===a.hostname.toLowerCase()
  &&a.hostname.includes('.')&&!a.hostname.endsWith('.invalid')&&!/^\d+\.\d+\.\d+\.\d+$/.test(a.hostname)
  &&a.hostname.split('.').every(v=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v)),'invalid_public_hostname');
 for(const key of ['accountLabel','organizationId','projectId'])requireThat(typeof a[key]==='string'&&/^[\x20-\x7e]{1,160}$/.test(a[key])&&a[key].trim()===a[key],'invalid_project_identity');
 requireThat(a.freeConfirmed===true&&a.keyProjectConfirmed===true&&a.networkConfirmed===true,'owner_confirmation_required');
 requireThat(typeof a.apiKey==='string'&&/^gsk_[A-Za-z0-9_-]{20,508}$/.test(a.apiKey),'invalid_groq_key');
 return a;
}
export function buildSetup(a,{paths=setupPaths(),now=Date.now(),random=randomBytes}={}){
 validateAnswers(a);requireThat(Number.isSafeInteger(now)&&now>=0,'invalid_setup_time');
 const ownerId='owner-'+random(16).toString('hex'),taskId='owner-workspace',keyId='setup-'+random(16).toString('hex');
 const keySha256=hash(a.apiKey),code=random(32).toString('base64url');
 const costEnrollment={v:1,provider:'groq',model:'openai/gpt-oss-20b',owner:ownerId,accountLabel:a.accountLabel,
  organizationId:a.organizationId,projectId:a.projectId,keySha256,accountPlan:'Free',noPaidFallback:true,
  verifiedAt:now,enrolledAt:now,evidenceRef:'owner-confirmed-groq-console-Free-plan-at-setup',keyAssociationEvidenceRef:'owner-confirmed-key-belongs-to-recorded-Free-project-at-setup'};
 requireThat(validCostEnrollmentMetadata(costEnrollment),'invalid_cost_enrollment');
 const enrollmentId=hash(canonical(costEnrollment)),markers=paths.state+'/markers';
 const baseline={v:1,kind:'PICARD_LEGACY_BASELINE_V1',enrollmentId,ownerId,taskId,assistantId:runtime,observedAt:now,rows:[]};
 const config={ownerId,allowedTaskId:taskId,assistantId:runtime,keyId,consoleOrigins:['https://'+a.hostname],admissionSignedBridgeEnabled:true,admissionReusableBoardEnabled:true,
  admissionLegacyBaselineFile:paths.config+'/policy/legacy-baseline.json',admissionLegacyBaselineSha256:hash(json(baseline))};
 const configurationSha256=admissionConfigurationDigest({config,enrollmentId,keySha256,markerDirectory:markers});
 const catalogue={v:1,kind:'FINITE_ADMISSION_PROTOTYPE_ONLY',ownerId,taskId,assistantId:runtime,enrollmentId,
  notBefore:now,expiresAt:now+86400000,maxRequestLifetimeMs:3600000,entries:[]};
 validateCatalogueSync(catalogue);
 const env={BRIDGE_ENABLED:'true',BRIDGE_PROVIDER:'groq',BRIDGE_OWNER_ID:ownerId,BRIDGE_ALLOWED_TASK_ID:taskId,BRIDGE_KEY_ID:keyId,
  BRIDGE_ASSISTANT_ID:runtime,BRIDGE_HMAC_SECRET_FILE:paths.config+'/credentials/hmac',BRIDGE_DB_PATH:paths.state+'/relay.db',
  BRIDGE_PORT:'8787',BRIDGE_STOP_PATH:paths.state+'/STOP',BRIDGE_CONSOLE_ENABLED:'true',BRIDGE_CONSOLE_AUTH_DIR:paths.state+'/owner-auth',
  BRIDGE_CONSOLE_ORIGINS:JSON.stringify(config.consoleOrigins),BRIDGE_WORKSPACE_ENABLED:'true',BRIDGE_ADMISSION_ENABLED:'true',
  BRIDGE_ADMISSION_SIGNED_BRIDGE_ENABLED:'true',BRIDGE_ADMISSION_REUSABLE_BOARD_ENABLED:'true',
  BRIDGE_ADMISSION_CATALOGUE_FILE:paths.config+'/policy/catalogue.json',BRIDGE_ADMISSION_LEGACY_BASELINE_FILE:config.admissionLegacyBaselineFile,
  BRIDGE_ADMISSION_LEGACY_BASELINE_SHA256:config.admissionLegacyBaselineSha256,GROQ_ENABLED:'true',GROQ_ONE_SHOT:'true',
  GROQ_API_KEY_FILE:paths.config+'/credentials/groq',GROQ_FREE_GATE_FILE:paths.config+'/credentials/free-gate.json',GROQ_ONCE_MARKER_FILE:markers+'/once.json',
  BRIDGE_OWNER_UPDATES_ENABLED:'true',BRIDGE_GROQ_KEY_REPLACEMENT_ENABLED:'true'};
 const privateFiles=[
  {file:env.BRIDGE_HMAC_SECRET_FILE,body:random(48).toString('base64url')+'\n',owner:'root',mode:0o640},
  {file:env.GROQ_API_KEY_FILE,body:a.apiKey+'\n',owner:'root',mode:0o640},
  {file:env.GROQ_FREE_GATE_FILE,body:json({v:3,owner:ownerId,task:taskId,enrollmentId,costEnrollment}),owner:'root',mode:0o640},
  {file:config.admissionLegacyBaselineFile,body:json(baseline),owner:'root',mode:0o640},
  {file:env.BRIDGE_ADMISSION_CATALOGUE_FILE,body:json({v:1,configurationSha256,costEnrollment,catalogue}),owner:'root',mode:0o640},
  {file:env.BRIDGE_CONSOLE_AUTH_DIR+'/auth-state.json',body:json(createBootstrapState({code,createdAt:now,expiresAt:now+3600000})),owner:'relay',mode:0o600},
  {file:paths.config+'/relay.env',body:Object.entries(env).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n',owner:'root',mode:0o640},
  {file:paths.config+'/first-sign-in.txt',body:`Open https://${a.hostname}\nSetup code: ${code}\nExpires: ${new Date(now+3600000).toISOString()}\nCreate your owner password in the browser. Do not share this code.\n`,owner:'root-only',mode:0o600}
 ];
 return {env,privateFiles,origin:config.consoleOrigins[0],ownerId,enrollmentId,paths};
}
export function ensureTrustedParent(directory){
 requireThat(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory,'unsafe_setup_parent');
 for(let p=directory;;p=path.dirname(p)){
  const s=fs.lstatSync(p);requireThat(s.isDirectory()&&s.uid===0&&(s.mode&0o022)===0,'unsafe_setup_parent');
  if(p==='/')break;
 }
}
export function assertFresh(paths){
 for(const target of [paths.code,paths.config,paths.state,paths.web,paths.updater,paths.updaterConfig,paths.updaterState,paths.inbox,paths.updateStatus,paths.updateQueue,paths.keySupport,paths.keyStatus,
  paths.units+'/board-event-relay.service',paths.units+'/board-event-relay.service.d',paths.units+'/picard-relay-web.service',...paths.legacy]){
  ensureTrustedParent(path.dirname(target));
  try{fs.lstatSync(target);throw Error('existing_installation_refused');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
// Called only after all target roots have been reserved by exclusive mkdir.
export function writePrivateSetup(plan,{uid,gid}){
 for(const {file,body,owner,mode} of plan.privateFiles){
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
  try{fs.writeFileSync(fd,body);fs.fchownSync(fd,owner==='relay'?uid:0,owner==='root-only'?0:gid);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
}
export function serviceUnits(paths){
 const hardening='NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nUMask=0077\n';
 return {
  relay:`[Unit]\nDescription=Picard Relay\nAfter=network-online.target\nWants=network-online.target\n[Service]\nUser=board-event-relay\nGroup=board-event-relay\nEnvironmentFile=${paths.config}/relay.env\nEnvironment=BRIDGE_CONTROL_SOCKET=${paths.state}/control.sock\nEnvironment=OPENSSL_CONF=${paths.updaterConfig}/openssl.cnf\nExecStart=${paths.code}/node --jitless ${paths.updater}/launch-versioned.mjs\nWorkingDirectory=${paths.state}\nReadWritePaths=${paths.state} ${paths.updateQueue}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\n${hardening}[Install]\nWantedBy=multi-user.target\n`,
  web:`[Unit]\nDescription=Picard HTTPS\nAfter=network-online.target board-event-relay.service\nWants=network-online.target\n[Service]\nUser=picard-relay-web\nGroup=picard-relay-web\nEnvironment=HOME=${paths.web}\nExecStart=${paths.code}/bin/caddy run --config ${paths.code}/Caddyfile --adapter caddyfile\nReadWritePaths=${paths.web}\nAmbientCapabilities=CAP_NET_BIND_SERVICE\nCapabilityBoundingSet=CAP_NET_BIND_SERVICE\nRestart=on-failure\nRestartSec=5\n${hardening}[Install]\nWantedBy=multi-user.target\n`
 };
}
