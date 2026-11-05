import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVmCpu,parseVmMemory,createVmTelemetry,summarizeVmPower,consoleSnapshot,createConsoleHandler} from '../src/oracle-service.mjs';

const cpu=(user,idle,extra='0 0')=>`cpu ${user} 0 0 ${idle} 0 0 0 0 ${extra}`;
const memory='MemTotal: 1024 kB\nMemFree: 10 kB\nMemAvailable: 768 kB\nCached: 700 kB\n';
test('CPU parser counts guest ticks once and rejects malformed counters',()=>{
 assert.equal(parseVmCpu(cpu(10,90,'8 3')).total,100);
 assert.equal(parseVmCpu(cpu(10,90)).idle,90);
 for(const text of [null,{},'cpu 1 2','cpu -1 0 0 0 0 0 0 0','cpu 1 0 0 1 0 0 0 NaN',cpu(Number.MAX_SAFE_INTEGER,10),'x'.repeat(1025)])assert.equal(parseVmCpu(text),null);
});
test('memory uses MemAvailable including reclaimable cache, not MemFree',()=>{
 assert.deepEqual(parseVmMemory(memory),{memoryUsedBytes:262144,memoryTotalBytes:1048576});
 for(const text of [null,'MemTotal: 1 kB\n','MemTotal: 1 kB\nMemAvailable: 2 kB\n',memory+'MemTotal: 1024 kB\n','MemTotal: 0 kB\nMemAvailable: 0 kB\n','x'.repeat(16385)])assert.equal(parseVmMemory(text),null);
});
function fixture(){
 let at=1_000_000,tick=1000,line=cpu(100,100),mem=memory,rss=123456,reads=0,fail=false;
 const read=createVmTelemetry({now:()=>at,monotonic:()=>tick,readProc:kind=>{reads++;if(fail&&kind==='cpu')throw Error('PRIVATE_FILE');return kind==='cpu'?line:mem;},readRss:()=>rss});
 return {read,get reads(){return reads},advance:ms=>{at+=ms;tick+=ms},setCpu:value=>{line=value},setMemory:value=>{mem=value},setRss:value=>{rss=value},failCpu:value=>{fail=value},rollback:()=>{tick=0}};
}
test('startup is unknown, visible/manual reads share a 15-second cache',()=>{
 const f=fixture(),first=f.read();assert.equal(first.cpuPercent,null);assert.equal(first.memoryUsedBytes,262144);assert.equal(f.reads,2);
 f.advance(14999);assert.equal(f.read(),first);assert.equal(f.reads,2);
 f.advance(1);f.setCpu(cpu(100,200));assert.equal(f.read().cpuPercent,0);assert.equal(f.reads,4);
 f.advance(15000);f.setCpu(cpu(175,225));assert.equal(f.read().cpuPercent,75);assert.equal(f.reads,6);
});
test('zero ticks, regressions, old sampling windows and monotonic resets are unknown',()=>{
 for(const scenario of ['zero','reset','gap','clock']){
  const f=fixture();f.read();f.advance(scenario==='gap'?60000:15000);
  if(scenario==='reset')f.setCpu(cpu(99,250));else if(scenario!=='zero')f.setCpu(cpu(175,225));
  if(scenario==='clock')f.rollback();assert.equal(f.read().cpuPercent,null,scenario);
 }
});
test('a failed CPU read loses its baseline and never invents a zero',()=>{
 const f=fixture();f.read();f.advance(15000);f.failCpu(true);assert.equal(f.read().cpuPercent,null);
 f.advance(15000);f.failCpu(false);f.setCpu(cpu(175,225));assert.equal(f.read().cpuPercent,null);
 f.advance(15000);f.setCpu(cpu(250,250));assert.equal(f.read().cpuPercent,75);
});
test('bad memory and RSS stay unknown independently of valid CPU',()=>{
 const f=fixture();f.read();f.advance(15000);f.setCpu(cpu(200,100));f.setMemory('PRIVATE_FILE');f.setRss('PRIVATE_PATH');
 const result=f.read();assert.equal(result.cpuPercent,100);assert.equal(result.memoryUsedBytes,null);assert.equal(result.memoryTotalBytes,null);assert.equal(result.relayMemoryBytes,null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('RSS above known VM capacity is not reported',()=>{const f=fixture();f.setRss(2**30);assert.equal(f.read().relayMemoryBytes,null);});
test('Picard-generated reviewed helper distinguishes real zero from unknown',()=>{
 const sample={observedAtMs:100000,cpuPercent:0,memoryUsedBytes:1,memoryTotalBytes:2};
 assert.deepEqual(summarizeVmPower(sample,100000),{state:'ready',label:'VM CPU',value:0,memoryPercent:50});
 for(const s of [null,[],Object.assign([],sample),{...sample,cpuPercent:'0'},{...sample,cpuPercent:NaN},{...sample,cpuPercent:101},{...sample,observedAtMs:40000},{...sample,observedAtMs:105001}])assert.equal(summarizeVmPower(s,100000).value,null);
 assert.equal(summarizeVmPower({...sample,observedAtMs:40001},100000).state,'ready');
 assert.equal(summarizeVmPower({...sample,observedAtMs:105000},100000).state,'ready');
 assert.equal(summarizeVmPower({...sample,memoryTotalBytes:0},100000).memoryPercent,null);
});
test('console exports only finite allowlisted resource values',()=>{
 const s=consoleSnapshot({},[],new Date(100000),'owner',{v:1,scope:'vm',observedAtMs:100000,cpuPercent:'SECRET_CPU',memoryUsedBytes:1,memoryTotalBytes:2,relayMemoryBytes:3,hostname:'SECRET_HOST',processes:['SECRET_PROC']});
 assert.deepEqual(s.resources,{v:1,scope:'vm',observedAtMs:100000,cpuPercent:null,memoryUsedBytes:1,memoryTotalBytes:2,relayMemoryBytes:3});
 assert.doesNotMatch(JSON.stringify(s),/SECRET/);assert.equal(consoleSnapshot({},[],new Date(100000),'owner',{v:1,scope:'other'}).resources,undefined);
});
test('only an authenticated same-host status request reaches telemetry',async()=>{
 let reads=0;const token='A'.repeat(43),handler=createConsoleHandler({enabled:true,origins:['https://relay.example'],auth:{authenticate:async t=>t===token},getSnapshot:()=>{reads++;return {v:1};}});
 const call=async({host='relay.example',cookie}={})=>{let code;const res={writeHead:n=>{code=n},end:()=>{}};await handler({method:'GET',url:'/status',headers:{host,...(cookie?{cookie}:{})}},res);return code;};
 assert.equal(await call(),401);assert.equal(await call({host:'other.example',cookie:'__Host-PicardSession='+token}),403);assert.equal(reads,0);
 assert.equal(await call({cookie:'__Host-PicardSession='+token}),200);assert.equal(reads,1);
});
