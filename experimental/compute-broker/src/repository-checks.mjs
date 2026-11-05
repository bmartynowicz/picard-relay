import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_SCOPE = 'full-repository-v1';
export const REPOSITORY_CHECKS = Object.freeze([
  ['root', ['test']],
  ['updater', ['--prefix', 'experimental/updater', 'test']],
  ['runtime', ['--prefix', 'experimental/runtime-control', 'test']],
  ['socket', ['--prefix', 'experimental/runtime-control', 'run', 'test:socket']],
  ['broker', ['--prefix', 'experimental/compute-broker', 'test']],
  ['broker-jitless', ['--prefix', 'experimental/compute-broker', 'run', 'test:jitless']],
  ['docs', ['run', 'docs:check']],
].map(([id, args]) => Object.freeze({ id, args: Object.freeze(args) })));

export function repositoryResultState(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'checks,scope,sourceSha'
    || value.scope !== REPOSITORY_SCOPE || !/^[0-9a-f]{40}$/.test(value.sourceSha)
    || !Array.isArray(value.checks) || value.checks.length !== REPOSITORY_CHECKS.length
    || value.checks.some((r, i) => !r || Object.keys(r).sort().join(',') !== 'exitCode,id'
      || r.id !== REPOSITORY_CHECKS[i].id || !Number.isInteger(r.exitCode) || r.exitCode < 0 || r.exitCode > 255))
    throw Error('repository_result_invalid');
  return value.checks.every(r => r.exitCode === 0) ? 'completed' : 'failed';
}

// Linux process groups ensure a bounded npm check cannot leave its child test processes running.
export function boundedSuite(command, args, { cwd, env, timeoutMs, onOutput = () => {} }) {
  if (process.platform !== 'linux') return Promise.reject(Error('repository_checks_require_linux'));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, stopped = false;
    const stop = () => { stopped = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(stop, timeoutMs);
    for (const [stream, append] of [[child.stdout, s => { stdout += s; }], [child.stderr, s => { stderr += s; }]]) {
      stream.setEncoding('utf8'); stream.on('data', text => {
        bytes += Buffer.byteLength(text);
        if (bytes > 1_048_576) stop(); else { append(text); onOutput(text); }
      });
    }
    child.once('error', () => { clearTimeout(timer); reject(Error('repository_check_transport_failed')); });
    child.once('close', code => { clearTimeout(timer);
      if (stopped || !Number.isInteger(code)) reject(Error('repository_check_outcome_unknown'));
      else resolve({ code, stdout, stderr });
    });
  });
}
export async function runRepositorySuites(directory, { run = boundedSuite, now = Date.now, log = () => {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'picard-repository-home-'));
  const env = { PATH: process.env.PATH, CI: 'true', LANG: 'C.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp', HOME: home,
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
  const deadline = now() + 450_000, checks = [], logs = [];
  try {
    for (const group of REPOSITORY_CHECKS) {
      const remaining = deadline - now(); if (remaining <= 0) throw Error('repository_check_outcome_unknown');
      log(`[${group.id}] npm ${group.args.join(' ')}`);
      let forwarded = 0, truncated = false;
      const result = await run('npm', [...group.args], { cwd: directory, env, timeoutMs: Math.min(300_000, remaining),
        onOutput: text => {
          const safe = Buffer.from(`[${group.id}] ${text.replaceAll('PICARD_COMPUTE_RESULT_V1:', '[child-marker]').replaceAll('\n', `\n[${group.id}] `)}`);
          const available = Math.max(0, 65_500 - forwarded);
          if (available) { const part = safe.subarray(0, available).toString('utf8'); forwarded += Buffer.byteLength(part); log(part); }
          if (safe.length > available && !truncated) { truncated = true; log(`[${group.id}] forwarded output capped; exit and failure excerpt follow`); }
        } });
      if (!Number.isInteger(result.code) || result.code < 0 || result.code > 255) throw Error('repository_check_outcome_unknown');
      checks.push({ id: group.id, exitCode: result.code });
      if (result.code !== 0) {
        const text = `${result.stdout}\n${result.stderr}`;
        const position = text.search(/✖|not ok|AssertionError|Error:/);
        const excerpt = text.slice(Math.max(0, position), Math.max(0, position) + 4000).replaceAll('PICARD_COMPUTE_RESULT_V1:', '[child-marker]');
        log(`[${group.id}] failure excerpt: ${JSON.stringify(excerpt)}`);
      }
      // Each saved log tail is bounded in UTF-8 bytes; worker logs retain bounded prefixed output.
      const tail = Buffer.from(`${group.id}: exit ${result.code}\n${result.stdout}\n${result.stderr}`.trim());
      logs.push(tail.subarray(Math.max(0, tail.length - 240)).toString('utf8'));
    }
    return { checks, logs };
  } finally { rmSync(home, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRepositorySuites(fileURLToPath(new URL('../../../', import.meta.url)), { log: console.log }).then(({ checks }) => {
    console.log(JSON.stringify({ scope: REPOSITORY_SCOPE, checks }));
    if (checks.some(r => r.exitCode !== 0)) process.exitCode = 1;
  }).catch(() => { console.error('repository_check_outcome_unknown'); process.exitCode = 1; });
}
