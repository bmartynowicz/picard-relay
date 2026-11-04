import { mkdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createStore } from './src/store.mjs';
import { createBroker } from './src/broker.mjs';
import { fixtureAdapters, fixtureResources } from './src/fixtures.mjs';
import { observeProjectCi, commitIdentity } from './src/github-ci.mjs';
import { createOracleObserver, oracleProbePlan } from './src/oracle-inventory.mjs';

const options = process.argv.slice(2);
let fixtureMode = false;
let oracleProfile = null;
let database = resolve('.picard-compute/ledger.sqlite');
for (let index = 0; index < options.length; index++) {
  if (options[index] === '--demo') fixtureMode = true;
  else if (options[index] === '--db' && options[index + 1]) database = resolve(options[++index]);
  else if (options[index] === '--oracle-profile' && options[index + 1]) {
    const filename = resolve(options[++index]); const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || (process.platform !== 'win32'
      && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))) throw Error('private_oracle_profile_required');
    oracleProfile = JSON.parse(readFileSync(filename, 'utf8')); oracleProbePlan(oracleProfile);
  } else throw Error('usage: node mcp.mjs [--demo] [--db PRIVATE_DIRECTORY/ledger.sqlite] [--oracle-profile PRIVATE_FILE]');
}
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const observeConfiguredOracle = createOracleObserver(oracleProfile);
const store = createStore(database);
const broker = createBroker({ store, fixtureMode,
  ...(fixtureMode ? { resources: fixtureResources, adapters: fixtureAdapters() } : {}) });

