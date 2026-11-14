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
  assert.match(g, /\+|log|switch/i); // lunges are camera-counted now: the action is to switch
});

test('arm-lift exercise changes are explained neutrally and say how to count them', () => {
  const press = cameraGuidance('exercise_change', 'shoulder_press', 'curl');
  assert.match(press, /shoulder presses/i);
  assert.match(press, /curl counting is paused/i);
  assert.match(press, /switch to shoulder press/i);
  const curl = cameraGuidance('exercise_change', 'curl', 'shoulder_press');
  assert.match(curl, /curls/i);
  assert.match(curl, /press counting is paused/i);
  assert.match(curl, /switch to curl/i);
  for (const g of [press, curl]) assert.doesNotMatch(g, /cheat|wrong|bad/i);
});

test('push-up exercise changes use readable names, never raw ids', () => {
  const inCurl = cameraGuidance('exercise_change', 'push_up', 'curl');
  assert.match(inCurl, /push-ups/i);
  assert.match(inCurl, /curl counting is paused/i);
  assert.match(inCurl, /switch to push-ups/i);
  const upright = cameraGuidance('exercise_change', 'upright', 'push_up');
  assert.match(upright, /push-up counting is paused/i);
  assert.match(upright, /plank|hands/i);
  const squatInPu = cameraGuidance('exercise_change', 'squat', 'push_up');
  assert.match(squatInPu, /squats/i);
  assert.match(cameraGuidance('exercise_change', 'curl', 'push_up'), /push-up counting is paused/i);
  for (const g of [inCurl, upright, squatInPu, cameraGuidance('exercise_change', 'x', 'push_up')]) {
    assert.doesNotMatch(g, /_/);
    assert.doesNotMatch(g, /cheat|wrong|bad/i);
  }
});
