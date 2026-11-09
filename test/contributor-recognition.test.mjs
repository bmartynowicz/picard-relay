import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import { contributorCredits } from '../scripts/contributor-recognition.mjs';
import { fetchContributorCredits } from '../experimental/runtime-control/src/https-fetch.mjs';

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

function fixtureGitHub(t, page) {
  t.mock.method(https, 'get', (url, options, respond) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.github.com');
    assert.equal(target.pathname, '/repos/bmartynowicz/picard-relay/issues');
    assert.equal(target.searchParams.get('creator'), 'Fixture-User');
    assert.equal(target.searchParams.get('state'), 'all');
    assert.equal(target.searchParams.get('per_page'), '100');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.signal.aborted, false);
    const { status = 200, headers = {}, body } = page(target.searchParams.get('labels'));
    const response = Readable.from([Buffer.from(body)]);
    response.statusCode = status;
    response.headers = headers;
    queueMicrotask(() => respond(response));
    return new EventEmitter();
  });
}

test('automatic lookup verifies two bounded public pages through the same credit rules', async t => {
  const seen = [];
  fixtureGitHub(t, label => {
    seen.push(label);
    const bug = label === 'picard:kill';
    return { body: JSON.stringify([{
      number: bug ? 40 : 60, user: { login: 'fixture-user' }, labels: [{ name: label }],
      ...(bug ? { pull_request: { merged_at: '2026-11-09T18:00:00Z' } } : {}),
    }]) };
  });
  assert.deepEqual(await fetchContributorCredits('Fixture-User'), { kills: [40], captures: [60] });
  assert.deepEqual(seen.sort(), ['picard:capture', 'picard:kill']);
});

test('automatic lookup refuses partial pages, rate limits, redirects and oversized bodies', async t => {
  const responses = [
    ['paginated results', { headers: { link: '<https://api.github.com/page>; rel="next"' }, body: '[]' }, /page_unavailable/],
    ['rate limit', { status: 429, body: '[]' }, /page_unavailable/],
    ['redirect', { status: 302, body: '[]' }, /page_unavailable/],
    ['oversized response', { body: ' '.repeat(512 * 1024 + 1) }, /page_oversized/],
  ];
  for (const [name, failure, expected] of responses) {
    await t.test(name, async sub => {
      fixtureGitHub(sub, label => label === 'picard:kill' ? { body: '[]' } : failure);
      await assert.rejects(fetchContributorCredits('Fixture-User'), expected);
    });
  }
});
