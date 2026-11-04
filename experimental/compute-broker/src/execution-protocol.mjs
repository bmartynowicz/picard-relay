import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeJob } from './job.mjs';
import { identity, integer, object } from './policy.mjs';

export const hex256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const jobSha256 = job => sha256(JSON.stringify(normalizeJob(job)));
export const WORKER_FILES = Object.freeze(['policy.mjs', 'job.mjs', 'receipt.mjs', 'execution-protocol.mjs',
  'store.mjs', 'worker.mjs', 'oracle-worker.mjs', 'github-job.mjs', 'process.mjs']);
export function workerSha256() {
  return sha256(WORKER_FILES.map(path => {
    const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replaceAll('\r\n', '\n');
    return `${path}\0${Buffer.byteLength(text)}\0${text}`;
  }).join('\0'));
}
export class PreflightDenied extends Error { constructor() { super('execution_preflight_denied'); } }

export function makeReceipt(job, sourceHash, state, result = null, reason = '', logs = []) {
  const artifacts = [];
  if (result !== null && ['completed', 'failed'].includes(state)) {
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > 4096) throw Error('worker_result_too_large');
    artifacts.push({ name: 'result.json', mediaType: 'application/json', byteLength: Buffer.byteLength(text), sha256: sha256(text), text });
  }
  return { schemaVersion: 1, jobId: job.id, jobSha256: jobSha256(job), workerSha256: sourceHash,
    state, result, reason, logs, artifacts };
}
function grantPayload(job, resourceId, sourceHash, expiresAt) {
  return { schemaVersion: 1, resourceId, jobId: job.id, jobSha256: jobSha256(job), workerSha256: sourceHash, expiresAt };
}
export function signGrant(job, { resourceId, workerHash, expiresAt, keyHex }) {
  if (!identity(resourceId) || !hex256(workerHash) || !hex256(keyHex) || !integer(expiresAt, 1)) throw Error('invalid_worker_grant');
  const payload = grantPayload(normalizeJob(job), resourceId, workerHash, expiresAt);
  return { ...payload, signature: createHmac('sha256', Buffer.from(keyHex, 'hex')).update(JSON.stringify(payload)).digest('hex') };
}
export function verifyGrant(grant, job, { resourceId, workerHash, keyHex, now, recovery = false }) {
  try {
    if (!object(grant) || Object.keys(grant).sort().join(',') !== 'expiresAt,jobId,jobSha256,resourceId,schemaVersion,signature,workerSha256'
      || !hex256(grant.signature) || !integer(grant.expiresAt, 1) || !integer(now, 1)
      || (!recovery && (grant.expiresAt <= now || grant.expiresAt > now + 1_800_000))) return false;
    const expected = signGrant(job, { resourceId, workerHash, keyHex, expiresAt: grant.expiresAt });
    return ['schemaVersion', 'resourceId', 'jobId', 'jobSha256', 'workerSha256', 'expiresAt'].every(key => grant[key] === expected[key])
      && timingSafeEqual(Buffer.from(grant.signature, 'hex'), Buffer.from(expected.signature, 'hex'));
  } catch { return false; }
}
export function fixedOperation(job) {
  if (job.operation === 'word-count') return { operation: job.operation,
    value: job.input.text.trim() ? job.input.text.trim().split(/\s+/u).length : 0 };
  if (job.operation === 'sha256') return { operation: job.operation, value: sha256(job.input.text) };
  throw Error('unsupported_worker_operation');
}
