import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { boundedProcess, readWorkerInput } from '../src/process.mjs';
test('worker transport enforces output, time and cancellation bounds', async () => {
  const ok = await boundedProcess(process.execPath, ['-e', 'process.stdout.write("ok")']); assert.equal(ok.stdout, 'ok');
  await assert.rejects(boundedProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(1024))'], { maximumBytes: 100 }));
  await assert.rejects(boundedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(boundedProcess('must-not-start', [], { signal: controller.signal }));
});
test('worker stdin is bounded JSON data', async () => {
  assert.deepEqual(await readWorkerInput(Readable.from([Buffer.from('{"a":1}')])), { a: 1 });
  await assert.rejects(readWorkerInput(Readable.from([Buffer.alloc(98_305)])), /too_large/);
  await assert.rejects(readWorkerInput(Readable.from([Buffer.from('not json')])));
});
