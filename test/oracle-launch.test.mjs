import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {oracleLaunchAssets,HOST_FILES,STACK_FILES} from '../scripts/build-oracle-launch.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('Oracle package is deterministic, content-addressed, allowlisted, and import-complete',async()=>{
 const assets=await oracleLaunchAssets(),again=await oracleLaunchAssets();
 assert.deepEqual(Object.keys(assets),Object.keys(again));for(const name of Object.keys(assets))assert.ok(assets[name].equals(again[name]));
 const host=Object.keys(assets).find(n=>n.endsWith('.tgz'));assert.equal(host,'oracle-host-'+sha(assets[host])+'.tgz');assert.ok(assets[host].length<5000000);
 const tar=gunzipSync(assets[host]),files=new Map();
 for(let i=0;i<tar.length&&tar[i];){const header=tar.subarray(i,i+512),name=header.subarray(0,100).toString().replace(/\0.*$/s,''),size=parseInt(header.subarray(124,136).toString(),8);assert.equal(header.subarray(257,263).toString(),'ustar\0');assert.equal(header[156],48);files.set(name,tar.subarray(i+512,i+512+size));i+=512+Math.ceil(size/512)*512;}
 assert.equal(files.size,HOST_FILES.length+20);
 for(const [name,body] of files){assert.ok(!/\.git|credentials|state\.json|\.env|test\//.test(name));if(!name.endsWith('.mjs'))continue;
  for(const m of body.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),m[1]));assert.ok(files.has(target),name+' missing '+target);}
 }
 const zip=assets['oracle-stack.zip'],stack=new Map();let i=0;
 while(zip.readUInt32LE(i)===0x04034b50){assert.equal(zip.readUInt16LE(i+8),0);const size=zip.readUInt32LE(i+18),len=zip.readUInt16LE(i+26),extra=zip.readUInt16LE(i+28),name=zip.subarray(i+30,i+30+len).toString(),start=i+30+len+extra;stack.set(name,zip.subarray(start,start+size));i=start+size;}
 assert.deepEqual([...stack.keys()].sort(),[...STACK_FILES,'artifact.tf.json'].sort());
 const constants=JSON.parse(stack.get('artifact.tf.json'));assert.equal(constants.locals.picard_artifact_sha256,sha(assets[host]));assert.equal(constants.locals.picard_artifact_url,'https://bmartynowicz.github.io/picard-relay/'+host);
 const cloud=stack.get('cloud-init.tftpl').toString();assert.match(cloud,/sha256sum --check --status/);assert.doesNotMatch(cloud,/curl[^\n]*\|.*(?:sh|bash)/);assert.ok(!stack.has('terraform.tfstate'));
});
