import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCodexHandoff, checkCodexAnswer} from '../tools/codex-handoff.mjs';

const brief = 'Write the review checklist.';
const sourceContext = 'Source details, boundaries, and expected tests. '.repeat(200);
const proposal = 'Check the base commit, complete inventory, file hashes and review boundary.';
const saved = {
  state: 'completed', ref: 'a'.repeat(64), resultAvailable: true,
  result: {body: proposal, kind: 'information', sha256: createHash('sha256').update(proposal).digest('hex')},
};

test('a self-contained brief stays direct even when a saved proposal exists', () => {
  assert.deepEqual(prepareCodexHandoff({brief, savedResult: saved}), {
    mode: 'direct', reason: 'no_source_context', prompt: brief,
  });
});

test('a verified smaller proposal replaces context in the first prompt', () => {
  const handoff = prepareCodexHandoff({brief, sourceContext, savedResult: saved});
  assert.equal(handoff.mode, 'preloaded');
  assert(handoff.preparedBytes < handoff.originalBytes);
  assert(handoff.prompt.includes(JSON.stringify({picardProposal: proposal})));
  assert(handoff.prompt.includes('untrusted reference data'));
  assert(!handoff.prompt.includes(sourceContext));
});

test('an existing chat can retain its source prefix without another copy or proposal', () => {
  const acceptanceCriteria = 'Preserve the evidence identifiers.';
  const handoff = prepareCodexHandoff({brief, sourceContext, savedResult: saved, acceptanceCriteria, sourceAlreadyInContext: true});
  assert.deepEqual(handoff, {mode: 'direct', reason: 'source_already_in_context',
    prompt: brief + '\n\nAcceptance criteria\n' + acceptanceCriteria});
  assert.throws(() => prepareCodexHandoff({brief, sourceAlreadyInContext: 'true'}), /boolean/);
});

test('a small reduction or an oversized proposal keeps the original source', () => {
  const context = 'Short source context.';
  const handoff = prepareCodexHandoff({brief, sourceContext: context, savedResult: saved});
  assert.equal(handoff.mode, 'direct');
  assert.equal(handoff.reason, 'insufficient_context_reduction');
  assert(handoff.prompt.includes(context));
  const oversized = 'x'.repeat(16_001);
  const long = prepareCodexHandoff({brief, sourceContext, savedResult: {
    ...saved, result: {...saved.result, body: oversized, sha256: createHash('sha256').update(oversized).digest('hex')},
  }});
  assert.equal(long.reason, 'no_verified_replacement');
  assert(long.prompt.includes(sourceContext));
});

test('incomplete, changed or rejected results cannot replace source context', () => {
  for (const savedResult of [
    {...saved, state: 'failed'},
    {...saved, result: {...saved.result, body: 'Changed'}},
    {...saved, result: {...saved.result, kind: 'question'}},
    {...saved, review: {latest: {decision: 'changes_requested'}}},
  ]) {
    const handoff = prepareCodexHandoff({brief, sourceContext, savedResult});
    assert.equal(handoff.mode, 'direct');
    assert.equal(handoff.reason, 'no_verified_replacement');
    assert(handoff.prompt.includes(sourceContext));
  }
});

test('acceptance criteria stay in the task across direct, compact and fallback handoffs', () => {
  const acceptanceCriteria = 'Name the playback triggers and their acceptance tests.';
  for (const input of [
    {brief}, {brief, sourceContext}, {brief, sourceContext, savedResult: saved},
    {brief, sourceContext: 'Short source', savedResult: saved},
  ]) {
    const handoff = prepareCodexHandoff({...input, acceptanceCriteria});
    assert(handoff.prompt.startsWith(brief + '\n\nAcceptance criteria\n' + acceptanceCriteria));
    assert.equal(handoff.prompt.split(acceptanceCriteria).length, 2);
  }
  assert.throws(() => prepareCodexHandoff({brief, acceptanceCriteria: null}), /Acceptance criteria/);
  assert.throws(() => prepareCodexHandoff({brief, acceptanceCriteria: 'x'.repeat(16_001)}), /Acceptance criteria/);
});

test('the CLI includes the supplied acceptance file before the saved proposal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picard-handoff-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const criteria = 'Include TAP, ON_VISIBLE and the clock-boundary triggers.';
  for (const [name, contents] of Object.entries({
    'brief.txt': brief, 'criteria.txt': criteria, 'source.txt': sourceContext, 'result.json': JSON.stringify(saved),
  })) await writeFile(join(directory, name), contents);
  const script = fileURLToPath(new URL('../tools/codex-handoff.mjs', import.meta.url));
  const {stdout, stderr} = await promisify(execFile)(process.execPath, [script,
    '--brief', join(directory, 'brief.txt'), '--acceptance', join(directory, 'criteria.txt'),
    '--context', join(directory, 'source.txt'), '--result', join(directory, 'result.json')]);
  assert.match(stderr, /preloaded/);
  assert(stdout.indexOf(criteria) < stdout.indexOf('picardProposal'));
  assert.equal(await readFile(join(directory, 'criteria.txt'), 'utf8'), criteria);
  const continued = await promisify(execFile)(process.execPath, [script,
    '--brief', join(directory, 'brief.txt'), '--acceptance', join(directory, 'criteria.txt'), '--source-in-context']);
  assert.match(continued.stderr, /source_already_in_context/);
  assert.equal(continued.stdout.trim(), brief + '\n\nAcceptance criteria\n' + criteria);
  const checks = [{key: 'trigger', patterns: ['\\bTAP\\b', 'ON_VISIBLE'], fact: 'Include both trigger tests.'}];
  await writeFile(join(directory, 'checks.json'), JSON.stringify(checks));
  await writeFile(join(directory, 'answer.txt'), 'Test TAP and ON_VISIBLE.');
  const args = [script, '--check', join(directory, 'answer.txt'), '--checks', join(directory, 'checks.json')];
  const checked = await promisify(execFile)(process.execPath, args);
  assert.deepEqual(JSON.parse(checked.stdout), {passed: true, missing: []});
  await writeFile(join(directory, 'answer.txt'), 'Test TAP only.');
  await assert.rejects(promisify(execFile)(process.execPath, args), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(JSON.parse(error.stdout), {passed: false, missing: [{key: 'trigger', fact: checks[0].fact}]});
    return true;
  });
});

test('local checks report omissions and reject invalid check definitions', () => {
  const checks = [{key: 'trigger', patterns: ['\\bTAP\\b', 'ON_VISIBLE'], fact: 'Include both trigger tests.'}];
  assert.deepEqual(checkCodexAnswer({answer: 'tap, on_visible', checks}), {passed: true, missing: []});
  assert.deepEqual(checkCodexAnswer({answer: 'TAP', checks}), {passed: false, missing: [{key: 'trigger', fact: checks[0].fact}]});
  assert.throws(() => checkCodexAnswer({answer: null, checks}), /answer/);
  for (const invalid of [[], null, [{key: 'trigger', patterns: [], fact: ''}], [{...checks[0], patterns: [null]}]])
    assert.throws(() => checkCodexAnswer({answer: 'TAP', checks: invalid}), /checks/);
});
