import { resolve } from 'node:path';
import { job, CLOCK } from './helpers.mjs';
import { workerSha256 } from '../src/execution-protocol.mjs';
export const HASH = () => workerSha256();
export const KEY = 'ab'.repeat(32);
export const SOURCE = 'c'.repeat(40);
export const liveJob = (id = 'live-one', changes = {}) => job(id, { timeoutMs: 30_000,
  needs: { cpuMs: 3000, ramMb: 96, diskMb: 0, gpus: 0 }, ...changes });
export const ciJob = (id = 'ci-one') => liveJob(id, { operation: 'project-checks', workload: 'project-ci',
  needs: { cpuMs: 360_000, ramMb: 4096, diskMb: 0, gpus: 0 }, input: { text: SOURCE } });
export const resource = (ci = false) => ({ id: ci ? 'github-ci' : 'oracle-worker', enabled: true,
  mode: ci ? 'project-ci' : 'vm', arch: 'x64', operations: ci ? ['project-checks'] : ['word-count', 'sha256'],
  observedAt: CLOCK, cost: { kind: ci ? 'free-public-ci' : 'permanent-free', verifiedAt: CLOCK,
    validUntil: CLOCK + 60_000, maximumIncrementalUsd: 0, evidenceRef: 'test-evidence-only' },
  capacity: { cpuMs: ci ? 720_000 : 6000, ramMb: ci ? 4096 : 128, diskMb: ci ? 0 : 1, gpus: 0, slots: 1 } });
export const provider = (ci = false) => ci ? { kind: 'github-public-ci', resource: resource(true), workerSha256: HASH(),
  tokenEnv: 'PICARD_COMPUTE_GITHUB_TOKEN', tag: 'compute-worker-v1', commitSha: SOURCE } : {
  kind: 'oracle-fixed-worker', resource: resource(), workerSha256: HASH(), keyEnv: 'PICARD_COMPUTE_ORACLE_KEY',
  ssh: { hostname: 'example.invalid', username: 'picard-compute-worker', identityFile: resolve('private-key'),
    knownHostsFile: resolve('known-hosts'), sshExecutable: resolve('ssh') } };
