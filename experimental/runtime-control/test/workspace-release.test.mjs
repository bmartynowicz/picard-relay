import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
test('v1 source packages the same 20-file signed boundary with unchanged state schema and sequence',()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'picard-v1-release-'));
 try{
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'experimental/updater'),{recursive:true});fs.mkdirSync(path.join(dir,'experimental/runtime-control'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/build-release.mjs'),path.join(dir,'scripts/build-release.mjs'));fs.copyFileSync(path.join(root,'experimental/updater/policy.example.json'),path.join(dir,'experimental/updater/policy.example.json'));fs.cpSync(path.join(root,'experimental/runtime-control/src'),path.join(dir,'experimental/runtime-control/src'),{recursive:true});
  execFileSync(process.execPath,['scripts/build-release.mjs'],{cwd:dir,env:{...process.env,GITHUB_REPOSITORY:'bmartynowicz/picard-relay',GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_NUMBER:'26',GITHUB_RUN_ATTEMPT:'1'}});
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'release-output/manifest.json'))),bundle=JSON.parse(fs.readFileSync(path.join(dir,'release-output/bundle.json')));
  assert.equal(manifest.version,'1.0.26');assert.equal(manifest.sequence,26001);assert.equal(manifest.stateSchema,1);assert.equal(manifest.migration,'none');assert.equal(manifest.files.length,20);
  for(const spec of manifest.files){const bytes=Buffer.from(bundle.files.find(f=>f.path===spec.path).base64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);assert.equal(bytes.length,spec.bytes);assert(bytes.equals(fs.readFileSync(path.join(root,'experimental/runtime-control',spec.path))));}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
