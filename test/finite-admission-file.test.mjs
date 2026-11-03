import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';
import {createLocalCatalogueLoader} from '../experimental/finite-admission/catalogue-file.mjs';
const linux={skip:process.platform!=='linux'?'Requires real Linux owner/group/mode enforcement.':false};
function fixture(fn){return()=>{const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-catalogue-'));fs.chmodSync(root,0o750);const file=path.join(root,'catalogue.json'),record={v:1,catalogue:{synthetic:true},costEnrollment:{synthetic:true},configurationSha256:'a'.repeat(64)};fs.writeFileSync(file,canonical(record)+'\n',{mode:0o640});fs.chmodSync(file,0o640);try{return fn({root,file,record,load:createLocalCatalogueLoader({mode:'synthetic-integration-only',file})});}finally{fs.rmSync(root,{recursive:true,force:true});}};}
test('catalogue loader cannot be constructed in production mode',()=>assert.throws(()=>createLocalCatalogueLoader({mode:'production'}),/production_admission_disabled/));
test('metadata-only canonical read and atomic root-controlled reload need no restart',linux,fixture(({root,file,record,load})=>{assert.deepEqual(load(),record);const next={...record,catalogue:{synthetic:'updated'}},temp=path.join(root,'new');fs.writeFileSync(temp,canonical(next)+'\n',{mode:0o640});fs.renameSync(temp,file);assert.deepEqual(load(),next);}));
for(const mode of [0o644,0o600,0o660])test('unexpected catalogue file mode refused '+mode.toString(8),linux,fixture(({file,load})=>{fs.chmodSync(file,mode);assert.throws(load,/catalogue_unavailable/);}));
test('catalogue parent unsafe mode and wrong expected ownership are refused',linux,fixture(({root,file,load})=>{fs.chmodSync(root,0o770);assert.throws(load,/catalogue_unavailable/);fs.chmodSync(root,0o750);const wrong=createLocalCatalogueLoader({mode:'synthetic-integration-only',file,expectedUid:process.getuid()+1});assert.throws(wrong,/catalogue_unavailable/);}));
test('catalogue symlink, hardlink and parent symlink never redirect reads',linux,fixture(({root,file,load})=>{const real=path.join(root,'real');fs.renameSync(file,real);fs.symlinkSync(real,file);assert.throws(load,/catalogue_unavailable/);fs.unlinkSync(file);fs.linkSync(real,file);assert.throws(load,/catalogue_unavailable/);}));
for(const raw of ['{"v":1,"v":1}\n','{"v":1, "unknown":true}\n',' '.repeat(32769),Buffer.from([0xff])])test('noncanonical/duplicate/oversized/invalid UTF8 metadata fails closed '+String(raw).slice(0,20),linux,fixture(({file,load})=>{fs.writeFileSync(file,raw);assert.throws(load,/catalogue_unavailable/);}));
