// Runnable service entry point, disabled by default.
// Usage, local test mode only:
//   BRIDGE_ENABLED=true BRIDGE_LOCAL_TEST_MODE=true BRIDGE_DB_PATH=./bridge.db node src/service.mjs
// Production mode (BRIDGE_PRODUCTION=true) rejects synthetic adapters,
// blocked real adapters, missing scope enforcement, and :memory: storage
// at startup, before any claim. See dispatcher.mjs.
// Logs are redacted: requestId, attempt, status and error code only.
// No request text, no reply body, no credential, no key material.
import { existsSync } from 'node:fs';
import { createOutboxStore } from './outbox.mjs';
import { createLocalBoardAdapter, createSyntheticAssistantAdapter, createRealBoardAdapter, createRealAssistantAdapter } from './adapters.mjs';
import { createDispatcher, loadBridgeConfig } from './dispatcher.mjs';

const config = loadBridgeConfig(process.env);
const log = (obj) => console.log(JSON.stringify({ time: new Date().toISOString(), ...obj }));

if (!config.enabled) {
  log({ status: 'disabled', message: 'Bridge service started disabled. Claiming no work.' });
  process.exit(0);
}

let boardAdapter;
let assistantAdapter;
if (config.localTestMode && !config.production) {
  boardAdapter = null;
  assistantAdapter = null;
} else {
  boardAdapter = createRealBoardAdapter();
  assistantAdapter = createRealAssistantAdapter();
}

const store = createOutboxStore({ dbPath: config.dbPath });
if (config.localTestMode && !config.production) {
  boardAdapter = createLocalBoardAdapter(store, { scopeCheck: () => ({ revoked: false, expiresAt: null }) });
  assistantAdapter = createSyntheticAssistantAdapter({ enabledForLocalTestOnly: true });
}

let dispatcher;
try {
  dispatcher = createDispatcher({
    store, boardAdapter, assistantAdapter, workerId: config.workerId,
    claimTtlMs: config.claimTtlMs, enabled: true, production: config.production,
    dbPath: config.dbPath,
  });
} catch (e) {
  log({ status: 'startup_blocked', code: e.code || 'startup_error', message: e.message });
  process.exit(2);
}

let stopping = false;
const shutdown = (signal) => { if (!stopping) { stopping = true; log({ status: 'shutdown', signal }); } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

log({ status: 'started', workerId: config.workerId, production: config.production, dbPath: config.dbPath === ':memory:' ? 'memory' : 'file' });
while (!stopping) {
  if (config.stopPath && existsSync(config.stopPath)) { log({ status: 'stopped', reason: 'stop_file_present' }); break; }
  try {
    const result = await dispatcher.runOnce();
    if (result.status !== 'idle') log(result);
  } catch (e) {
    log({ status: 'loop_error', message: e.message });
  }
  if (stopping) break;
  await new Promise((r) => setTimeout(r, config.pollIntervalMs));
}
store.close();
log({ status: 'exited' });
process.exit(0);
