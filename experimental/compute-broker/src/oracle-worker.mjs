import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo, freemem, totalmem } from 'node:os';
import { createStore } from './store.mjs';
import { workerSha256 } from './execution-protocol.mjs';
import { readWorkerInput } from './process.mjs';
import { executeWorker, lookupWorker, validateWorkerPolicy } from './worker.mjs';

export function isolationStatus() {
  try {
    if (process.platform !== 'linux' || process.getuid() === 0 || userInfo().username !== 'picard-compute-worker') return false;
    const limits = readFileSync('/proc/self/limits', 'utf8');
    const cpu = limits.match(/^Max cpu time\s+(\d+)\s+(\d+)/m);
    const files = limits.match(/^Max open files\s+(\d+)\s+(\d+)/m);
    if (!cpu || Number(cpu[2]) > 3 || !files || Number(files[2]) > 64) return false;
    const path = readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3);
    if (!path || !path.startsWith('/') || path.split('/').includes('..')) return false;
    let current = join('/sys/fs/cgroup', path), effective = Infinity;
    for (let index = 0; index < 32; index++) {
      const value = readFileSync(join(current, 'memory.max'), 'utf8').trim();
      if (/^\d+$/.test(value)) effective = Math.min(effective, Number(value));
      if (current === '/sys/fs/cgroup') break; current = dirname(current);
    }
    return effective > 0 && effective <= 128 * 1024 * 1024;
  } catch { return false; }
}
export async function oracleIdentity(store, policy) {
  const response = await fetch('http://169.254.169.254/opc/v2/instance/', {
    headers: { Authorization: 'Bearer Oracle' }, signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw Error('worker_identity_unavailable');
  const metadata = await response.json();
  const capacity = store.effective([{ id: policy.resourceId,
    capacity: { cpuMs: policy.cpuBudgetMs, ramMb: 128, diskMb: 1, gpus: 0, slots: 1 } }])[0].capacity;
  return { schemaVersion: 1, resourceId: policy.resourceId, workerSha256: workerSha256(),
    shape: metadata.shape, architecture: process.arch, isolationVerified: isolationStatus(),
    remainingCpuMs: capacity.cpuMs, slots: capacity.slots, memoryAvailableBytes: freemem(), memoryTotalBytes: totalmem() };
}
async function main() {
  const [mode, state, policyFile] = process.argv.slice(2);
  if (!['identity', 'execute', 'lookup'].includes(mode) || !state || !policyFile || process.argv.length !== 5)
    throw Error('invalid_worker_invocation');
  const info = lstatSync(policyFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || process.platform !== 'linux'
    || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw Error('private_worker_policy_required');
  const policy = JSON.parse(readFileSync(policyFile, 'utf8')); validateWorkerPolicy(policy);
  const store = createStore(resolve(state));
  try {
    if (mode === 'identity') { console.log(JSON.stringify(await oracleIdentity(store, policy))); return; }
    const envelope = await readWorkerInput();
    const result = mode === 'lookup' ? lookupWorker(envelope, { store, policy })
      : executeWorker(envelope, { store, policy, sourceHash: workerSha256(), isolationVerified: isolationStatus() });
    console.log(JSON.stringify(result));
  } finally { store.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('worker_request_rejected'); process.exitCode = 1; });
}
