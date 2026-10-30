import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { signRequest } from '../src/protocol.mjs';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
let destinationCalls = 0, originCalls = 0;
const destination = http.createServer((req, res) => { destinationCalls++; res.end('must not arrive'); });
await listen(destination);
const origin = http.createServer((req, res) => {
  originCalls++;
  res.writeHead(Number(req.url.slice(1)), { Location: `http://127.0.0.1:${destination.address().port}/target` });
  res.end();
});
await listen(origin);
try {
  const config = { keyId: 'synthetic-redirect-test', secret: randomBytes(32).toString('hex') };
  for (const status of [301, 302, 303, 307, 308]) {
    const { request } = await signRequest(`http://127.0.0.1:${origin.address().port}/${status}`, { text: 'synthetic fixture' }, config);
    assert.equal(request.redirect, 'manual');
    const response = await fetch(request);
    assert.equal(response.status, status);
    assert.equal(response.redirected, false);
    await assert.rejects(async () => {
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('relay_redirect_rejected');
      }
    }, /relay_redirect_rejected/);
    assert.equal(destinationCalls, 0);
  }
  assert.equal(originCalls, 5);
  console.log('PASS signed request manual redirect mode; five redirect statuses rejected with zero destination requests');
} finally { await close(origin); await close(destination); }
