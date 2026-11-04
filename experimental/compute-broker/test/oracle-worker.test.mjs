import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { readInstanceShape, cgroupMemoryLimit } from '../src/oracle-worker.mjs';

test('fixed Oracle metadata uses bounded native HTTP in normal and jitless modes', async t => {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/opc/v2/instance/');
    assert.equal(request.headers.authorization, 'Bearer Oracle');
    response.end(JSON.stringify({ shape: 'VM.Standard.E2.1.Micro' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = (url, options, callback) => {
    assert.equal(url, 'http://169.254.169.254/opc/v2/instance/');
    assert.ok(options.signal); assert.equal(options.headers.Connection, 'close');
    return httpGet(`http://127.0.0.1:${server.address().port}/opc/v2/instance/`, options, callback);
  };
  assert.equal(await readInstanceShape({ get }), 'VM.Standard.E2.1.Micro');
});
test('metadata rejects redirects, malformed/missing shape and oversized bodies', async t => {
  let status = 302, body = '{}';
  const server = createServer((request, response) => { response.writeHead(status, { location: 'http://example.invalid' }); response.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = (url, options, callback) => httpGet(`http://127.0.0.1:${server.address().port}/`, options, callback);
  for (const value of [[302, '{}'], [200, '{}'], [200, 'not-json'], [200, JSON.stringify({ shape: 'x'.repeat(129) })],
    [200, JSON.stringify({ shape: 'VM.Standard.E2.1.Micro', extra: 'x'.repeat(16384) })]]) {
    [status, body] = value;
    await assert.rejects(readInstanceShape({ get }), /^Error: worker_identity_unavailable$/);
  }
});
test('cgroup memory walks child/parent limits without requiring a nonexistent root control', () => {
  const files = new Map([
    ['/sys/fs/cgroup/user.slice/user-1001.slice/session-1.scope/memory.max', 'max'],
    ['/sys/fs/cgroup/user.slice/user-1001.slice/memory.max', '134217728'],
    ['/sys/fs/cgroup/user.slice/memory.max', 'max'],
  ]);
  const read = path => { assert.notEqual(path, '/sys/fs/cgroup/memory.max'); if (!files.has(path)) throw Error('missing'); return files.get(path); };
  assert.equal(cgroupMemoryLimit('/user.slice/user-1001.slice/session-1.scope', read), 134217728);
  files.set('/sys/fs/cgroup/user.slice/memory.max', '67108864');
  assert.equal(cgroupMemoryLimit('/user.slice/user-1001.slice/session-1.scope', read), 67108864);
  files.delete('/sys/fs/cgroup/user.slice/user-1001.slice/memory.max');
  assert.throws(() => cgroupMemoryLimit('/user.slice/user-1001.slice/session-1.scope', read));
  assert.throws(() => cgroupMemoryLimit('/../../elsewhere', read));
  assert.equal(cgroupMemoryLimit('/', read), Infinity);
});
