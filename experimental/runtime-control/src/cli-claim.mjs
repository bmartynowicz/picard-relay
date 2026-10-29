// Process race helper: wait for a barrier file, then claim once from a
// file-backed database, then write the result as JSON and exit.
// Used only by test/process-tests.mjs, not by the service.
import { existsSync, writeFileSync } from 'node:fs';
import { createOutboxStore } from './outbox.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const dbPath = arg('--db');
const workerId = arg('--worker') || 'cli-worker';
const barrier = arg('--barrier');
const output = arg('--output');
if (!dbPath || !barrier || !output) { console.error('Usage: cli-claim.mjs --db <path> --worker <id> --barrier <path> --output <path>'); process.exit(2); }
for (let i = 0; i < 500 && !existsSync(barrier); i++) await new Promise((r) => setTimeout(r, 20));
if (!existsSync(barrier)) { console.error('barrier_timeout'); process.exit(3); }
const store = createOutboxStore({ dbPath });
const claim = store.claimNext({ workerId, claimTtlMs: 60000 });
writeFileSync(output, JSON.stringify({ workerId, claim: claim ? { request_id: claim.request_id, attempt: claim.attempt } : null }));
store.close();
