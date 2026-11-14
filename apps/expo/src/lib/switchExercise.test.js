// Switch-exercise decision when the camera thinks the user changed exercise.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISES } from './exercises.js';
import { EXERCISE_MUSCLES } from './muscles.js';
import { restFor } from './rest.js';
import { switchPlan } from './switchExercise.js';

describe('switchPlan', () => {
  it('camera-countable suggestion switches, logging counted reps first', () => {
    const p = switchPlan({ current: 'curl', suggested: 'squat', counted: 4 });
    assert.equal(p.kind, 'camera');
    assert.equal(p.logFirst, true);
    assert.equal(p.label, 'Looks like Squat. Switch?');
    assert.deepEqual(p.actions.map((a) => a.id), ['switch', 'keep']);
    assert.equal(p.actions[0].label, 'Switch to Squat');
    assert.equal(p.actions[1].label, 'Keep Bicep curl');
  });
  it('no counted reps: nothing to log first', () => {
    assert.equal(switchPlan({ current: 'curl', suggested: 'squat', counted: 0 }).logFirst, false);
  });
  it('manual-log suggestion (lunge) offers logging with +', () => {
    const p = switchPlan({ current: 'squat', suggested: 'lunge', counted: 2 });
    assert.equal(p.kind, 'manual');
    assert.equal(p.logFirst, true);
    assert.equal(p.label, 'Looks like Lunge. Switch?');
    assert.deepEqual(p.actions.map((a) => [a.id, a.label]), [['log', 'Log lunges with +'], ['keep', 'Keep Squat']]);
  });
  it('unknown suggestion is treated as manual with its id as name', () => {
    assert.equal(switchPlan({ current: 'curl', suggested: 'row', counted: 0 }).kind, 'manual');
  });
  it('returns null when no suggestion or same exercise', () => {
    assert.equal(switchPlan({ current: 'curl', suggested: null, counted: 0 }), null);
    assert.equal(switchPlan({ current: 'curl', suggested: 'curl', counted: 3 }), null);
  });
});

describe('lunge catalog entry', () => {
  it('is a manual-log exercise with lower-body muscles and compound rest', () => {
    assert.deepEqual(EXERCISES.find((e) => e.id === 'lunge'), { id: 'lunge', name: 'Lunge', camera: false });
    assert.deepEqual(EXERCISE_MUSCLES.lunge, ['quads', 'glutes', 'hamstrings']);
    assert.equal(restFor({ exercise: 'lunge', reps: 10 }).seconds, 120);
  });
});
