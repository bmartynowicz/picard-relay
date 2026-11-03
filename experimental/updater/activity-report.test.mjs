import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import {tmpdir} from 'node:os';
import {summarizeUpdaterActivity,writeUpdaterActivity} from './activity-report.mjs';
import {readUpdaterActivity,projectUpdaterActivity} from '../runtime-control/src/runtime-control.mjs';
const now=Date.parse('2026-11-03T21:00:00Z');
const fixture=()=>({policyEnabled:true,held:false,timer:{ActiveState:'active',UnitFileState:'enabled'},fetch:{ActiveState:'inactive',Result:'success',ExecMainStartTimestamp:'Tue 2026-11-03 20:45:01 GMT',ExecMainExitTimestamp:'Tue 2026-11-03 20:45:02 GMT'},update:{ActiveState:'inactive',Result:'success',ExecMainStartTimestamp:'Tue 2026-11-03 20:45:03 GMT',ExecMainExitTimestamp:'Tue 2026-11-03 20:45:06 GMT'}});
test('actual systemd timestamp format produces bounded last attempt and outcome without logs',()=>{
 const report=summarizeUpdaterActivity(fixture(),now);assert.equal(report.state,'enabled');assert.equal(report.timerActive,true);assert.equal(report.lastAttemptAt,'2026-11-03T20:45:03.000Z');assert.equal(report.lastFinishedAt,'2026-11-03T20:45:06.000Z');assert.equal(report.lastOutcome,'check_succeeded');assert.equal(projectUpdaterActivity(report,now).state,'enabled');
});
test('policy, hold, running, disabled timer, never-run, and latest failures stay distinct',()=>{
 const cases=[['disabled',f=>f.policyEnabled=false,'policy_disabled'],['held',f=>f.held=true,'hold_present'],['checking',f=>f.update.ActiveState='activating','check_in_progress'],['disabled',f=>f.timer.ActiveState='inactive','timer_disabled'],['error',f=>f.update.Result='exit-code','check_failed'],['error',f=>{f.fetch.Result='exit-code';f.fetch.ExecMainExitTimestamp='Tue 2026-11-03 20:46:06 GMT';},'fetch_failed']];
 for(const [state,change,reason] of cases){const f=fixture();change(f);const r=summarizeUpdaterActivity(f,now);assert.equal(r.state,state);assert.equal(r.reasonCode,reason);}
 const f=fixture();f.fetch={ActiveState:'inactive'};f.update={ActiveState:'inactive'};const r=summarizeUpdaterActivity(f,now);assert.equal(r.lastAttemptAt,null);assert.equal(r.lastOutcome,'never_checked');assert.equal(r.reasonCode,'never_checked');
 assert.throws(()=>summarizeUpdaterActivity({...fixture(),policyEnabled:'true'},now),/metadata/);
});
test('stale, future, invalid observations and unknown data never become current success',()=>{
 const report=summarizeUpdaterActivity(fixture(),now);assert.equal(projectUpdaterActivity(report,now+180001).state,'unknown');assert.equal(projectUpdaterActivity(report,now+180001).reasonCode,'activity_stale');assert.equal(projectUpdaterActivity(report,now-5001).reasonCode,'activity_clock_mismatch');
 for(const patch of [{state:'PRIVATE'},{reasonCode:'PRIVATE'},{lastOutcome:'PRIVATE'},{lastAttemptAt:'PRIVATE'},{configured:'true'},{observedAt:'PRIVATE'}]){const r=projectUpdaterActivity({...report,...patch},now);assert.equal(r.state,'unknown');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);}
 const r=projectUpdaterActivity({...report,secret:'PRIVATE',logs:'PRIVATE'},now);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|logs|secret/);
});
test('atomic public metadata stays root-controlled and reader rejects unsafe evidence',{skip:process.platform==='win32'},async()=>{
 const root=await fs.mkdtemp(tmpdir()+'/picard-activity-'),uid=process.getuid(),report=summarizeUpdaterActivity(fixture(),now),options={root,expectedUid:uid,now};try{
  assert.equal(readUpdaterActivity(options).reasonCode,'activity_not_connected');await writeUpdaterActivity(report,{root,uid});assert.equal((await fs.stat(root+'/status.json')).mode&0o777,0o644);assert.equal(readUpdaterActivity(options).state,'enabled');
  await fs.chmod(root+'/status.json',0o666);assert.equal(readUpdaterActivity(options).state,'unknown');await assert.rejects(writeUpdaterActivity(report,{root,uid}),/unsafe_evidence/);await fs.chmod(root+'/status.json',0o644);
  await fs.rename(root+'/status.json',root+'/saved.json');await fs.symlink(root+'/saved.json',root+'/status.json');assert.equal(readUpdaterActivity(options).state,'unknown');await assert.rejects(writeUpdaterActivity(report,{root,uid}));await fs.unlink(root+'/status.json');
  await fs.link(root+'/saved.json',root+'/status.json');assert.equal(readUpdaterActivity(options).state,'unknown');await fs.unlink(root+'/status.json');await fs.writeFile(root+'/status.json','x'.repeat(4097));assert.equal(readUpdaterActivity(options).state,'unknown');
  await fs.writeFile(root+'/status.json',JSON.stringify(report));await fs.chmod(root,0o777);assert.equal(readUpdaterActivity(options).state,'unknown');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
