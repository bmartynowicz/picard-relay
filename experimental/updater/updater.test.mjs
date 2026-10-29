import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validate,applyOfflineCandidate,loadAdministratorPolicy} from './updater.mjs';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const hash=b=>createHash('sha256').update(b).digest('hex');
const now=Date.now();
const policy={expectedAdministratorUid:process.getuid(),enabled:true,publisherKey:publicKey.export({type:'spki',format:'pem'}),channel:'stable',stateSchema:1,allowedFiles:['src/oracle-service.mjs']};
function packet(mod={}, filePath='src/oracle-service.mjs') {
 const bytes=Buffer.from('// mock only, never executed\n');
 const bundleBytes=Buffer.from(JSON.stringify({files:[{path:filePath,base64:bytes.toString('base64')}]}));
 const m={format:1,product:'picard-relay',channel:'stable',version:'1.0.1',sequence:1,expiresAt:now+60000,nodeMajor:24,stateSchema:1,migration:'none',bundleSha256:hash(bundleBytes),files:[{path:filePath,sha256:hash(bytes),bytes:bytes.length}],...mod};
 const manifestBytes=Buffer.from(JSON.stringify(m));
 return {manifestBytes,signature:sign(null,manifestBytes,privateKey),bundleBytes};
}
async function setup(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'picard-update-test-')); await fs.chmod(root,0o700);
 await fs.mkdir(path.join(root,'releases')); const old='releases/'+'a'.repeat(64); await fs.mkdir(path.join(root,old)); await fs.symlink(old,path.join(root,'current'));
 // State outside code root, exactly as production must be laid out.
 const ledger=path.join(root,'ledger.db'); const key=path.join(root,'credentials'); await fs.writeFile(ledger,'durable-ledger'); await fs.writeFile(key,'fake-key-only');
 t.after(async()=>{ async function writable(dir){ for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isDirectory()) await writable(path.join(dir,e.name));} await fs.chmod(dir,0o700); } await writable(root); await fs.rm(root,{recursive:true,force:true}); });
 const events=[]; const adapter={kind:'offline-test',quiesce:async()=>{events.push('drain');return true;},stop:async()=>events.push('stop'),start:async p=>events.push(p),health:async()=>true};
 return {root,old,adapter,events};
}
test('valid signature and complete fixed file list',()=>assert.equal(validate(...Object.values(packet()),policy,now).files.length,1));
for(const [name,mod] of Object.entries({expired:{expiresAt:now-1},wrongChannel:{channel:'other'},migration:{migration:'sql'},schema:{stateSchema:2},node:{nodeMajor:25},badSequence:{sequence:0},badVersion:{version:'../../x'}})) test(`reject ${name}`,()=>{const p=packet(mod);assert.throws(()=>validate(p.manifestBytes,p.signature,p.bundleBytes,policy,now));});
for(const pth of ['../credentials','/etc/passwd','src/../../key','src/extra.mjs','src/oracle-service.mjs/child']) test(`reject path ${pth}`,()=>{const p=packet({},pth);assert.throws(()=>validate(p.manifestBytes,p.signature,p.bundleBytes,policy,now));});
test('reject altered manifest',()=>{const p=packet();p.manifestBytes[0]=32;assert.throws(()=>validate(p.manifestBytes,p.signature,p.bundleBytes,policy,now),/signature/);});
test('reject altered bundle',()=>{const p=packet();p.bundleBytes[0]=32;assert.throws(()=>validate(p.manifestBytes,p.signature,p.bundleBytes,policy,now),/hash/);});
test('reject untrusted publisher',()=>{const p=packet();const other=generateKeyPairSync('ed25519');assert.throws(()=>validate(p.manifestBytes,p.signature,p.bundleBytes,{...policy,publisherKey:other.publicKey.export({type:'spki',format:'pem'})},now),/signature/);});
test('reject oversized input',()=>{const p=packet();assert.throws(()=>validate(p.manifestBytes,p.signature,Buffer.alloc(2*1024*1024+1),policy,now),/size/);});
test('disabled by default',async t=>{const s=await setup(t);await assert.rejects(applyOfflineCandidate({...s,policy:{...policy,enabled:false},...packet(),now}),/disabled/);});
test('no production adapter available',async t=>{const s=await setup(t);await assert.rejects(applyOfflineCandidate({...s,adapter:{...s.adapter,kind:'production'},policy,...packet(),now}),/adapter/);});
test('atomic update retains credentials and ledger; replay rejected',async t=>{
 const s=await setup(t);const r=await applyOfflineCandidate({...s,policy,...packet(),now}); assert.equal(r.status,'offline_updated');assert.equal(await fs.readlink(path.join(s.root,'current')),`releases/${r.release}`);assert.equal(s.events[0],'drain');
 assert.equal(await fs.readFile(path.join(s.root,'ledger.db'),'utf8'),'durable-ledger');assert.equal(await fs.readFile(path.join(s.root,'credentials'),'utf8'),'fake-key-only');
 await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/replay/);
});
test('failed health restores old pointer and retains high-water mark',async t=>{const s=await setup(t);s.adapter.health=async({rollback})=>rollback===true;await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/health_failed/);assert.equal(await fs.readlink(path.join(s.root,'current')),s.old);assert.equal(JSON.parse(await fs.readFile(path.join(s.root,'state.json'))).highestSequence,1);});
test('failed rollback preserves pending journal, blocks next attempt',async t=>{const s=await setup(t);s.adapter.health=async()=>false;await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/recovery_required/);await assert.rejects(applyOfflineCandidate({...s,policy,...packet({sequence:2}),now}),/recovery_required/);});
test('unresolved crash journal blocks updates',async t=>{const s=await setup(t);await fs.writeFile(path.join(s.root,'pending.json'),'{}');await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/recovery_required/);});
test('existing executor lock is never stolen',async t=>{const s=await setup(t);await fs.mkdir(path.join(s.root,'executor.lock'));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/executor_locked/);});
test('concurrent executors have one winner',async t=>{const s=await setup(t);const results=await Promise.allSettled([1,2].map(()=>applyOfflineCandidate({...s,policy,...packet(),now})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);});
test('symlinked release directory rejected',async t=>{const s=await setup(t);await fs.rename(path.join(s.root,'releases'),path.join(s.root,'elsewhere'));await fs.symlink('elsewhere',path.join(s.root,'releases'));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/unsafe_releases/);});
test('unsafe writable root rejected',async t=>{const s=await setup(t);await fs.chmod(s.root,0o777);await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/unsafe_update_root/);});
test('cannot bootstrap unreviewed initial install',async t=>{const s=await setup(t);await fs.unlink(path.join(s.root,'current'));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/bootstrap/);});
import {releaseUrl,decodeEnvelope,pullSignedRelease} from './pull.mjs';
test('only fixed public source layout accepted',()=>assert.equal(releaseUrl('https://raw.githubusercontent.com/example/picard-relay/main/releases/stable.json').hostname,'raw.githubusercontent.com'));
for(const u of ['http://raw.githubusercontent.com/example/repo/main/releases/stable.json','https://127.0.0.1/main/releases/stable.json','https://raw.githubusercontent.com/example/repo/main/releases/stable.json?token=x','https://user:pass@raw.githubusercontent.com/example/repo/main/releases/stable.json','https://raw.githubusercontent.com/example/repo/main/secret','https://raw.githubusercontent.com:8443/example/repo/main/releases/stable.json']) test(`source rejection ${u}`,()=>assert.throws(()=>releaseUrl(u)));
test('signed envelope decoded without invocation',()=>{const p=packet();const e=Buffer.from(JSON.stringify({manifest:p.manifestBytes.toString('base64'),signature:p.signature.toString('base64'),bundle:p.bundleBytes.toString('base64')}));assert.deepEqual(decodeEnvelope(e,policy,now),p);});
test('pull is opt-in before any network I/O',async()=>assert.rejects(pullSignedRelease({...policy,enabled:false}),/disabled/));
test('unconfirmed drain never force-stops or switches',async t=>{const s=await setup(t);s.adapter.quiesce=async()=>false;await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/quiesce_failed/);assert.deepEqual(s.events,[]);assert.equal(await fs.readlink(path.join(s.root,'current')),s.old);assert.ok(await fs.readFile(path.join(s.root,'pending.json')));});
test('current path cannot escape release directory',async t=>{const s=await setup(t);await fs.unlink(path.join(s.root,'current'));await fs.symlink('/tmp',path.join(s.root,'current'));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/invalid_current/);});
test('explicit administrator uid required',async t=>{const s=await setup(t);await assert.rejects(applyOfflineCandidate({...s,policy:{...policy,expectedAdministratorUid:undefined},...packet(),now}),/owner_policy/);});
test('wrong owned root rejected even mode 0700',async t=>{const s=await setup(t);await assert.rejects(applyOfflineCandidate({...s,policy:{...policy,expectedAdministratorUid:process.getuid()+1},...packet(),now}),/unsafe_update_root/);});
test('symlinked state cannot be read',async t=>{const s=await setup(t);await fs.writeFile(path.join(s.root,'other.json'),'{"highestSequence":0}');await fs.symlink('other.json',path.join(s.root,'state.json'));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}));});
test('writable state rejected',async t=>{const s=await setup(t);await fs.writeFile(path.join(s.root,'state.json'),'{"highestSequence":0}',{mode:0o666});await fs.chmod(path.join(s.root,'state.json'),0o666);await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/unsafe_owned_file/);});
test('symlink current release target rejected',async t=>{const s=await setup(t);await fs.rmdir(path.join(s.root,s.old));await fs.mkdir(path.join(s.root,'other'));await fs.symlink('../other',path.join(s.root,s.old));await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/unsafe_update_root/);});
test('administrator policy loader validates owner and ignores file uid claim',async t=>{const s=await setup(t);const file=path.join(s.root,'policy.json');await fs.writeFile(file,JSON.stringify({...policy,expectedAdministratorUid:0}),{mode:0o600});assert.equal((await loadAdministratorPolicy(file,process.getuid())).expectedAdministratorUid,process.getuid());await assert.rejects(loadAdministratorPolicy(file,process.getuid()+1),/unsafe_update_root/);});
test('administrator policy symlink rejected',async t=>{const s=await setup(t);await fs.writeFile(path.join(s.root,'real.json'),'{}');await fs.symlink('real.json',path.join(s.root,'policy.json'));await assert.rejects(loadAdministratorPolicy(path.join(s.root,'policy.json'),process.getuid()));});
test('exact manifest bytes preserved for health identity',async t=>{const s=await setup(t),p=packet();const r=await applyOfflineCandidate({...s,policy,...p,now});const stored=await fs.readFile(path.join(s.root,'releases',r.release,'manifest.json'));assert.deepEqual(stored,p.manifestBytes);assert.equal(hash(stored),r.release);});
test('corrupt monotonic state cannot bypass replay protection',async t=>{const s=await setup(t);await fs.writeFile(path.join(s.root,'state.json'),'{}',{mode:0o600});await assert.rejects(applyOfflineCandidate({...s,policy,...packet(),now}),/invalid_sequence_state/);});
