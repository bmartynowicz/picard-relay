import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './src/store.mjs';
import { createBroker } from './src/broker.mjs';
import { fixtureResources, fixtureAdapters } from './src/fixtures.mjs';

const directory = mkdtempSync(join(tmpdir(), 'picard-compute-demo-'));
const store = createStore(join(directory, 'demo.sqlite'));
try {
  const broker = createBroker({ store, resources: fixtureResources, adapters: fixtureAdapters(), fixtureMode: true });
  const jobs = ['x64', 'arm64'].map(arch => ({ id: `example-${arch}`, operation: 'word-count',
    workload: 'data', arch, needs: { cpuMs: 100, ramMb: 32, diskMb: 0, gpus: 0 },
    input: { text: 'A small broker with durable results' }, timeoutMs: 1000 }));
  const routes = broker.submitBatch(jobs).map(({ id, state, resourceId }) => ({ id, state, resourceId }));
  const batch = await broker.runBatch(jobs.map(job => job.id));
  const results = jobs.map(job => broker.get(job.id));
  console.log(JSON.stringify({ executionMode: 'local-fixtures', realCloudProvidersExecuted: 0,
    routes, batch, results, replay: broker.submit(jobs[0]), resourcesAfter: broker.discover() }, null, 2));
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
