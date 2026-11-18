import { readFileSync } from 'node:fs';
import { createGitHubExecutor, EXECUTION_REPOSITORY, EXECUTION_WORKFLOW } from '../src/github-executor.mjs';
import { createOracleExecutor } from '../src/oracle-executor.mjs';
import { jobSha256, makeReceipt } from '../src/execution-protocol.mjs';
import { RESULT_MARKER } from '../src/github-job.mjs';
import { CLOCK } from './helpers.mjs';
import { ciJob, liveJob, HASH, KEY, SOURCE, provider } from './execution-helpers.mjs';
export const TOKEN = 'test-token-never-a-secret';
export const json = value => new Response(JSON.stringify(value), { status: 200 });

export function setupGitHub(overrides = {}) {
  const calls = [], p = provider(true), job = ciJob();
  const run = () => ({ id: 11, display_title: `picard-compute/${job.id}/${jobSha256(job)}`,
    head_sha: SOURCE, event: 'workflow_dispatch', path: EXECUTION_WORKFLOW, status: 'completed', conclusion: 'success', run_attempt: 1 });
  const jobs = () => ({ jobs: [{ id: 22, run_id: 11, run_attempt: 1, name: 'fixed-project-checks', labels: ['ubuntu-latest', 'X64'] }] });
  const output = () => `${RESULT_MARKER}${Buffer.from(JSON.stringify(makeReceipt(job, HASH(), 'completed', { sourceSha: SOURCE, value: 3 }))).toString('base64')}`;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (overrides.handle) { const response = await overrides.handle(String(url), options); if (response) return response; }
    if (options.method === 'POST') return new Response(null, { status: 204 });
    if (String(url).endsWith(`/repos/${EXECUTION_REPOSITORY}`)) return json({ full_name: EXECUTION_REPOSITORY, private: false, archived: false, ...overrides.repository });
    if (String(url).includes('/git/ref/')) return json({ object: { type: 'commit', sha: overrides.tagSha ?? SOURCE } });
    if (String(url).includes('/contents/')) return json({ type: 'file', path: EXECUTION_WORKFLOW, encoding: 'base64',
      content: Buffer.from(overrides.workflow ?? readFileSync(new URL('../../../.github/workflows/compute-worker.yml', import.meta.url))).toString('base64') });
    if (String(url).includes('/runs?')) return json({ workflow_runs: overrides.runs ?? [run()] });
    if (String(url).includes('/jobs?')) return json(overrides.jobs ?? jobs());
    if (String(url).endsWith('/logs')) return new Response(overrides.output ?? output());
    throw Error('unexpected_request');
  };
  const adapter = createGitHubExecutor(p, { fetchImpl, now: () => CLOCK, token: () => TOKEN });
  return { p, job, adapter, calls, run, jobs, output, fetchImpl };
}

export function setupOracle(patch = {}, handle) {
  const calls = [], p = provider(), job = liveJob();
  const run = async (command, args, options) => { calls.push({ command, args, options });
    if (handle) { const result = await handle(command, args, options); if (result) return result; }
    return { code: 0, stdout: JSON.stringify(args.at(-1).includes('identity') ? {
      schemaVersion: 1, resourceId: p.resource.id, workerSha256: HASH(), shape: 'VM.Standard.E2.1.Micro',
      architecture: 'x64', isolationVerified: true, remainingCpuMs: 6000, slots: 1, memoryAvailableBytes: 512 * 1024 * 1024, ...patch,
    } : makeReceipt(job, HASH(), 'completed', { value: 3 })) }; };
  return { calls, p, job, run, adapter: createOracleExecutor(p, { key: () => KEY, run, now: () => CLOCK }) };
}
