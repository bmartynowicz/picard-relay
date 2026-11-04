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
  for (const job of jobs) broker.submit(job);
  const results = await Promise.all(jobs.map(job => broker.run(job.id)));
  console.log(JSON.stringify({ executionMode: 'local-fixtures', realCloudProvidersExecuted: 0,
    results, replay: broker.submit(jobs[0]), resourcesAfter: broker.discover() }, null, 2));
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
