import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createBadgeInterestClient} from '../examples/landing/badge-interest.mjs';
const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};};
function backend(){const ids=new Set(),requests=[];let lose=false;return {ids,requests,setLose:v=>{lose=v;},fetchImpl:async(url,options)=>{requests.push({url,options});const b=options.body&&JSON.parse(options.body);if(b&&!url.endsWith('/status')){ids.add(b.voteId);if(lose)throw Error('lost_ack');}return Response.json({v:1,count:ids.size,accepting:true,voted:!!b&&ids.has(b.voteId)});}};}
test('visits do not vote; explicit vote and reload use one saved anonymous token',async()=>{
 const b=backend(),storage=memory(),client=createBadgeInterestClient({...b,storage,makeId:randomUUID});
 assert.equal(b.requests.length,0);assert.equal((await client.status()).count,0);assert.equal(b.ids.size,0);
 assert.equal((await client.vote()).voted,true);assert.equal((await client.vote()).count,1);
 const reopened=createBadgeInterestClient({...b,storage,makeId:()=>{throw Error('must_not_make_another_token');}});
 assert.equal((await reopened.status()).voted,true);assert.ok(b.requests.at(-1).url.endsWith('/status'));
 for(const r of b.requests){assert.equal(r.options.credentials,'omit');assert.equal(r.options.redirect,'error');assert.ok(!JSON.stringify(r).includes('email'));}
});
test('lost acknowledgement is recovered with a read and no automatic replacement vote',async()=>{
 const b=backend(),client=createBadgeInterestClient({...b,storage:memory(),makeId:randomUUID});b.setLose(true);
 await assert.rejects(client.vote(),/lost_ack/);assert.equal(b.requests.length,1);
 assert.equal((await client.status()).voted,true);assert.equal(b.requests.length,2);assert.ok(b.requests[1].url.endsWith('/status'));assert.equal(b.ids.size,1);
});
test('two already-open clients share the stored vote instead of overwriting its recovery identity',async()=>{
 const b=backend(),storage=memory(),one=createBadgeInterestClient({...b,storage,makeId:randomUUID}),two=createBadgeInterestClient({...b,storage,makeId:randomUUID});
 await one.vote();await two.vote();assert.equal(b.ids.size,1);
 const reopened=createBadgeInterestClient({...b,storage,makeId:()=>{throw Error('must_reuse');}});
 assert.equal((await reopened.status()).voted,true);assert.equal((await reopened.status()).count,1);
});
test('unavailable storage prevents voting and malformed counters are never shown as success',async()=>{
 const b=backend(),storage={getItem(){throw Error();},setItem(){throw Error();}};
 await assert.rejects(createBadgeInterestClient({...b,storage,makeId:randomUUID}).vote(),/storage_required/);assert.equal(b.requests.length,0);
 const bad=createBadgeInterestClient({storage:memory(),fetchImpl:async()=>Response.json({v:1,count:-1,accepting:true,voted:true})});
 await assert.rejects(bad.status(),/unexpected_badge_status/);
});