const jobSchema = { type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' },
    operation: { type: 'string', enum: ['word-count', 'sha256'] },
    workload: { type: 'string', enum: ['data', 'project-ci'] },
    arch: { type: 'string', enum: ['any', 'x64', 'arm64'] },
    needs: { type: 'object', additionalProperties: false, properties: {
      cpuMs: { type: 'integer', minimum: 1 }, ramMb: { type: 'integer', minimum: 1 },
      diskMb: { type: 'integer', minimum: 0 }, gpus: { type: 'integer', minimum: 0 },
    }, required: ['cpuMs', 'ramMb', 'diskMb', 'gpus'] },
    input: { type: 'object', additionalProperties: false,
      properties: { text: { type: 'string', maxLength: 12000 } }, required: ['text'] },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 },
  }, required: ['id', 'operation', 'workload', 'arch', 'needs', 'input', 'timeoutMs'] };
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const idSchema = { type: 'object', additionalProperties: false,
  properties: { id: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' } }, required: ['id'] };
const ciSchema = { type: 'object', additionalProperties: false,
  properties: { commitSha: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, required: ['commitSha'] };
const tools = [
  ['compute_discover', 'Read the eligible resource registry. No live cloud execution provider is enrolled.', emptySchema, true],
  ['compute_plan', 'Check eligibility and quota without reserving or executing.', jobSchema, true],
  ['compute_submit', 'Persist one exact job and reserve quota. Default mode blocks; --demo enables LOCAL FIXTURES ONLY.', jobSchema, false],
  ['compute_run', 'Execute a reserved LOCAL FIXTURE once. Cannot run cloud jobs, shell commands or generated code.', idSchema, false],
  ['compute_get', 'Read a saved job or result. No retry or provider call.', idSchema, true],
  ['compute_list', 'Read up to 100 recent jobs in this private local broker database.', emptySchema, true],
  ['compute_ci_status', 'Read live public Picard project CI status for one commit. Three bounded public GETs maximum; no token, dispatch or retry.', ciSchema, true],
  ['compute_oracle_status', 'Read fixed Oracle micro-VM inventory through an operator-configured pinned SSH profile. No execution enrollment or account billing assertion.', emptySchema, true],
].map(([name, description, inputSchema, readOnlyHint]) => ({ name, description, inputSchema,
  annotations: { readOnlyHint, destructiveHint: false, idempotentHint: true, openWorldHint: ['compute_ci_status', 'compute_oracle_status'].includes(name) } }));
let initialized = false;
let ready = false;
let pending = 0;
let ended = false;
let closed = false;
const respond = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const error = (id, code, message) => respond({ jsonrpc: '2.0', id, error: { code, message } });
function finish() { if (ended && pending === 0 && !closed) { closed = true; store.close(); } }
async function handle(message) {
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return error(null, -32600, 'Invalid request');
  if (!Object.hasOwn(message, 'id')) {
    if (message.method === 'notifications/initialized' && initialized) ready = true;
    return;
  }
  const id = message.id;
  if (!((typeof id === 'string' && id.length > 0 && id.length <= 100) || Number.isSafeInteger(id)))
    return error(null, -32600, 'Invalid request id');
  const result = value => respond({ jsonrpc: '2.0', id, result: value });
  if (message.method === 'initialize') {
    if (initialized) return error(id, -32600, 'Already initialized');
    if (typeof message.params?.protocolVersion !== 'string') return error(id, -32602, 'Missing protocol version');
    initialized = true;
    return result({ protocolVersion: '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'picard-compute-broker-preview', version: '0.1.0' },
      instructions: 'Workload execution is disabled by default; --demo uses local fixtures. Status tools can read public project CI and run one fixed read-only Oracle inventory probe over an explicitly configured SSH connection. No caller commands, generated-code jobs or paid fallback.' });
  }
  if (!ready) return error(id, -32002, 'Initialize the session first');
  if (message.method === 'ping') return result({});
  if (message.method === 'tools/list') return result({ tools });
  if (message.method !== 'tools/call') return error(id, -32601, 'Method not found');
  const name = message.params?.name;
  const args = message.params?.arguments ?? {};
  const tool = tools.find(item => item.name === name);
  if (!tool) return error(id, -32602, 'Unknown tool');
  if (!args || Array.isArray(args) || typeof args !== 'object') return error(id, -32602, 'Invalid arguments');
  if (tool.inputSchema === emptySchema && Object.keys(args).length !== 0) return error(id, -32602, 'Unexpected arguments');
  if (tool.inputSchema === idSchema && (Object.keys(args).length !== 1 || !Object.hasOwn(args, 'id')))
    return error(id, -32602, 'Only job id is accepted');
  if (tool.inputSchema === ciSchema && (Object.keys(args).length !== 1 || !commitIdentity(args.commitSha)))
    return error(id, -32602, 'Only a 40-character lowercase commit SHA is accepted');
  try {
    const data = name === 'compute_discover' ? broker.discover()
      : name === 'compute_plan' ? broker.plan(args)
      : name === 'compute_submit' ? broker.submit(args)
      : name === 'compute_run' ? await broker.run(args.id)
      : name === 'compute_get' ? broker.get(args.id)
      : name === 'compute_ci_status' ? await observeProjectCi(args.commitSha)
      : name === 'compute_oracle_status' ? await observeConfiguredOracle() : broker.list();
    return result({ content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: { executionMode: name === 'compute_ci_status' ? 'read-only-project-ci'
        : name === 'compute_oracle_status' ? 'read-only-oracle-inventory' : fixtureMode ? 'local-fixtures' : 'disabled', data } });
  } catch (failure) {
    const known = ['invalid_job', 'unknown_job_field', 'invalid_job_id', 'job_not_found', 'job_identity_conflict',
      'invalid_commit_sha', 'project_ci_unavailable', 'project_ci_response_too_large', 'public_project_required', 'invalid_project_ci_response',
      'invalid_oracle_profile', 'oracle_inventory_unavailable', 'invalid_oracle_inventory'];
    return result({ isError: true, content: [{ type: 'text', text: known.includes(failure.message) ? failure.message : 'broker_operation_failed' }] });
  }
}
const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk);
  let boundary;
  while ((boundary = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 1);
    if (Buffer.byteLength(line, 'utf8') > 65_536) { error(null, -32600, 'Message too large'); continue; }
    let message;
    try { message = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); continue; }
    if (pending >= 16) { error(message?.id ?? null, -32000, 'Too many pending requests'); continue; }
    pending++;
    handle(message).catch(() => error(message?.id ?? null, -32603, 'Internal error')).finally(() => { pending--; finish(); });
  }
  if (Buffer.byteLength(buffer, 'utf8') > 65_536) {
    error(null, -32600, 'Message too large'); buffer = ''; process.stdin.destroy(); ended = true; finish();
  }
});
process.stdin.on('end', () => { buffer += decoder.end(); ended = true; if (buffer.trim()) error(null, -32700, 'Incomplete message'); finish(); });
process.stdin.resume();
