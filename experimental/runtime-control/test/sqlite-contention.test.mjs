import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createOutboxStore} from '../src/outbox.mjs';
const dir=mkdtempSync(join(tmpdir(),'bridge-contention-')),dbPath=join(dir,'db.sqlite'),ready=join(dir,'locked'),script=join(dir,'holder.mjs');let child;
try {
 const s=createOutboxStore({dbPath});s.close();
 writeFileSync(script,`import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';const db=new DatabaseSync(${JSON.stringify(dbPath)});db.exec('BEGIN EXCLUSIVE');writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{db.exec('COMMIT');db.close();},500);`);
 child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',d=>error+=d);const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 for(let i=0;i<100&&!existsSync(ready);i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(existsSync(ready),true,'lock holder did not become ready');
 const check=createOutboxStore({dbPath});assert.equal(Number(check.db.prepare('PRAGMA busy_timeout').get().timeout),5000);check.close();
 assert.equal(await exit,0,error);console.log('PASS bounded SQLite busy handler waits for another process to release schema lock');
}finally{if(child&&child.exitCode===null)child.kill();rmSync(dir,{recursive:true,force:true});}
