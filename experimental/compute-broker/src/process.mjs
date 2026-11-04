import { spawn } from 'node:child_process';

export function boundedProcess(command, args, { input = '', timeoutMs = 8000, maximumBytes = 131_072,
  signal, cwd, env = process.env } = {}) {
  if (signal?.aborted) return Promise.reject(Error('worker_transport_unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd, env });
    let stdout = '', stderr = '', bytes = 0, stopped = false;
    const stop = () => { stopped = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    for (const [stream, append] of [[child.stdout, text => { stdout += text; }], [child.stderr, text => { stderr += text; }]]) {
      stream.setEncoding('utf8'); stream.on('data', text => {
        bytes += Buffer.byteLength(text); if (bytes > maximumBytes) stop(); else append(text);
      });
    }
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.on('error', () => { cleanup(); reject(Error('worker_transport_unavailable')); });
    child.on('close', code => { cleanup(); if (stopped) reject(Error('worker_transport_unavailable'));
      else resolve({ code, stdout, stderr }); });
  });
}
export async function readWorkerInput(stream = process.stdin) {
  let bytes = 0; const chunks = [];
  const timer = setTimeout(() => stream.destroy(Error('worker_input_timeout')), 2000);
  try {
    for await (const chunk of stream) {
      bytes += chunk.length; if (bytes > 98_304) throw Error('worker_input_too_large'); chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timer); }
}
