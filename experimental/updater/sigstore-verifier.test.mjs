import test from 'node:test';import assert from 'node:assert/strict';import {verifierArgs,IDENTITY,ISSUER,verifySigstoreManifest} from './sigstore-verifier.mjs';
test('exact workflow issuer repository ref and commit pinned',()=>{const a=verifierArgs('/tmp/m','/tmp/b','a'.repeat(40));for(const v of [IDENTITY,ISSUER,'bmartynowicz/picard-relay','refs/heads/main','a'.repeat(40)])assert.ok(a.includes(v));assert.ok(a.includes('--trusted-root'));assert.equal(a.some(s=>s.includes('insecure')||s.includes('regexp')),false);});
test('untrusted source commit cannot become verifier args',()=>assert.throws(()=>verifierArgs('/tmp/m','/tmp/b','; echo hacked')));
test('non-Sigstore proof rejected before trust access',async()=>assert.rejects(verifySigstoreManifest(Buffer.from('{}'),Buffer.from('{}')),/bundle_required/));
test('oversized proof rejected before filesystem',async()=>assert.rejects(verifySigstoreManifest(Buffer.from('{}'),Buffer.alloc(65537)),/size_limit/));
import {applyPreparedUpdate} from './updater.mjs';
test('production update requires explicit root Sigstore enrollment',async()=>assert.rejects(applyPreparedUpdate({policy:{enabled:false,signatureMode:'sigstore',expectedAdministratorUid:0}}),/not_enrolled/));
