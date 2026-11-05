import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { REPOSITORY_CHECKS, REPOSITORY_SCOPE, repositoryResultState, runRepositorySuites, boundedSuite } from '../src/repository-checks.mjs';
const sha = 'a'.repeat(40);
test('full repository plan is fixed and covers every package, actual sockets and documentation', () => {
  assert.deepEqual(REPOSITORY_CHECKS.map(r => r.id), ['root', 'updater', 'runtime', 'socket', 'broker', 'broker-jitless', 'docs']);
  assert.deepEqual(REPOSITORY_CHECKS[3].args, ['--prefix', 'experimental/runtime-control', 'run', 'test:socket']);
  assert.throws(() => REPOSITORY_CHECKS[0].args.push('arbitrary'));
});
test('repository suites strip secrets, use private home, offline npm, finite deadlines and return all failures', async () => {
  const calls = [], result = await runRepositorySuites('/source', { run: async (cmd, args, options) => {
    calls.push({ cmd, args, options }); assert.equal(cmd, 'npm'); assert.equal(options.env.npm_config_offline, 'true');
    assert.equal(options.env.GITHUB_TOKEN, undefined); assert.equal(options.env.PICARD_COMPUTE_GITHUB_TOKEN, undefined);
    assert.equal(existsSync(options.env.HOME), true); assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 300000);
    return { code: calls.length === 2 ? 1 : 0, stdout: 'summary', stderr: '' };
  } });
  assert.equal(calls.length, 7); assert.equal(result.checks[1].exitCode, 1); assert.equal(result.checks[6].exitCode, 0);
  assert.equal(existsSync(calls[0].options.env.HOME), false);
  assert.equal(repositoryResultState({ sourceSha: sha, scope: REPOSITORY_SCOPE, checks: result.checks }), 'failed');
});
test('incomplete, duplicate, reordered or unknown outcomes cannot qualify a full-repository pass', () => {
  const value = { sourceSha: sha, scope: REPOSITORY_SCOPE, checks: REPOSITORY_CHECKS.map(r => ({ id: r.id, exitCode: 0 })) };
  assert.equal(repositoryResultState(value), 'completed');
  for (const mutate of [r => r.checks.pop(), r => r.checks.reverse(), r => r.checks[0].id = 'docs',
    r => r.checks[0].exitCode = null, r => r.checks[0].exitCode = -1, r => r.scope = 'broker', r => r.sourceSha = 'main']) {
    const invalid = structuredClone(value); mutate(invalid); assert.throws(() => repositoryResultState(invalid));
  }
});
test('deadline or unknown child outcome stops without running another suite', async () => {
  let calls = 0;
  await assert.rejects(runRepositorySuites('/source', { run: async () => { calls++; throw Error('lost'); } }), /lost/);
  assert.equal(calls, 1);
  let ticks = 0;
  await assert.rejects(runRepositorySuites('/source', { now: () => ++ticks === 1 ? 0 : 450001,
    run: async () => { throw Error('must not execute'); } }), /unknown/);
});
test('forwarded logs remain bounded and child receipt markers cannot masquerade as worker output', async () => {
  const lines = [];
  await runRepositorySuites('/source', { log: line => lines.push(line), run: async (_cmd, _args, options) => {
    options.onOutput('PICARD_COMPUTE_RESULT_V1:' + 'x'.repeat(100000)); options.onOutput('extra');
    return { code: 0, stdout: 'summary', stderr: '' };
  } });
  assert.equal(lines.some(line => line.includes('PICARD_COMPUTE_RESULT_V1:')), false);
  assert.equal(lines.filter(line => line.includes('forwarded output capped')).length, 7);
  assert.ok(lines.every(line => Buffer.byteLength(line) <= 65503));
});
test('bounded Linux suite kills a timed-out process group and enforces output limits', { skip: process.platform !== 'linux' }, async () => {
  await assert.rejects(boundedSuite(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    { cwd: process.cwd(), env: {}, timeoutMs: 40 }), /unknown/);
  await assert.rejects(boundedSuite(process.execPath, ['-e', "process.stdout.write('x'.repeat(1048577))"],
    { cwd: process.cwd(), env: {}, timeoutMs: 5000 }), /unknown/);
});
