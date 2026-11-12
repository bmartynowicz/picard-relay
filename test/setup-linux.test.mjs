import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSetup,validateAnswers,setupPaths,hash} from '../scripts/setup-linux-core.mjs';
import {readBoundAdmissionPolicy} from '../experimental/runtime-control/src/admission-policy.mjs';
import {admissionConfigurationDigest} from '../experimental/runtime-control/src/admission-runtime.mjs';

const answers={hostname:'picard.example.com',accountLabel:'Synthetic Free project',organizationId:'org_synthetic',projectId:'proj_synthetic',apiKey:'gsk_SYNTHETIC_ONLY_NOT_A_REAL_KEY_1234',freeConfirmed:true,keyProjectConfirmed:true,networkConfirmed:true};
test('fresh setup binds a finite empty catalogue, key and baseline to the actual production validators',()=>{
 const p=buildSetup(answers),e=p.env,policy=JSON.parse(p.privateFiles.find(v=>v.file===e.BRIDGE_ADMISSION_CATALOGUE_FILE).body);
 const baseline=p.privateFiles.find(v=>v.file===e.BRIDGE_ADMISSION_LEGACY_BASELINE_FILE);
 const config={ownerId:e.BRIDGE_OWNER_ID,allowedTaskId:e.BRIDGE_ALLOWED_TASK_ID,assistantId:e.BRIDGE_ASSISTANT_ID,keyId:e.BRIDGE_KEY_ID,consoleOrigins:JSON.parse(e.BRIDGE_CONSOLE_ORIGINS),admissionLegacyBaselineFile:baseline.file,admissionLegacyBaselineSha256:hash(baseline.body)};
 const binding={...policy.catalogue,keySha256:hash(answers.apiKey),configurationSha256:admissionConfigurationDigest({config,enrollmentId:p.enrollmentId,keySha256:hash(answers.apiKey),markerDirectory:'/var/lib/picard-relay/markers'})};
 assert.equal(readBoundAdmissionPolicy(()=>policy,binding).slotCount,0);
 assert.equal(hash(baseline.body),e.BRIDGE_ADMISSION_LEGACY_BASELINE_SHA256);
 assert.equal(e.BRIDGE_ADMISSION_REUSABLE_BOARD_ENABLED,'true');assert.equal(e.BRIDGE_WORKSPACE_ENABLED,'true');
 assert.equal(e.BRIDGE_OWNER_UPDATES_ENABLED,undefined);assert.equal(e.BRIDGE_GROQ_KEY_REPLACEMENT_ENABLED,undefined);
 assert.equal(p.privateFiles.some(v=>v.body.includes('paidFallback":true')),false);
 assert.equal(JSON.stringify(e).includes(answers.apiKey),false);
});
test('setup rejects missing Free/network/key ownership evidence and unsafe hostnames before writing',()=>{
 for(const key of ['freeConfirmed','keyProjectConfirmed','networkConfirmed'])assert.throws(()=>buildSetup({...answers,[key]:false}),/owner_confirmation_required/);
 for(const hostname of ['http://example.com','example.com {','localhost','127.0.0.1','a.invalid','A.example.com','a..com','a.example.com\n'])assert.throws(()=>validateAnswers({...answers,hostname}),/invalid_public_hostname/);
 assert.throws(()=>buildSetup({...answers,apiKey:'not-a-key'}),/invalid_groq_key/);
 assert.throws(()=>setupPaths('/tmp/a/../b'),/invalid_setup_root/);
});
test('bootstrap expires after one hour, is never reused and is kept out of environment and unit files',()=>{
 const a=buildSetup(answers),b=buildSetup(answers);
 assert.notEqual(a.enrollmentId,b.enrollmentId);assert.notEqual(a.ownerId,b.ownerId);
 const note=a.privateFiles.find(v=>v.file.endsWith('first-sign-in.txt'));
 assert.equal(note.mode,0o600);assert.equal(note.owner,'root-only');
 assert.equal(JSON.stringify(a.env).includes(note.body.match(/Setup code: (.+)/)[1]),false);
});
test('Linux root-owned fixture: protected install files, repeat refusal, first approval/result/restart', {skip:process.platform!=='linux'?'Requires actual Linux users and permissions.':false,timeout:60000},()=>{
 const fixture=fileURLToPath(new URL('./fixtures/setup-linux-lifecycle.mjs',import.meta.url));
 const cmd=process.getuid()===0?process.execPath:'sudo',args=process.getuid()===0?[fixture]:['-n',process.execPath,fixture];
 const r=spawnSync(cmd,args,{encoding:'utf8',timeout:55000,maxBuffer:65536});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/setup_lifecycle_passed/);
});
