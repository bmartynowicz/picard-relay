// Offline candidate. No CLI, listener, scheduler, shell commands or live adapter.
import { createHash, verify, createPublicKey, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
const MAX = 2 * 1024 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');
const fail = code => { throw new Error(code); };
const safePath = p => typeof p === 'string' && /^src\/[a-z][a-z0-9-]*\.mjs$/.test(p);
async function durable(file, bytes) { const h = await fs.open(file, 'wx', 0o600); try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); } }
async function syncDir(dir) { const h = await fs.open(dir, 'r'); try { await h.sync(); } finally { await h.close(); } }
async function trustedFile(file, uid, limit=16384) {
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {const s=await h.stat();if(!s.isFile()||s.uid!==uid||(s.mode&0o022)||s.size>limit)fail('unsafe_owned_file');return await h.readFile();}finally{await h.close();}
}
async function json(file, fallback, uid) { try { return JSON.parse(await trustedFile(file,uid)); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } }
export async function loadAdministratorPolicy(file, expectedAdministratorUid=0) {
 if(!Number.isSafeInteger(expectedAdministratorUid)||expectedAdministratorUid<0)fail('owner_policy_required');
 await rootCheck(path.dirname(file),expectedAdministratorUid);
 const policy=JSON.parse(await trustedFile(file,expectedAdministratorUid));
 // UID is established by the privileged wrapper, not by policy-file content.
 return {...policy,expectedAdministratorUid};
}
async function atomicJson(root, name, value) { const tmp = path.join(root, `.${randomUUID()}`); await durable(tmp, JSON.stringify(value)); await fs.rename(tmp, path.join(root, name)); await syncDir(root); }
async function pointer(root, target) { const tmp = path.join(root, `.link-${randomUUID()}`); await fs.symlink(target, tmp); await fs.rename(tmp, path.join(root, 'current')); await syncDir(root); }
async function current(root, uid) { try { const s = await fs.lstat(path.join(root,'current')); if(!s.isSymbolicLink()) fail('current_not_symlink'); if(s.uid!==uid) fail('unsafe_current_owner'); const p = await fs.readlink(path.join(root,'current')); if(!/^releases\/[a-f0-9]{64}$/.test(p)) fail('invalid_current'); await rootCheck(path.join(root,p),uid); return p; } catch(e) { if(e.code === 'ENOENT') return null; throw e; } }
async function rootCheck(root, uid) { const s = await fs.lstat(root); if(!s.isDirectory() || s.isSymbolicLink() || s.uid!==uid || (s.mode & 0o022)) fail('unsafe_update_root'); }
export function validate(manifestBytes, signature, bundleBytes, policy, now = Date.now()) {
  if(!Buffer.isBuffer(manifestBytes) || manifestBytes.length > 16384 || !Buffer.isBuffer(bundleBytes) || bundleBytes.length > MAX) fail('size_limit');
  const key = createPublicKey(policy.publisherKey);
  if(key.asymmetricKeyType !== 'ed25519' || !verify(null, manifestBytes, key, signature)) fail('bad_signature');
  const m = JSON.parse(manifestBytes.toString('utf8'));
  if(m.format !== 1 || m.product !== 'picard-relay' || m.channel !== policy.channel || !Number.isSafeInteger(m.sequence) || m.sequence < 1 || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(m.version)) fail('manifest_invalid');
  if(!Number.isSafeInteger(m.expiresAt) || m.expiresAt <= now || m.expiresAt > now + 7*86400000) fail('manifest_expired_or_excessive');
  if(m.nodeMajor !== 24 || m.stateSchema !== policy.stateSchema || m.migration !== 'none') fail('runtime_or_schema_mismatch');
  if(m.bundleSha256 !== sha(bundleBytes)) fail('bundle_hash_mismatch');
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  if(!Array.isArray(bundle.files) || !Array.isArray(m.files) || bundle.files.length < 1 || bundle.files.length > 32 || m.files.length !== bundle.files.length) fail('files_invalid');
  const allowed = new Set(policy.allowedFiles); const seen = new Set(); let total = 0;
  const files = bundle.files.map((f, i) => {
    const spec = m.files[i];
    if(!safePath(f.path) || !allowed.has(f.path) || seen.has(f.path) || spec.path !== f.path) fail('path_not_allowed');
    seen.add(f.path);
    if(typeof f.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64)) fail('invalid_encoding');
    const bytes = Buffer.from(f.base64,'base64'); total += bytes.length;
    if(bytes.length > 256*1024 || total > MAX || spec.sha256 !== sha(bytes) || spec.bytes !== bytes.length) fail('file_integrity');
    return {path:f.path, bytes};
  });
  if(policy.allowedFiles.some(p => !seen.has(p))) fail('incomplete_runtime');
  return {manifest:m, files, release:sha(manifestBytes)};
}
export async function applyOfflineCandidate({root, policy, manifestBytes, signature, bundleBytes, adapter, now}) {
  // Caller supplies a local TEST adapter. Production plumbing intentionally absent.
  if(policy.enabled !== true || adapter?.kind !== 'offline-test') fail('disabled_or_no_reviewed_adapter');
  const uid=policy.expectedAdministratorUid;
  if(!Number.isSafeInteger(uid)||uid<0)fail('owner_policy_required');
  await rootCheck(root,uid);
  const lock = path.join(root,'executor.lock');
  try { await fs.mkdir(lock, {mode:0o700}); } catch(e) { if(e.code === 'EEXIST') fail('executor_locked'); throw e; }
  try {
    await rootCheck(lock,uid);
    if(await json(path.join(root,'pending.json'),null,uid)) fail('recovery_required');
    const v = validate(manifestBytes,signature,bundleBytes,policy,now);
    const state = await json(path.join(root,'state.json'), {highestSequence:0},uid);
    if(!Number.isSafeInteger(state.highestSequence)||state.highestSequence<0)fail('invalid_sequence_state');
    if(v.manifest.sequence <= state.highestSequence) fail('replay_or_downgrade');
    const old = await current(root,uid); if(!old) fail('bootstrap_required');
    const releases = path.join(root,'releases'); const st = await fs.lstat(releases); if(!st.isDirectory() || st.isSymbolicLink() || st.uid!==uid || (st.mode & 0o022)) fail('unsafe_releases');
    const stage = path.join(releases,`.stage-${randomUUID()}`); await fs.mkdir(stage,{mode:0o700});
    try {
      await fs.mkdir(path.join(stage,'src'),{mode:0o700});
      await durable(path.join(stage,'manifest.json'),manifestBytes); await fs.chmod(path.join(stage,'manifest.json'),0o444);
      for(const f of v.files) { await durable(path.join(stage,f.path),f.bytes); await fs.chmod(path.join(stage,f.path),0o444); }
      await syncDir(path.join(stage,'src')); await fs.chmod(path.join(stage,'src'),0o555); await syncDir(stage); await fs.chmod(stage,0o555);
      await fs.rename(stage,path.join(releases,v.release)); await syncDir(releases);
    } catch(e) { await fs.rm(stage,{recursive:true,force:true}); throw e; }
    const target = `releases/${v.release}`;
    // Journal precedes stop/switch. Sequence consumed even on rollback, preventing replay.
    await atomicJson(root,'pending.json',{old,target,sequence:v.manifest.sequence});
    await atomicJson(root,'state.json',{highestSequence:v.manifest.sequence});
    // Never force-stop an unconfirmed drain: preserve journal and old pointer.
    // Production must bound this operation and explicitly resolve in-flight calls.
    if(await adapter.quiesce() !== true) fail('quiesce_failed_recovery_required');
    try {
      await pointer(root,target); await adapter.start(target);
      if(await adapter.health({release:v.release, noProviderCalls:true}) !== true) fail('health_failed');
      await fs.unlink(path.join(root,'pending.json')); await syncDir(root);
      return {status:'offline_updated',version:v.manifest.version,release:v.release};
    } catch(e) {
      // Stop must succeed before restoring code, or leave journal for manual recovery.
      try { await adapter.stop(); await pointer(root,old); await adapter.start(old); if(await adapter.health({rollback:true,noProviderCalls:true}) !== true) fail('rollback_health_failed'); await fs.unlink(path.join(root,'pending.json')); await syncDir(root); }
      catch { fail('recovery_required'); }
      throw e;
    }
  } finally { await fs.rmdir(lock); }
}
