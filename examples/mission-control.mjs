// Offline presentation only. No listener, credentials, live transport or execution.
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const STATES = Object.freeze(['queued', 'claimed', 'invoking', 'completed', 'failed', 'blocked', 'cancelled', 'uncertain']);
const MAX_JOBS = 10000;
const invalid = () => new Error('invalid_mission_control_fixture');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const MISSION_CONTROL_FIXTURE = Object.freeze({
  v: 1,
  source: 'fixture',
  health: Object.freeze({serviceReady: true, providerReady: false, resultRecoveryReady: true, acceptingNewWork: false, draining: false}),
  counts: Object.freeze({queued: 0, claimed: 0, invoking: 0, completed: 1, failed: 0, blocked: 2, cancelled: 1, uncertain: 0}),
  results: Object.freeze({stored: 1}),
  release: Object.freeze({state: 'fixture', version: 'candidate-preview'}),
  updater: Object.freeze({state: 'unknown'}),
});

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

// Project only the fields this static fixture presentation needs. Never serialize
// input objects into HTML, comments, attributes, CSS or executable script.
export function sanitizeMissionControlFixture(input = MISSION_CONTROL_FIXTURE) {
  if (!record(input) || input.v !== 1 || input.source !== 'fixture') throw invalid();
  if (input.health !== undefined && !record(input.health)) throw invalid();
  const health = {};
  for (const key of ['serviceReady', 'providerReady', 'resultRecoveryReady', 'acceptingNewWork', 'draining']) {
    const value = record(input.health) && own(input.health, key) ? input.health[key] : null;
    if (value !== null && typeof value !== 'boolean') throw invalid();
    health[key] = value;
  }
  const counts = {};
  let total = null;
  if (input.counts !== undefined) {
    if (!record(input.counts)) throw invalid();
    total = 0;
    for (const state of STATES) {
      if (!own(input.counts, state)) throw invalid();
      const count = input.counts[state];
      if (!Number.isSafeInteger(count) || count < 0 || count > MAX_JOBS) throw invalid();
      counts[state] = count;
      total += count;
    }
    if (total > MAX_JOBS) throw invalid();
  }
  let stored = null;
  if (input.results !== undefined) {
    if (!record(input.results) || !own(input.results, 'stored') || total === null || !Number.isSafeInteger(input.results.stored) || input.results.stored < counts.completed || input.results.stored > total) throw invalid();
    stored = input.results.stored;
  }
  let version = null;
  if (input.release !== undefined) {
    if (!record(input.release) || !['unknown', 'fixture'].includes(input.release.state)) throw invalid();
    if (input.release.state === 'fixture') {
      // A fixed fixture label is enough here. Arbitrary names, commit labels or
      // release metadata are not a display channel for caller-supplied strings.
      if (input.release.version !== 'candidate-preview') throw invalid();
      version = 'candidate-preview';
    }
  }
  // Service readiness never supplies updater evidence. This preview has none.
  if (input.updater !== undefined && (!record(input.updater) || input.updater.state !== 'unknown')) throw invalid();
  return {health, counts, total, stored, version, updater: 'unknown'};
}

