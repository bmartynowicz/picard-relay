import { fixtureResources } from '../src/fixtures.mjs';
export const CLOCK = 1_800_000_000_000;
export const registry = () => structuredClone(fixtureResources(CLOCK));
export const job = (id = 'first', changes = {}) => ({ id, operation: 'word-count', workload: 'data', arch: 'x64',
  needs: { cpuMs: 100, ramMb: 32, diskMb: 0, gpus: 0 }, input: { text: 'one two three' }, timeoutMs: 1000, ...changes });
