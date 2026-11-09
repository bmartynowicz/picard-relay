import test from 'node:test';
import assert from 'node:assert/strict';
import { contributorCredits } from '../scripts/contributor-recognition.mjs';

const award = (number, label, extra = {}) => ({
  number, login: 'Fixture-User', labels: [label], pull: false, mergedAt: null, ...extra,
});

test('public award lookup counts distinct issues and only merged bug-fix pull requests', () => {
  const result = contributorCredits('fixture-user', (login, label) => {
    assert.equal(login, 'fixture-user');
    return label === 'picard:kill' ? [
      award(8, label, { pull: true, mergedAt: '2026-11-09T18:00:00Z' }),
      award(4, label), award(4, label), award(9, label, { pull: true }),
    ] : [award(7, label), award(12, label, { pull: true, mergedAt: '2026-11-09T18:00:00Z' })];
  });
  assert.deepEqual(result, { kills: [4, 8], captures: [7] });
});

test('credit lookup rejects cross-account, ambiguous, or incomplete data', () => {
  assert.throws(() => contributorCredits('x/y', () => assert.fail('read not authorized')), /username/);
  assert.throws(() => contributorCredits('Fixture-User', (_, label) => [
    award(1, label, { login: 'someone-else' }),
  ]), /outside/);
  assert.throws(() => contributorCredits('Fixture-User', (_, label) => [
    award(1, label, { labels: ['picard:kill', 'picard:capture'] }),
  ]), /Conflicting/);
  assert.throws(() => contributorCredits('Fixture-User', (_, label) => [award(1, label)]), /changed category/);
  assert.throws(() => contributorCredits('Fixture-User', (_, label) => Array(100).fill(award(1, label))), /incomplete/);
  assert.deepEqual(contributorCredits('Fixture-User', () => []), { kills: [], captures: [] });
});