export function renderMissionControl(input = MISSION_CONTROL_FIXTURE) {
  const view = sanitizeMissionControlFixture(input);
  const number = value => value === null ? 'Unknown' : String(value);
  const readiness = value => value === null ? 'Unknown' : value ? 'Ready' : 'Unavailable';
  const flag = value => value === null ? 'Unknown' : value ? 'Yes' : 'No';
  const service = view.health.serviceReady === null ? 'Unknown' : view.health.serviceReady ? 'Healthy fixture' : 'Unavailable fixture';
  const countRows = STATES.map(state => `<tr><th scope="row">${state[0].toUpperCase() + state.slice(1)}</th><td>${number(view.total === null ? null : view.counts[state])}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Picard Relay · fixture mission control</title>
<style>
:root{color-scheme:dark;--bg:#11171e;--surface:#161f28;--ink:#f1f2ed;--muted:#aeb8c2;--line:#34404c;--accent:#efc477;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.55}main{max-width:1120px;margin:auto;padding:52px 44px 32px}p,h1,h2{margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:28px;border-bottom:1px solid var(--line)}.eyebrow{font-size:11px;letter-spacing:.17em;text-transform:uppercase;color:var(--muted)}h1{font-size:clamp(30px,5vw,46px);font-weight:580;letter-spacing:-.04em;line-height:1.15;margin-top:9px}.mode{color:var(--accent);font-size:12px;letter-spacing:.09em;white-space:nowrap;padding-top:8px}.notice{border-left:2px solid var(--accent);padding:14px 20px;margin:28px 0 40px;background:var(--surface);color:var(--muted);font-size:13px}.notice strong{display:block;color:var(--ink);font-weight:600;margin-bottom:3px}.overview{display:grid;grid-template-columns:1.15fr 1fr;gap:64px;margin-bottom:40px}.service-status{font-size:32px;font-weight:540;letter-spacing:-.03em;line-height:1.25;margin:10px 0}.support{font-size:13px;color:var(--muted);max-width:38em}.readiness{margin:0}.readiness div{display:flex;justify-content:space-between;gap:20px;padding:8px 0;border-bottom:1px solid var(--line)}dt{color:var(--muted)}dd{margin:0;text-align:right}.metrics{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 0 40px;padding:24px 0}.metric+.metric{border-left:1px solid var(--line);padding-left:28px}.metric dt{font-size:12px}.metric dd{text-align:left;font-size:36px;line-height:1.25;font-variant-numeric:tabular-nums;margin-top:7px;letter-spacing:-.04em}.detail{display:grid;grid-template-columns:1fr 1fr;gap:64px}h2{font-size:17px;font-weight:580;letter-spacing:-.015em;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 0;border-bottom:1px solid var(--line)}th{text-align:left;font-weight:400;color:var(--muted)}td{text-align:right;font-variant-numeric:tabular-nums}.runtime{margin:0}.runtime div{padding:10px 0;border-bottom:1px solid var(--line)}.runtime dt{font-size:12px;margin-bottom:2px}.runtime dd{text-align:left;overflow-wrap:anywhere}.runtime .support{margin-top:16px}footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.scope{color:var(--accent)}@media(max-width:700px){main{padding:28px 22px}header{gap:16px}.mode{white-space:normal;text-align:right}.overview,.detail{grid-template-columns:1fr;gap:28px}.overview{margin-bottom:28px}.notice{margin:24px 0 28px}.metric+.metric{padding-left:16px}.metric dd{font-size:28px}.metric dt{font-size:11px}.metrics{margin-bottom:28px}.service-status{font-size:28px}}
</style>
</head>
<body>
<main>
<header><div><p class="eyebrow">Mission control</p><h1>Picard Relay</h1></div><p class="mode">OFFLINE / FIXTURE</p></header>
<aside class="notice" aria-label="Preview scope"><strong>Static local preview · synthetic data only</strong>This file has no live connection, refresh, task controls or authentication credentials.</aside>
<section class="overview" aria-labelledby="health-heading">
<div><h2 id="health-heading" class="eyebrow">Fixture health</h2><p class="service-status">${service}</p><p class="support">Provider capacity and saved-result recovery are separate. An unavailable provider can coexist with a healthy service.</p></div>
<dl class="readiness"><div><dt>Service</dt><dd>${readiness(view.health.serviceReady)}</dd></div><div><dt>Provider</dt><dd>${readiness(view.health.providerReady)}</dd></div><div><dt>Result recovery</dt><dd>${readiness(view.health.resultRecoveryReady)}</dd></div><div><dt>Accepting new work</dt><dd>${flag(view.health.acceptingNewWork)}</dd></div><div><dt>Draining</dt><dd>${flag(view.health.draining)}</dd></div></dl>
</section>
<dl class="metrics" aria-label="Fixture totals"><div class="metric"><dt>Total jobs</dt><dd>${number(view.total)}</dd></div><div class="metric"><dt>Stored results</dt><dd>${number(view.stored)}</dd></div><div class="metric"><dt>Uncertain jobs</dt><dd>${number(view.total === null ? null : view.counts.uncertain)}</dd></div></dl>
<div class="detail"><section aria-labelledby="jobs-heading"><h2 id="jobs-heading">Job states</h2><table><caption class="eyebrow" style="text-align:left;padding-bottom:8px">Aggregate fixture counts</caption><thead><tr><th scope="col">State</th><th scope="col" style="text-align:right">Jobs</th></tr></thead><tbody>${countRows}</tbody></table></section>
<section aria-labelledby="runtime-heading"><h2 id="runtime-heading">Release &amp; updater</h2><dl class="runtime"><div><dt>Fixture source version</dt><dd>${view.version === null ? 'Unknown' : escapeHtml(view.version)}</dd></div><div><dt>Installed production release</dt><dd>Unknown</dd></div><div><dt>Updater state</dt><dd>Unknown · no updater evidence supplied</dd></div><div><dt>Task execution</dt><dd>Fixture only · production execution disabled</dd></div></dl><p class="support">Service health does not verify installation, signature checks, a scheduled update, or rollback.</p></section></div>
<footer><span class="scope">Read-only presentation.</span> No task text, identities, individual results, keys or private metadata are included.</footer>
</main>
</body>
</html>\n`;
}

function main(args) {
  if (args.length === 0) { process.stdout.write(renderMissionControl()); return; }
  if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('-')) throw new Error('usage_mission_control_output');
  // Refuse replacement of an existing file. CLI output is the only write here.
  writeFileSync(args[1], renderMissionControl(), {flag: 'wx', mode: 0o600});
  process.stdout.write('Created offline fixture mission-control preview.\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message === 'usage_mission_control_output' ? 'Usage: node examples/mission-control.mjs [--output NEW_FILE.html]' : 'mission_control_output_failed'}\n`); process.exitCode = 2; }
}
