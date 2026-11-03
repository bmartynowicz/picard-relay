import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {createHash} from 'node:crypto';
import {CONSOLE_HTML} from '../experimental/runtime-control/src/oracle-service.mjs';

test('standalone preview contains exact console script after synthetic interception and cannot fall back to live data',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'picard-preview-test-'));try{
  const file=path.join(dir,'preview.html'),generator=fileURLToPath(new URL('../examples/console-preview.mjs',import.meta.url));
  const receipt=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[generator,file],{env:process.env,stdio:['ignore','pipe','pipe']});let raw='',errors='';child.stdout.on('data',d=>raw+=d);child.stderr.on('data',d=>errors+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(raw)):reject(Error(errors)));});
  const html=fs.readFileSync(file,'utf8'),outer=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(outer.length,1);new Script(outer[0][1]);
  const encoded=outer[0][1].match(/,source=("(?:[^"\\]|\\.)*");function reset/);assert.ok(encoded);const source=JSON.parse(encoded[1]);
  const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);assert.equal(scripts.length,2);for(const script of scripts)new Script(script);
  assert.equal(scripts[1],CONSOLE_HTML.match(/<script>([\s\S]*?)<\/script>/)[1]);assert.match(scripts[0],/globalThis\.fetch=async/);assert.match(scripts[0],/Unexpected synthetic request; no network fallback/);assert.equal(/https?:\/\//.test(scripts[0]),false);
  assert.equal(receipt.sourceHtmlSha256,createHash('sha256').update(CONSOLE_HTML).digest('hex'));assert.equal(receipt.previewSha256,createHash('sha256').update(html).digest('hex'));assert.equal(receipt.synthetic,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
