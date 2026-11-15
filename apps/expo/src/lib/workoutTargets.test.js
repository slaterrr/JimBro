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

test('Mission adjusts only the current exercise, preserving sets already logged', async () => {
  const { currentTarget, missionStart, missionStep } = await import('./mission.js');
  const exercise = { exercise: 'squat', reps: 12, sets: 4, weight: 50, unit: 'lb', camera: true, rest_s: 90 };
  const trailing = { ...exercise, exercise: 'pull_up' };
  let state = missionStart({ items: [exercise, trailing] });
  state = { ...state, setNo: 3, phase: 'rest', log: [{ reps: 12 }, { reps: 12 }] };
  const updated = missionStep(state, { type: 'adjust_targets', exercise: 'squat', reps: 25, sets: 1 });
  assert.equal(currentTarget(updated).reps, 25);
  assert.equal(currentTarget(updated).sets, 3);
  assert.equal(updated.mission.items[1], trailing);
  assert.equal(updated.log, state.log);
  assert.equal(updated.phase, 'rest');
  assert.equal(missionStep(state, { type: 'adjust_targets', exercise: 'pull_up', reps: 10 }), state);
  const pending = { ...state, phase: 'check' };
  assert.equal(missionStep(pending, { type: 'adjust_targets', exercise: 'squat', reps: 10 }), pending);
});
