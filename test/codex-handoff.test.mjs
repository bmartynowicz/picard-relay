import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {prepareCodexHandoff} from '../tools/codex-handoff.mjs';

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
