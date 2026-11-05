import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForResult} from '../tools/manual-request.mjs';
const queued={state:'queued',responseAuthenticated:true};
for(const wake of ['truncate','early-tick'])test('fractional timer budget cannot start a last-tick result read: '+wake,async()=>{
 let time=0,calls=0;const delays=[];
 const result=await waitForResult({receipt:queued,intent:{},waitMs:1000,now:()=>time+=.1,sleep:async ms=>{delays.push(ms);time+=wake==='truncate'?Math.trunc(ms):ms-.5;},client:{result:async()=>{calls++;throw Error('must_not_poll');}}});
 assert.equal(calls,0);assert.deepEqual(delays,[1000]);assert.equal(result,queued);
});
for(const overshoot of [0,1,5000])test('poll does not start at or beyond the wait deadline: '+overshoot,async()=>{
 let time=0,calls=0;const receipt=await waitForResult({receipt:queued,intent:{},client:{result:async()=>{calls++;throw Error('must_not_poll');}},waitMs:1000,now:()=>time,sleep:async ms=>time+=ms+overshoot});assert.equal(calls,0);assert.equal(receipt.state,'queued');
});
test('zero wait and terminal result cause no timer or additional HTTP read',async()=>{for(const receipt of [queued,{state:'completed'},{state:'uncertain'},{state:'failed'}]){const result=await waitForResult({receipt,intent:{},client:{result:()=>{throw Error('must_not_poll');}},waitMs:receipt===queued?0:1000,sleep:()=>{throw Error('must_not_sleep');}});assert.equal(result,receipt);}});
test('a permitted poll gets a deadline signal and terminal read stops polling',async()=>{let time=0,calls=0;const result=await waitForResult({receipt:queued,intent:{},client:{result:async(_,options)=>{calls++;assert.ok(options.signal instanceof AbortSignal);return {state:'completed'};}},waitMs:2000,now:()=>time,sleep:async ms=>time+=ms});assert.equal(calls,1);assert.equal(result.state,'completed');});
test('ordinary result-read failure is reported without polling retry',async()=>{let time=0,calls=0;await assert.rejects(()=>waitForResult({receipt:queued,intent:{},client:{result:async()=>{calls++;throw Error('read_failed');}},waitMs:2000,now:()=>time,sleep:async ms=>time+=ms}),/read_failed/);assert.equal(calls,1);});
test('in-flight result read is cancelled at the remaining budget and preserves the last actual state',async()=>{
 let calls=0;const started=Date.now();const result=await waitForResult({receipt:queued,intent:{},waitMs:40,sleep:async()=>{},client:{result:async(_,options)=>{calls++;return new Promise((resolve,reject)=>{const keepAlive=setTimeout(()=>reject(Error('deadline_not_honored')),1000);options.signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(Error('deadline'));},{once:true});});}}});
 assert.equal(result.state,'queued');assert.equal(result.polling,'deadline_reached');assert.equal(calls,1);assert.ok(Date.now()-started<750);
});
