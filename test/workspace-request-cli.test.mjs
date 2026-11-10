import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {workspaceFixture, fixtureOrigin, fixtureToken} from './fixtures/workspace-fixture.mjs';
import {openWorkspace, submitWorkspace, workspaceResult} from '../tools/workspace-request.mjs';

async function setup(t, intercept = {}) {
  const fixture = await workspaceFixture({realMarkers: false});
  t.after(() => fixture.close());
  const calls = [];
  const cookie = '__Host-PicardSession=' + fixtureToken;
  const request = await openWorkspace(fixtureOrigin, 'Synthetic fixture password', {
    async fetchImpl(url, options) {
      assert.equal(new URL(url).origin, fixtureOrigin);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Origin, fixtureOrigin);
      const path = new URL(url).pathname;
      const body = options.body === undefined ? undefined : JSON.parse(options.body);
      calls.push([options.method, path]);
      if (path === '/auth/login') {
        assert.equal(options.headers.Cookie, undefined);
        assert.deepEqual(body, {password: 'Synthetic fixture password'});
        return Response.json({ok: true}, {headers: {'Set-Cookie': cookie + '; Secure; HttpOnly; Path=/'}});
      }
      assert.equal(options.headers.Cookie, cookie);
      const reply = await fixture.request(path, {method: options.method, body});
      return intercept[path]?.(reply) ?? Response.json(reply.body, {status: reply.status});
    },
  });
  return {fixture, request, calls};
}

test('owner CLI submits an exact draft once and can recover it by UUID or result reference', async t => {
  const {fixture, request, calls} = await setup(t);
  const brief = fixture.brief({taskId: 'board-item'});
  const receipt = await submitWorkspace(request, brief);
  assert.equal(receipt.state, 'queued');
  assert.equal(fixture.calls, 0);
  assert.equal((await fixture.dispatcher.runOnce()).status, 'completed');
  assert.equal(fixture.calls, 1);
  const saved = await workspaceResult(request, brief.requestId);
  assert.equal(saved.ref, receipt.ref);
  assert.equal(saved.result.body, fixture.output);
  const retry = await submitWorkspace(request, brief);
  assert.equal(retry.result.body, fixture.output);
  assert.equal(calls.filter(([, path]) => path === '/workspace/requests').length, 1);
  assert.equal((await fixture.dispatcher.runOnce()).status, 'idle');
  assert.equal(fixture.calls, 1);
  await assert.rejects(submitWorkspace(request, {...brief, requestText: 'Changed input'}), {code: 'draft_conflict'});
});

test('a lost queue receipt is recovered by a read of the exact request', async t => {
  const {fixture, request, calls} = await setup(t, {
    '/workspace/requests': reply => {
      assert.equal(reply.status, 201);
      throw new TypeError('synthetic connection lost after commit');
    },
  });
  const receipt = await submitWorkspace(request, fixture.brief());
  assert.equal(receipt.state, 'queued');
  assert.deepEqual(calls.slice(-2), [
    ['POST', '/workspace/requests'], ['GET', '/workspace/requests/' + receipt.ref],
  ]);
  assert.equal((await fixture.dispatcher.runOnce()).status, 'completed');
  assert.equal(fixture.calls, 1);
});

test('unconfirmed submission with no job stops and exposes its original identity', async t => {
  const {fixture, request, calls} = await setup(t, {
    '/workspace/approvals': reply => Response.json({...reply.body, nonce: 'A'.repeat(43)}),
    '/workspace/requests': reply => {
      assert.equal(reply.status, 409);
      throw new TypeError('synthetic connection lost without commit');
    },
  });
  const brief = fixture.brief();
  await assert.rejects(submitWorkspace(request, brief), error =>
    error.code === 'submission_unconfirmed' && error.details.requestId === brief.requestId
      && /^[a-f0-9]{64}$/.test(error.details.ref));
  assert.equal(calls.filter(([, path]) => path === '/workspace/requests').length, 1);
  assert.equal((await fixture.dispatcher.runOnce()).status, 'idle');
  assert.equal(fixture.calls, 0);
});

test('a response containing a changed draft never reaches approval', async t => {
  const {fixture, request, calls} = await setup(t, {
    '/workspace/drafts': reply => {
      reply.body.draft.payload.request.text = 'Changed input';
      return Response.json(reply.body, {status: reply.status});
    },
  });
  await assert.rejects(submitWorkspace(request, fixture.brief()), {code: 'draft_does_not_match'});
  assert.deepEqual(calls.map(([, path]) => path), ['/auth/login', '/workspace/drafts']);
  assert.equal(fixture.calls, 0);
});

test('unsafe origins are rejected before a password is sent', async () => {
  for (const origin of ['http://fixture.invalid', 'https://user@fixture.invalid', 'https://fixture.invalid/path']) {
    await assert.rejects(openWorkspace(origin, 'secret', {fetchImpl: () => assert.fail('unexpected fetch')}),
      {code: 'invalid_origin'});
  }
});

test('prepare creates a stable request without clobbering an existing file', t => {
  const dir = mkdtempSync(join(tmpdir(), 'picard-workspace-cli-'));
  const cli = fileURLToPath(new URL('../tools/workspace-request.mjs', import.meta.url));
  const brief = {taskId: 'board-item', title: 'Review', requestText: 'Generic example',
    context: '', purpose: 'sanitized-source-proposal'};
  const input = join(dir, 'brief.json'), output = join(dir, 'request.json');
  t.after(() => {
    rmSync(input, {force: true});
    rmSync(output, {force: true});
    rmdirSync(dir);
  });
  writeFileSync(input, JSON.stringify(brief));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  const args = ['prepare', '--input', input, '--out', output];
  const prepared = JSON.parse(run(...args));
  const original = readFileSync(output, 'utf8');
  assert.equal(prepared.state, 'prepared_locally');
  assert.deepEqual(JSON.parse(original), {requestId: prepared.requestId, ...brief});
  assert.throws(() => run(...args), /request_file_already_exists/);
  assert.equal(readFileSync(output, 'utf8'), original);
  assert.throws(() => run('submit', '--origin', fixtureOrigin, '--file', output), /usage/);
});
