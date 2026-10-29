import assert from 'node:assert/strict';
import {mkdtempSync,lstatSync,existsSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createConnection} from 'node:net';
import {createRuntimeControl} from '../src/runtime-control.mjs';
const dir=mkdtempSync(join(tmpdir(),'picard-control-')),path=join(dir,'control.sock');let counts=[{state:'queued',count:2}];
const c=createRuntimeControl({socketPath:path,releaseHash:'a'.repeat(64),stats:()=>counts,providerReady:()=>true});
const ask=(data)=>new Promise((yes,no)=>{const s=createConnection(path);let out='';s.on('error',no);s.on('connect',()=>s.write(data));s.on('data',x=>out+=x);s.on('end',()=>yes(out?JSON.parse(out):null));});
try{
 await c.start();assert.equal(lstatSync(path).mode&0o777,0o600);
 let h=await ask('{"v":1,"action":"health"}\n');assert.equal(h.accepting,true);assert.equal(h.busy,false);assert.deepEqual(h.ledgerStateCounts,{queued:2});assert.equal(h.releaseHash,'unversioned-flat');assert.equal(h.updateReady,false);
 for(const bad of ['{"v":1,"action":"exec"}\n','{"v":1,"action":"health","cmd":"x"}\n','x'.repeat(257),'{}\n{}\n'])assert.equal((await ask(bad)).error,'invalid_command');
 assert.equal(await ask('{'),null); // bounded partial-message close
 assert.equal(c.tryBegin(),true);h=await ask('{"v":1,"action":"drain"}\n');assert.equal(h.busy,true);assert.equal(h.drained,false);assert.equal(c.tryBegin(),false);c.finish();assert.equal(c.health().drained,true);assert.equal(c.tryBegin(),false);
 counts=[{state:'invoking',count:1}];assert.equal(c.health().drained,false);assert.equal(c.health().unresolvedInvoking,1);assert.deepEqual(counts,[{state:'invoking',count:1}]);
 await c.close();assert.equal(existsSync(path),false);
 writeFileSync(path,'preserved');await assert.rejects(createRuntimeControl({socketPath:path,releaseHash:'b'.repeat(64)}).start(),/exists/);assert.equal(existsSync(path),true);
 const off=createRuntimeControl();await off.start();assert.equal(off.health().accepting,true);await off.close();
 console.log('PASS control socket: permissions, health, invalid/partial/oversize commands, busy/idle monotonic drain, unresolved invocation, existing-path preservation, disabled default');
}finally{await c.close();rmSync(dir,{recursive:true,force:true});}
