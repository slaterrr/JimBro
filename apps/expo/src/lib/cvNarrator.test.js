import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCvNarrator } from './cvNarrator.js';

test('a blocked-rep cue and next rep cannot cut off a spoken form instruction', () => {
  const calls = [];
  const record = (text, options) => { calls.push({ text, options }); return true; };
  const narrator = createCvNarrator({ say: record, cue: record, stop() {} });
  narrator.say('Keep your elbows near your sides.');
  assert.equal(narrator.cue('Not counted'), false);
  assert.equal(narrator.cue('3'), false);
  assert.equal(calls.length, 1);
  calls[0].options.onDone();
  assert.equal(narrator.cue('4'), true);
  assert.equal(calls.at(-1).text, '4');
});

test('failed speech or leaving the camera releases the instruction lock', () => {
  const calls = [];
  const narrator = createCvNarrator({ say: (text, options) => { calls.push(options); return true; }, stop() {} });
  narrator.say('Step back.');
  calls[0].onError(new Error('unavailable'));
  assert.equal(narrator.say('Try again.'), true);
  narrator.stop();
  assert.equal(narrator.say('New workout.'), true);
});
