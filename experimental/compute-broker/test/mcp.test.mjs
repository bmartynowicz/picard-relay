import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { job } from './helpers.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
function client(t, { demo = false, database, executionProfile } = {}) {
  const directory = database ? null : mkdtempSync(join(tmpdir(), 'picard-compute-mcp-'));
  const db = database ?? join(directory, 'ledger.sqlite');
  const child = spawn(process.execPath, [...(process.execArgv.includes('--jitless') ? ['--jitless'] : []),
    join(root, 'mcp.mjs'), '--db', db, ...(demo ? ['--demo'] : []),
    ...(executionProfile ? ['--execution-profile', executionProfile] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', buffer = '', sequence = 0; const pending = new Map(), messages = [];
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    while (buffer.includes('\n')) {
      const boundary = buffer.indexOf('\n'), line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
      const parsed = JSON.parse(line); messages.push(parsed);
      pending.get(parsed.id)?.(parsed); pending.delete(parsed.id);
    }
  });
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
  t.after(async () => {
    child.stdin.end(); const timer = setTimeout(() => child.kill(), 2000);
    try { assert.equal(await exited, 0, stderr); assert.equal(buffer, ''); }
    finally { clearTimeout(timer); if (directory) rmSync(directory, { recursive: true, force: true }); }
  });
  async function request(method, params, split = false) {
    const id = ++sequence; const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP timeout: ${stderr}`)); }, 2000);
      pending.set(id, value => { clearTimeout(timer); resolve(value); });
    });
    const bytes = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    if (split) for (let index = 0; index < bytes.length; index++) child.stdin.write(bytes.subarray(index, index + 1));
    else child.stdin.write(bytes);
    return promise;
  }
  async function initialize() {
    const result = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(result.result.protocolVersion, '2025-06-18');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  return { child, messages, request, initialize, db, exited, call: (name, args) => request('tools/call', { name, arguments: args }) };
}
test('stdio session requires initialization and advertises twelve bounded tools', async t => {
  const c = client(t); assert.equal((await c.request('tools/list')).error.code, -32002);
  await c.initialize(); const listed = await c.request('tools/list'); assert.equal(listed.result.tools.length, 12);
  const contract = JSON.parse(readFileSync(join(root, 'contract.json')));
  assert.deepEqual(listed.result.tools.map(t => t.name).sort(), [...contract.tools].sort());
  assert.equal(contract.limits.batchJobs, 8); assert.equal(contract.limits.batchParallelResourceGroups, 2);
  assert.deepEqual((await c.call('compute_refresh_resources', {})).result.structuredContent.data, { executionEnabled: false, resources: [] });
  assert.equal((await c.call('compute_discover', {})).result.structuredContent.data.liveCloudExecutionEnabled, false);
  assert.equal((await c.call('compute_submit', job())).result.structuredContent.data.state, 'blocked');
  assert.equal((await c.call('compute_run', { id: 'first' })).result.structuredContent.data.state, 'blocked');
  assert.equal((await c.call('compute_collect', { id: 'first' })).result.structuredContent.data.state, 'blocked');
  const oracle = await c.call('compute_oracle_status', {});
  assert.equal(oracle.result.structuredContent.executionMode, 'read-only-oracle-inventory');
  assert.equal(oracle.result.structuredContent.data.configured, false);
});

test('MCP batch tools route first, execute explicitly, return bounded summaries and recover exact saved answers', async t => {
  const c = client(t, { demo: true }); await c.initialize();
  const jobs = [job('batch-x64'), job('batch-arm', { arch: 'arm64' })];
  const admitted = (await c.call('compute_submit_batch', { jobs })).result.structuredContent.data;
  assert.equal(admitted.executionStarted, false);
  assert.deepEqual(admitted.jobs.map(r => [r.state, r.resourceId]), [['reserved', 'fixture-x64'], ['reserved', 'fixture-arm64']]);
  const ids = jobs.map(j => j.id), reply = await c.call('compute_run_batch', { ids });
  assert.equal(reply.result.structuredContent.executionMode, 'local-fixtures');
  assert.deepEqual(reply.result.structuredContent.data.jobs.map(r => r.state), ['completed', 'completed']);
  assert.equal(reply.result.structuredContent.data.maximumParallelResources, 2);
  assert.ok(reply.result.structuredContent.data.jobs.every(r => !Object.hasOwn(r, 'result')));
  assert.equal((await c.call('compute_get', { id: ids[0] })).result.structuredContent.data.result.value, 3);
  assert.equal((await c.call('compute_run_batch', { ids })).result.structuredContent.data.jobs[0].disposition, 'unchanged');
  assert.equal((await c.call('compute_submit_batch', { jobs, command: 'nope' })).error.code, -32602);
  assert.equal((await c.call('compute_run_batch', { ids, retry: true })).error.code, -32602);
  assert.equal((await c.call('compute_submit_batch', { jobs: [jobs[0], jobs[0]] })).result.isError, true);
  assert.equal((await c.call('compute_run_batch', { ids: [ids[0], 'missing'] })).result.isError, true);
});
test('MCP demo submits, runs and retrieves one local fixture with Unicode input', async t => {
  const c = client(t, { demo: true }); await c.initialize();
  const work = job('unicode', { input: { text: 'hello 😀 café' } });
  const submitted = await c.request('tools/call', { name: 'compute_submit', arguments: work }, true);
  assert.equal(submitted.result.structuredContent.executionMode, 'local-fixtures');
  const executed = await c.call('compute_run', { id: 'unicode' });
  assert.equal(executed.result.structuredContent.data.result.value, 3);
  assert.deepEqual((await c.call('compute_get', { id: 'unicode' })).result.structuredContent.data, executed.result.structuredContent.data);
  assert.equal((await c.call('compute_submit', { ...work, input: { text: 'changed' } })).result.isError, true);
});
test('MCP rejects unknown tool arguments, commands and malformed messages', async t => {
  const c = client(t, { demo: true }); await c.initialize();
  assert.equal((await c.call('compute_run', { id: 'x', command: 'nope' })).error.code, -32602);
  assert.equal((await c.call('compute_discover', { secret: 'nope' })).error.code, -32602);
  assert.equal((await c.call('compute_ci_status', { commitSha: 'main' })).error.code, -32602);
  assert.equal((await c.call('compute_submit', job('bad', { operation: 'shell' }))).result.isError, true);
  c.child.stdin.write('not-json\n'); await c.request('ping');
  assert.ok(c.messages.some(message => message.error?.code === -32700));
  assert.equal((await c.request('unknown')).error.code, -32601);
});
test('separate MCP processes retain saved results and prevent a second invocation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-mcp-')); const db = join(directory, 'ledger.sqlite');
  // Cleanup is registered after both child shutdown hooks below.
  const first = client(t, { demo: true, database: db }); await first.initialize();
  await first.call('compute_submit', job()); const saved = (await first.call('compute_run', { id: 'first' })).result.structuredContent.data;
  first.child.stdin.end(); assert.equal(await first.exited, 0);
  const second = client(t, { demo: true, database: db }); await second.initialize();
  assert.deepEqual((await second.call('compute_run', { id: 'first' })).result.structuredContent.data, saved);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
});
test('oversized unterminated MCP input fails cleanly without double-closing the store', async t => {
  const c = client(t); c.child.stdin.write('x'.repeat(65537));
  assert.equal(await c.exited, 0); assert.equal(c.messages[0].error.message, 'Message too large');
});
test('real MCP accepts a private disabled enrollment without making providers eligible', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'picard-compute-profile-'));
  const profile = JSON.parse(readFileSync(join(root, 'execution-profile.example.json')));
  const path = join(directory, 'execution.json'); writeFileSync(path, JSON.stringify(profile), { mode: 0o600 });
  const c = client(t, { executionProfile: path }); await c.initialize();
  assert.equal((await c.call('compute_refresh_resources', {})).result.structuredContent.data.executionEnabled, false);
  const data = (await c.call('compute_discover', {})).result.structuredContent.data;
  assert.equal(data.resources.length, 2); assert.ok(data.resources.every(r => !r.enabled));
  assert.equal((await c.call('compute_submit', job())).result.structuredContent.data.state, 'blocked');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
});
