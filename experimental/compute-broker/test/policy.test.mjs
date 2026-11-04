import test from 'node:test';
import assert from 'node:assert/strict';
import { selectResource } from '../src/policy.mjs';
import { CLOCK, registry, job } from './helpers.mjs';
const select = (resources, work = job(), clock = CLOCK) => selectResource(resources, work, clock);

test('selects lexically, honors architecture, and never mutates inputs', () => {
  const resources = registry().reverse(), work = job('any', { arch: 'any' });
  const before = JSON.stringify({ resources, work });
  assert.equal(select(resources, work).resourceId, 'fixture-arm64');
  assert.equal(select(resources).resourceId, 'fixture-x64');
  assert.equal(JSON.stringify({ resources, work }), before);
});
test('duplicate identity rejects the whole registry, including the first occurrence', () => {
  const resources = registry(); resources.push(structuredClone(resources[1]));
  assert.equal(select(resources).resourceId, null);
  assert.deepEqual(select(resources).decisions[0].reasons, ['duplicate_resource_identity']);
});
test('CI-only resources cannot receive data jobs; VM can run an allowed CI job', () => {
  const resource = registry()[1]; resource.mode = 'project-ci'; resource.cost.kind = 'free-public-ci';
  assert.equal(select([resource]).resourceId, null);
  assert.equal(select([resource], job('ci', { workload: 'project-ci' })).resourceId, resource.id);
  assert.equal(select(registry(), job('ci', { workload: 'project-ci' })).resourceId, 'fixture-x64');
});
test('strict job numbers reject coercion, fractions, missing and unsafe values', () => {
  for (const value of ['100', 0.5, NaN, Infinity, -1, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const work = job(); work.needs.cpuMs = value;
    assert.equal(select(registry(), work).resourceId, null, String(value));
  }
  for (const clock of [0, -1, NaN, '1800000000000']) assert.equal(select(registry(), job(), clock).resourceId, null);
});
test('malformed registries and entries fail closed without throwing', () => {
  for (const resources of [null, {}, [null], [3], [{ id: '../bad' }], Array(65).fill(null)])
    assert.equal(select(resources).resourceId, null);
  for (const capacity of [null, {}, { cpuMs: '1000', ramMb: 32, diskMb: 0, gpus: 0, slots: 1 }]) {
    const resource = registry()[1]; resource.capacity = capacity;
    assert.equal(select([resource]).resourceId, null);
  }
});
test('only explicit current zero-cost evidence is eligible', () => {
  for (const patch of [{ kind: 'trial' }, { kind: 'paid' }, { kind: 'unknown' }, { maximumIncrementalUsd: '0' },
    { maximumIncrementalUsd: 0.01 }, { evidenceRef: '' }, { validUntil: CLOCK },
    { verifiedAt: CLOCK + 1 }, { verifiedAt: CLOCK - 86_400_001 }, { kind: 'free-public-ci' }]) {
    const resource = registry()[1]; Object.assign(resource.cost, patch);
    assert.equal(select([resource]).resourceId, null, JSON.stringify(patch));
  }
});
test('observation boundaries, exact capacity and slot availability are enforced', () => {
  const resource = registry()[1]; resource.observedAt = CLOCK - 60_000;
  resource.capacity = { ...job().needs, slots: 1 };
  assert.equal(select([resource]).resourceId, resource.id);
  for (const observedAt of [CLOCK - 60_001, CLOCK + 1, '1800000000000']) {
    resource.observedAt = observedAt; assert.equal(select([resource]).resourceId, null);
  }
  resource.observedAt = CLOCK; resource.capacity.slots = 0;
  assert.equal(select([resource]).resourceId, null);
});
test('disabled, unsupported operations and invalid architecture are ineligible', () => {
  for (const patch of [{ enabled: 'true' }, { operations: null }, { operations: ['word-count', 4] },
    { operations: ['word-count', 'word-count'] }, { operations: ['sha256'] }, { arch: 'gpu' }]) {
    const resource = Object.assign(registry()[1], patch); assert.equal(select([resource]).resourceId, null);
  }
});
