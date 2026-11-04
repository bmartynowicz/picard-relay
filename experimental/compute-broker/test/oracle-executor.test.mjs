import test from 'node:test';
import assert from 'node:assert/strict';
import { createOracleExecutor } from '../src/oracle-executor.mjs';
import { makeReceipt, PreflightDenied, verifyGrant } from '../src/execution-protocol.mjs';
import { CLOCK } from './helpers.mjs';
import { provider, HASH, KEY, liveJob } from './execution-helpers.mjs';
function setup(patch = {}, handle) {
  const calls = [], p = provider(), job = liveJob();
  const run = async (command, args, options) => { calls.push({ command, args, options });
    if (handle) { const result = await handle(command, args, options); if (result) return result; }
    return { code: 0, stdout: JSON.stringify(args.at(-1).includes('identity') ? {
      schemaVersion: 1, resourceId: p.resource.id, workerSha256: HASH(), shape: 'VM.Standard.E2.1.Micro',
      architecture: 'x64', isolationVerified: true, remainingCpuMs: 6000, slots: 1, memoryAvailableBytes: 512 * 1024 * 1024, ...patch,
    } : makeReceipt(job, HASH(), 'completed', { value: 3 })) }; };
  return { calls, p, job, run, adapter: createOracleExecutor(p, { key: () => KEY, run, now: () => CLOCK }) };
}
test('Oracle execution uses pinned dedicated identity, fixed commands and exact signed grant', async () => {
  const s = setup(); assert.equal((await s.adapter.execute(s.job, { mayDispatch: () => true })).state, 'completed'); assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].args.at(-1), 'picard-compute-identity-v1'); assert.equal(s.calls[1].args.at(-1), 'picard-compute-execute-v1');
  assert.ok(s.calls[1].args.includes('StrictHostKeyChecking=yes')); assert.ok(s.calls[1].args.includes('ForwardAgent=no'));
  const sent = JSON.parse(s.calls[1].options.input); assert.deepEqual(sent.job, s.job);
  assert.equal(verifyGrant(sent.grant, sent.job, { resourceId: s.p.resource.id, workerHash: HASH(), keyHex: KEY, now: CLOCK }), true);
  assert.throws(() => createOracleExecutor({ ...s.p, ssh: { ...s.p.ssh, username: 'opc' } }), /invalid_oracle_execution_profile/);
});
test('Oracle isolation, shape, available memory and finite worker budget fail before execution', async () => {
  for (const patch of [{ isolationVerified: false }, { shape: 'paid-shape' }, { remainingCpuMs: 0 }, { slots: 0 },
    { memoryAvailableBytes: 1 }, { memoryAvailableBytes: '999999999' }, { memoryAvailableBytes: null }]) {
    const s = setup(patch); await assert.rejects(s.adapter.execute(s.job, { mayDispatch: () => true }), PreflightDenied);
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].args.at(-1), 'picard-compute-identity-v1');
  }
  const s = setup(); s.p.resource.cost.kind = 'trial'; await assert.rejects(s.adapter.execute(s.job, { mayDispatch: () => true }), PreflightDenied); assert.equal(s.calls.length, 0);
});
test('Oracle unknown transport is not retried; saved lookup is a separate command and can read after cost expiry', async () => {
  const s = setup({}, (command, args) => { if (args.at(-1).includes('execute')) throw Error('lost'); });
  await assert.rejects(s.adapter.execute(s.job, { mayDispatch: () => true }), /lost/); assert.equal(s.calls.length, 2);
  s.p.resource.cost.validUntil = CLOCK; assert.equal((await s.adapter.lookup(s.job)).state, 'completed');
  assert.equal(s.calls.at(-1).args.at(-1), 'picard-compute-lookup-v1'); assert.equal(s.calls.length, 3);
});
test('Oracle preflight cancellation cannot start a late execution', async () => {
  const controller = new AbortController(); const s = setup({}, () => { controller.abort(); });
  await assert.rejects(s.adapter.execute(s.job, { signal: controller.signal, mayDispatch: () => true }), PreflightDenied); assert.equal(s.calls.length, 1);
  const expired = setup(); await assert.rejects(expired.adapter.execute(expired.job, { mayDispatch: () => false }), PreflightDenied);
  assert.equal(expired.calls.length, 1);
});
