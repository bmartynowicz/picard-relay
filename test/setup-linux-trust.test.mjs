import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCosignAssets,requireCheckoutRuntime} from '../scripts/setup-linux-trust.mjs';
import {installVerifiedCosign} from '../scripts/install-ci-cosign.mjs';
test('a changed checkout cannot be installed under another signed runtime identity',()=>{
 const files=[{path:'src/one.mjs',bytes:Buffer.from('reviewed source')}];
 assert.doesNotThrow(()=>requireCheckoutRuntime(files,()=>Buffer.from('reviewed source')));
 assert.throws(()=>requireCheckoutRuntime(files,()=>Buffer.from('changed source')),/signed_runtime_differs_from_checkout/);
});
test('unsupported architectures have no signing-tool fallback',()=>{
 for(const arch of ['ia32','riscv64','amd64',''])assert.throws(()=>setupCosignAssets(arch),/unsupported_setup_architecture/);
 assert.notEqual(setupCosignAssets('x64')[0].sha256,setupCosignAssets('arm64')[0].sha256);
});
test('the ARM path retains digest-before-execution and both signature boundaries',async()=>{
 const assets=setupCosignAssets('arm64'),actions=[];
 const d={download:async a=>actions.push('download:'+a.name),digest:async a=>a.sha256,executable:async n=>actions.push('execute:'+n),file:n=>'/synthetic/'+n,run:async(_n,args)=>actions.push(args.includes('--key')?'kms':'keyless'),install:async()=>actions.push('install')};
 await installVerifiedCosign(d,{assets});assert.deepEqual(actions.slice(-3),['keyless','kms','install']);
 actions.length=0;await assert.rejects(installVerifiedCosign({...d,digest:async a=>a.name==='keyless.json'?'0'.repeat(64):a.sha256},{assets}),/cosign_digest_mismatch/);
 assert.equal(actions.some(v=>v.startsWith('execute:')),false);assert.equal(actions.includes('install'),false);
});
