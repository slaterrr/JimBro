// Contract tests for the Expo app's pure helpers. Run: npm test (node --test).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES, exerciseName } from './exercises.js';
import { parseSetUtterance } from './parse.js';
describe('exercises', () => {
  it('maps the catalog lifts to display names', () => {
    assert.deepEqual(EXERCISES.map((e) => e.id), ['curl', 'squat', 'bench', 'deadlift', 'shoulder_press', 'pull_up', 'lunge']);
    assert.equal(exerciseName('shoulder_press'), 'Shoulder press');
    assert.equal(exerciseName('mystery'), 'mystery');
  });
});

describe('parseSetUtterance (keyboard dictation / typed)', () => {
  it('parses common phrasings', () => {
    assert.deepEqual(parseSetUtterance('10 curls at 20 pounds rpe 7'), { exercise: 'curl', reps: 10, weight: 20, unit: 'lb', rpe: 7 });
    assert.deepEqual(parseSetUtterance('ten squats at sixty kilos'), { exercise: 'squat', reps: 10, weight: 60, unit: 'kg' });
    assert.deepEqual(parseSetUtterance('did 12 pull ups'), { exercise: 'pull_up', reps: 12, weight: 0 });
    assert.equal(parseSetUtterance('overhead press 6 reps 30 lbs').exercise, 'shoulder_press');
  });
  it('returns null for chat that is not a set', () => {
    assert.equal(parseSetUtterance('how should I train legs?'), null);
  });
});
