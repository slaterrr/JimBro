import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cameraGuidance, guidanceThrottle } from './guidance.js';

test('lost tracking names the body part to bring into view', () => {
  assert.match(cameraGuidance('tracking', 'feet', 'squat'), /feet/i);
  assert.match(cameraGuidance('tracking', 'knees', 'squat'), /knees/i);
  assert.match(cameraGuidance('tracking', 'arm', 'curl'), /arm/i);
});

test('every issue the counter can raise has guidance (no silent failures)', () => {
  for (const issue of ['tracking', 'framing', 'implausible_motion', 'arm_swing']) {
    assert.ok(cameraGuidance(issue, 'body', 'squat'), issue);
  }
  assert.equal(cameraGuidance(null, null, 'squat'), null);
});

test('spoken guidance repeats at most once per 8 s for the same problem', () => {
  const g = guidanceThrottle(8000);
  assert.equal(g('tracking:feet', 0), true);
  assert.equal(g('tracking:feet', 3000), false);
  assert.equal(g('framing:body', 3500), true);
  assert.equal(g('tracking:feet', 9000), true);
});

test('a detected exercise change is explained and tells the user what to do', () => {
  const g = cameraGuidance('exercise_change', 'lunge', 'squat');
  assert.match(g, /lunge/i);
  assert.match(g, /squat/i);
  assert.match(g, /\+|log/i);
});
