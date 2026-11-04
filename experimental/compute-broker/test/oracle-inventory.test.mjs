import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { observeOracle, oracleProbePlan, ORACLE_PROBE, createOracleObserver } from '../src/oracle-inventory.mjs';
const profile = () => ({ hostname: 'example.invalid', username: 'opc', identityFile: resolve('private-key'),
  knownHostsFile: resolve('known-hosts'), sshExecutable: resolve('ssh') });
const metrics = () => ({ shape: 'VM.Standard.E2.1.Micro', architecture: 'x86_64', region: 'iad', availabilityDomain: 'scope:US-ASHBURN-AD-3',
  logicalCpus: 2, memoryTotalBytes: 1000, memoryAvailableBytes: 500, diskTotalBytes: 2000, diskFreeBytes: 1000 });
test('unconfigured Oracle observer cannot open a connection', async () => {
  const result = await observeOracle(null, { runProbe: () => { throw Error('must_not_run'); } });
  assert.equal(result.configured, false); assert.equal(result.dispatchEnabled, false);
});
test('SSH plan pins the host, disables forwarding/config/agent and permits only the fixed probe', () => {
  const result = oracleProbePlan(profile());
  for (const option of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'ForwardAgent=no', 'ClearAllForwardings=yes', 'IdentityAgent=none', 'ConnectionAttempts=1'])
    assert.ok(result.args.includes(option));
  assert.equal(result.args.at(-1), '/usr/bin/python3 -'); assert.equal(result.input, ORACLE_PROBE);
  assert.equal(result.args[0], '-F');
});
test('profile injection and arbitrary commands fail before invoking SSH', async () => {
  for (const patch of [{ hostname: '-oProxyCommand=bad' }, { hostname: 'host;command' }, { username: 'opc command' },
    { identityFile: 'relative' }, { knownHostsFile: 'bad\nfile' }, { sshExecutable: 'ssh' }, { command: 'arbitrary' }]) {
    await assert.rejects(observeOracle({ ...profile(), ...patch }, { runProbe: () => { throw Error('must_not_run'); } }), /invalid_oracle_profile/);
  }
});
test('capacity observation is explicit read-only data, never free-quota or execution permission', async () => {
  const result = await observeOracle(profile(), { runProbe: async () => JSON.stringify(metrics()), now: () => 100 });
  assert.equal(result.observedAt, 100); assert.equal(result.resource.architecture, 'x64');
  assert.equal(result.resource.observedCapacity.logicalCpus, 2); assert.equal(result.accountQuota, null);
  assert.equal(result.costVerification, 'unknown'); assert.equal(result.dispatchEnabled, false);
  assert.equal(Object.hasOwn(result, 'hostname'), false); assert.equal(Object.hasOwn(result, 'identityFile'), false);
});
test('malformed, oversized or unavailable probes stop without retry or raw transport errors', async () => {
  for (const response of ['invalid', 'x'.repeat(16385)])
    await assert.rejects(observeOracle(profile(), { runProbe: async () => response }), /^Error: oracle_inventory_unavailable$/);
  let calls = 0;
  await assert.rejects(observeOracle(profile(), { runProbe: async () => { calls++; throw Error('private SSH detail'); } }), /^Error: oracle_inventory_unavailable$/);
  assert.equal(calls, 1);
});
test('wrong machine type, numeric strings and inconsistent capacity are rejected', async () => {
  for (const patch of [{ shape: 'paid-gpu' }, { architecture: 'arm64' }, { logicalCpus: '2' }, { memoryAvailableBytes: 1001 },
    { diskFreeBytes: 2001 }, { region: '../other' }, { logicalCpus: NaN }])
    await assert.rejects(observeOracle(profile(), { runProbe: async () => JSON.stringify({ ...metrics(), ...patch }) }), /invalid_oracle_inventory/);
});
test('concurrent status requests share one probe and a later request performs a fresh read', async () => {
  let calls = 0;
  const observer = createOracleObserver(profile(), { runProbe: async () => {
    calls++; await new Promise(resolve => setImmediate(resolve)); return JSON.stringify(metrics());
  } });
  const results = await Promise.all(Array.from({ length: 10 }, () => observer()));
  assert.equal(calls, 1); assert.ok(results.every(result => result === results[0]));
  await observer(); assert.equal(calls, 2);
});
