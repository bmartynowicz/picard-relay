import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MISSION_CONTROL_FIXTURE, escapeHtml, sanitizeMissionControlFixture, renderMissionControl} from '../examples/mission-control.mjs';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const fixture = patch => ({...MISSION_CONTROL_FIXTURE, ...patch});

test('default preview is explicit static fixture with healthy service and unavailable provider', () => {
  const html = renderMissionControl();
  for (const text of ['OFFLINE / FIXTURE', 'synthetic data only', 'Healthy fixture', 'Provider capacity and saved-result recovery are separate', 'production execution disabled', 'Unknown · no updater evidence supplied']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('<dt>Provider</dt><dd>Unavailable</dd>'));
  assert.ok(html.includes('<dt>Service</dt><dd>Ready</dd>'));
  assert.ok(html.includes('<dt>Total jobs</dt><dd>4</dd>'));
  assert.ok(html.includes('<dt>Stored results</dt><dd>1</dd>'));
});
test('nonfixture sources and malformed root objects are rejected', () => {
  for (const input of [null, [], {}, {v: 1, source: 'live'}, fixture({source: 'signed-health'}), fixture({v: 2})]) assert.throws(() => renderMissionControl(input), /invalid_mission_control_fixture/);
});
test('missing observations stay unknown rather than healthy or zero', () => {
  const view = sanitizeMissionControlFixture({v: 1, source: 'fixture'});
  assert.equal(view.total, null);
  assert.equal(view.stored, null);
  assert.equal(view.health.providerReady, null);
  assert.equal(view.updater, 'unknown');
  const html = renderMissionControl({v: 1, source: 'fixture'});
  assert.ok(html.includes('<dt>Total jobs</dt><dd>Unknown</dd>'));
  assert.ok(html.includes('<td>Unknown</td>'));
  assert.ok(!html.includes('Healthy fixture'));
});
test('health fields require booleans and never determine updater success', () => {
  for (const value of ['true', 1, {}, [], undefined]) assert.throws(() => renderMissionControl(fixture({health: {providerReady: value}})), /invalid_mission_control_fixture/);
  for (const health of [null, 'ready', [], true]) assert.throws(() => renderMissionControl(fixture({health})), /invalid_mission_control_fixture/);
  for (const ready of [true, false, null]) assert.equal(sanitizeMissionControlFixture(fixture({health: {serviceReady: ready}})).updater, 'unknown');
  for (const state of ['healthy', 'current', 'verified', 'success', 'installed', 'fixture']) assert.throws(() => renderMissionControl(fixture({updater: {state}})), /invalid_mission_control_fixture/);
});
test('all count states and aggregate storage limits are enforced', () => {
  for (const count of [-1, 0.5, 10001, Number.MAX_SAFE_INTEGER + 1, '3', null, NaN, Infinity]) assert.throws(() => renderMissionControl(fixture({counts: {...MISSION_CONTROL_FIXTURE.counts, queued: count}})), /invalid_mission_control_fixture/);
  const missing = {...MISSION_CONTROL_FIXTURE.counts}; delete missing.queued;
  assert.throws(() => renderMissionControl(fixture({counts: missing})), /invalid_mission_control_fixture/);
  assert.throws(() => renderMissionControl(fixture({counts: {...MISSION_CONTROL_FIXTURE.counts, queued: 10000}})), /invalid_mission_control_fixture/);
  for (const stored of [-1, 0, 5, 1.5, '1']) assert.throws(() => renderMissionControl(fixture({results: {stored}})), /invalid_mission_control_fixture/);
  assert.throws(() => renderMissionControl(fixture({counts: undefined})), /invalid_mission_control_fixture/);
  const bounded = sanitizeMissionControlFixture(fixture({counts: {...MISSION_CONTROL_FIXTURE.counts, queued: 9996}}));
  assert.equal(bounded.total, 10000);
});
test('HTML escaping covers all delimiters and hostile labels never enter the document', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  const attack = '</dd><script>alert("x")</script><dd onmouseover=\'x\'>&';
  assert.throws(() => renderMissionControl(fixture({release: {state: 'fixture', version: attack}})), /invalid_mission_control_fixture/);
  const html = renderMissionControl(fixture({title: attack, release: {state: 'fixture', version: 'candidate-preview', label: attack}}));
  assert.ok(!html.includes(attack));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<dd onmouseover='));
});
test('release labels are bounded and never claim an installed release', () => {
  for (const version of ['', ' ', 'PRIVATE_LABEL', 'x'.repeat(81), 'x\ny', 1, null]) assert.throws(() => renderMissionControl(fixture({release: {state: 'fixture', version}})), /invalid_mission_control_fixture/);
  assert.throws(() => renderMissionControl(fixture({release: {state: 'verified', version: '1.2.3'}})), /invalid_mission_control_fixture/);
  const html = renderMissionControl(fixture({release: {state: 'unknown', version: 'PRIVATE_RELEASE_HASH'}}));
  assert.ok(!html.includes('PRIVATE_RELEASE_HASH'));
  assert.ok(html.includes('<dt>Installed production release</dt><dd>Unknown</dd>'));
});
test('private and unknown fields never enter sanitized view or HTML', () => {
  const privateValue = 'PRIVATE_SENTINEL_9f38';
  const input = fixture({ownerId: privateValue, taskId: privateValue, requestText: privateValue, result: privateValue, apiKey: privateValue, hmacSecret: privateValue, metadata: {value: privateValue}, health: {...MISSION_CONTROL_FIXTURE.health, pid: privateValue, address: privateValue}, counts: {...MISSION_CONTROL_FIXTURE.counts, [privateValue]: 1}, results: {stored: 1, body: privateValue}, release: {state: 'fixture', version: 'candidate-preview', hash: privateValue}, updater: {state: 'unknown', error: privateValue, nextRun: privateValue}});
  assert.ok(!JSON.stringify(sanitizeMissionControlFixture(input)).includes(privateValue));
  assert.ok(!renderMissionControl(input).includes(privateValue));
});
test('static document has no auth transport, controls, executable script or external assets', () => {
  const html = renderMissionControl();
  for (const pattern of [/<script\b/i, /\son\w+\s*=/i, /<(?:form|input|button|iframe|object|embed)\b/i, /\b(?:src|href|action)\s*=/i, /https?:\/\//i, /fetch\(/i, /XMLHttpRequest/i, /WebSocket/i, /x-bridge-/i, /<meta[^>]+http-equiv=["']refresh/i]) assert.ok(!pattern.test(html), String(pattern));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  const source = readFileSync(new URL('../examples/mission-control.mjs', import.meta.url), 'utf8');
  assert.ok(!/from ['"]node:(?:http|https|net|tls|child_process|vm)['"]/.test(source));
});
test('source fixture is immutable and rendering does not mutate caller data', () => {
  const input = structuredClone(MISSION_CONTROL_FIXTURE), before = JSON.stringify(input);
  renderMissionControl(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(MISSION_CONTROL_FIXTURE));
  for (const value of Object.values(MISSION_CONTROL_FIXTURE)) if (typeof value === 'object') assert.ok(Object.isFrozen(value));
});
console.log(`${passed} mission-control fixture cases passed; no listener, credentials, or live transport.`);
