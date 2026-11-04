import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function openMcp({ database, profile, env = process.env, timeoutMs = 45_000 } = {}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp.mjs', import.meta.url)), '--db', database,
    ...(profile ? ['--execution-profile', profile] : [])], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '', stopped = false; const pending = new Map();
  const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('mcp_session_failed')); } pending.clear(); };
  const exited = new Promise(resolve => { child.once('error', () => { fail(); resolve(-1); });
    child.once('close', code => { stopped = true; fail(); resolve(code); }); });
  child.stderr.on('data', () => {}); // Never echo provider errors, environment or credentials.
  child.stdin.on('error', fail); child.stdout.setEncoding('utf8');
  child.stdout.on('data', data => {
    buffer += data;
    if (Buffer.byteLength(buffer) > 131_072) { fail(); child.kill(); return; }
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { const m = JSON.parse(line), p = pending.get(m.id); if (p) {
        clearTimeout(p.timer); pending.delete(m.id);
        if (m.error || m.result?.isError || !m.result) p.reject(Error('mcp_operation_failed')); else p.resolve(m.result);
      } } catch { fail(); child.kill(); }
    }
  });
  function request(method, params) {
    if (stopped) return Promise.reject(Error('mcp_session_failed'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('mcp_response_timeout')); child.kill(); }, timeoutMs);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async function close() {
    child.stdin.end(); const timer = setTimeout(() => child.kill(), 2000);
    try { const code = await exited; if (code !== 0) throw Error('mcp_shutdown_failed'); } finally { clearTimeout(timer); }
  }
  try {
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'picard-unattended-ci', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  } catch { child.kill(); await exited; throw Error('mcp_session_failed'); }
  return { close, async call(name, args = {}) {
    const result = await request('tools/call', { name, arguments: args });
    if (!result.structuredContent || !Object.hasOwn(result.structuredContent, 'data')) throw Error('mcp_response_invalid');
    return result.structuredContent.data;
  } };
}
