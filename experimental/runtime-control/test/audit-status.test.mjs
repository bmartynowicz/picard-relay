import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {consoleSnapshot,CONSOLE_HTML} from '../src/oracle-service.mjs';
import {createRuntimeControl} from '../src/runtime-control.mjs';
const helper=CONSOLE_HTML.match(/function consoleServiceSummary\(s\) \{[\s\S]*?\n\}/)[0];
const summary=vm.runInNewContext('('+helper+')');
test('Picard status proposal distinguishes reachability from readiness for all boolean and malformed combinations',()=>{
 for(const ready of [true,false,null,undefined,1,'true'])for(const draining of [true,false,null,1])for(const providerReady of [true,false,null,1])for(const acceptingNewWork of [true,false,null,1]){
  const result=summary({ready,draining,providerReady,acceptingNewWork});const expected=typeof ready!=='boolean'?['Service state unknown','neutral']:!ready?['Service unavailable','warn']:draining===true?['Relay draining - new work blocked','warn']:providerReady===true&&acceptingNewWork===true?['Ready for new work','good']:['Relay reachable - new work blocked','warn'];assert.deepEqual([result.label,result.tone],expected);
 }assert.equal(summary(null).label,'Service state unknown');
});
test('console exposes version identity only with physical verification and drops raw blocking details',()=>{
 const source={updateReady:true,releaseHash:'a'.repeat(64),releaseVersion:'0.1.17',releaseSequence:17001,sourceCommit:'b'.repeat(40),blockingCode:'allowance_unavailable',secret:'PRIVATE'};
 const s=consoleSnapshot(source,[]);assert.deepEqual(s.release,{hash:source.releaseHash,version:'0.1.17',sequence:17001,sourceCommit:source.sourceCommit});assert.equal(s.service.blockingCode,'allowance_unavailable');assert.doesNotMatch(JSON.stringify(s),/PRIVATE/);
 assert.deepEqual(consoleSnapshot({...source,updateReady:false},[]).release,{hash:null,version:null,sequence:null,sourceCommit:null});assert.equal(consoleSnapshot({...source,blockingCode:'PRIVATE'},[]).service.blockingCode,'unknown');
 const invalid=consoleSnapshot({...source,releaseVersion:'<img>',releaseSequence:-1,sourceCommit:'PRIVATE'},[]);assert.equal(invalid.release.version,null);assert.equal(invalid.release.sequence,null);assert.equal(invalid.release.sourceCommit,null);
});
test('runtime availability projection preserves only typed codes and drains monotonically',()=>{
 let code='allowance_unavailable';const control=createRuntimeControl({providerAvailability:()=>({code,secret:'PRIVATE'})});assert.equal(control.health().blockingCode,code);code='PRIVATE';assert.equal(control.health().blockingCode,'unknown');control.drain();assert.equal(control.health().blockingCode,'relay_busy_or_draining');assert.equal(control.health().acceptingNewWork,false);
});
