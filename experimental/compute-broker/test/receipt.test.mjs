import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt } from '../src/receipt.mjs';
import { makeReceipt, jobSha256, sha256 } from '../src/execution-protocol.mjs';
import { liveJob, HASH } from './execution-helpers.mjs';
const work = liveJob(), expected = () => ({ jobId: work.id, jobSha256: jobSha256(work), workerSha256: HASH() });
const good = () => makeReceipt(work, HASH(), 'completed', { value: 3 });
test('receipt binds exact job and worker, validates artifact bytes/hash and does not mutate', () => {
  const r = good(), before = structuredClone(r); assert.equal(validateReceipt(r, expected()), true); assert.deepEqual(r, before);
  for (const key of ['jobId', 'jobSha256', 'workerSha256']) assert.equal(validateReceipt(r, { ...expected(), [key]: 'wrong' }), false);
  for (const change of [a => a.byteLength++, a => a.sha256 = '0'.repeat(64), a => a.text = '{}', a => a.name = '../result.json']) {
    const invalid = good(); change(invalid.artifacts[0]); assert.equal(validateReceipt(invalid, expected()), false);
  }
});
test('receipt rejects executable/non-JSON data before invoking getters, toJSON or proxy traps', () => {
  let touched = 0;
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { touched++; return 3; } });
  const proxy = new Proxy({}, { ownKeys() { touched++; return []; } });
  const cycle = {}; cycle.self = cycle;
  for (const value of [getter, proxy, { toJSON() { touched++; return {}; } }, new Date(), [], cycle,
    { x: undefined }, { x: NaN }, { x: Infinity }, { x: 1n }, { x: 1.5 }, { x: Number.MAX_SAFE_INTEGER + 1 }]) {
    const r = good(); r.result = value; r.artifacts = [];
    assert.equal(validateReceipt(r, expected()), false);
  }
  assert.equal(touched, 0);
});
test('receipt rejects hidden/symbol/extra fields, sparse arrays and excessive nesting', () => {
  for (const change of [r => r.extra = true, r => Object.defineProperty(r, 'hidden', { value: true }),
    r => r[Symbol('secret')] = true, r => r.logs = Array(2), r => r.logs.extra = 'x',
    r => r.result = Array.from({ length: 10 }).reduce(a => ({ a }), {})]) {
    const r = good(); change(r); assert.equal(validateReceipt(r, expected()), false);
  }
});
test('receipt measures UTF-8 limits and enforces pending/uncertain artifact and result rules', () => {
  const unicode = good(); unicode.logs = ['😀'.repeat(65)]; assert.equal(validateReceipt(unicode, expected()), false);
  const large = good(); large.logs = ['x'.repeat(257)]; assert.equal(validateReceipt(large, expected()), false);
  const whole = good(); whole.artifacts = []; whole.result = { text: '😀'.repeat(4090) };
  assert.equal(validateReceipt(whole, expected()), false);
  for (const state of ['accepted', 'uncertain']) {
    const r = makeReceipt(work, HASH(), state, null, state === 'uncertain' ? 'unknown' : '');
    assert.equal(validateReceipt(r, expected()), true); r.artifacts = good().artifacts; assert.equal(validateReceipt(r, expected()), false);
  }
  const mismatch = good(); mismatch.artifacts[0].text = '{"value":4}';
  mismatch.artifacts[0].sha256 = sha256(mismatch.artifacts[0].text);
  assert.equal(validateReceipt(mismatch, expected()), false);
  assert.equal(validateReceipt(makeReceipt(work, HASH(), 'failed', null, ''), expected()), false);
});
