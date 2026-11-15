import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showSetTarget, valueAt, workoutTarget } from './workoutTargets.js';

test('new live targets use integer slider bounds and old targets remain usable', () => {
  assert.equal(workoutTarget('reps', 0), 1);
  assert.equal(workoutTarget('reps', 80), 25);
  assert.equal(workoutTarget('reps', 7.6), 8);
  assert.equal(workoutTarget('reps', undefined), 12);
  assert.equal(workoutTarget('sets', 10), 10);
  assert.equal(workoutTarget('sets', 12), 10);
  assert.equal(workoutTarget('sets', null), 4);
});

test('track position maps to the complete adjustable range', () => {
  assert.equal(valueAt(0, 200, 25), 1);
  assert.equal(valueAt(200, 200, 25), 25);
  assert.equal(valueAt(100, 200, 25), 13);
  assert.equal(valueAt(250, 200, 10), 10);
  assert.equal(valueAt(-10, 200, 10), 1);
});

test('these live exercises can record sets while hiding the set target', () => {
  for (const id of ['deadlift', 'shoulder_press', 'pull_up']) assert.equal(showSetTarget(id), false);
  for (const id of ['squat', 'push_up', 'curl', 'lunge']) assert.equal(showSetTarget(id), true);
});
