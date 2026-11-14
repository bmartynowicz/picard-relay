import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGuideState,SAMPLE_REQUEST,SAMPLE_ANSWER} from '../examples/landing/learning-guide.mjs';

test('the teaching flow reviews before showing an example and reopens the same answer',()=>{
 const guide=createGuideState();
 assert.equal(guide.stage,'request');assert.equal(guide.saved,false);
 guide.reopen();assert.equal(guide.stage,'request');
 guide.next();assert.equal(guide.stage,'review');assert.equal(guide.saved,false);
 guide.back();assert.equal(guide.stage,'request');
 guide.next();guide.next();assert.equal(guide.stage,'answer');assert.equal(guide.saved,true);
 guide.back();assert.equal(guide.stage,'saved');guide.reopen();assert.equal(guide.stage,'answer');
 assert.match(SAMPLE_REQUEST,/three next actions/);assert.match(SAMPLE_ANSWER,/Open the completed job/);
 guide.next();assert.equal(guide.stage,'answer');
});

test('practice sessions stay independent and reset explicitly',()=>{
 const first=createGuideState(),second=createGuideState();first.next();first.next();
 assert.equal(second.stage,'request');assert.equal(second.saved,false);
 first.reset();assert.equal(first.stage,'request');assert.equal(first.saved,false);
});
