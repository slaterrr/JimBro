import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muscleProgress } from './muscleProgress.js';
import { appendWorkoutSet } from './workoutLogging.js';

test('logging cannot create a workout or write into a different session', () => {
  const idle = { active: null, history: [] };
  assert.equal(appendWorkoutSet(idle, { reps: 10 }, 'old'), idle);
  const state = { ...idle, active: { id: 'new', sets: [] } };
  assert.equal(appendWorkoutSet(state, { reps: 10 }, 'old'), state);
  assert.deepEqual(appendWorkoutSet(state, { reps: 10 }, 'new').active.sets, [{ reps: 10 }]);
  assert.deepEqual(state.active.sets, []);
});

test('chest progress separates bench and push-ups, sorts sessions and normalizes loads', () => {
  const workouts = [
    { id: 'b', startedAt: '2026-11-12', sets: [{ exercise: 'bench', reps: 10, weight: 100, unit: 'lb' }, { exercise: 'push_up', reps: 15, weight: 0, unit: 'lb' }] },
    { id: 'a', startedAt: '2026-11-10', sets: [{ exercise: 'bench', reps: 10, weight: 40, unit: 'kg' }, { exercise: 'push_up', reps: 12, weight: 0, unit: 'kg' }, { exercise: 'curl', reps: 20, weight: 10, unit: 'kg' }] },
  ];
  const charts = muscleProgress(workouts, 'chest', 'lb');
  assert.equal(charts.length, 2);
  assert.deepEqual(charts[0].points.map(p => p.value), [882, 1000]);
  assert.equal(charts[0].exercise, 'bench');
  assert.equal(charts[0].metric, 'Best set volume (lb × reps)');
  assert.equal(charts[1].exercise, 'push_up');
  assert.deepEqual(charts[1].points.map(p => p.value), [12, 15]);
  assert.equal(charts[1].metric, 'Most reps in one unweighted set');
});

test('loaded and unweighted sets of the same exercise never share a series', () => {
  const charts = muscleProgress([{ id: 'a', startedAt: '2026-11-10', sets: [
    { exercise: 'push_up', reps: 15, weight: 0, unit: 'lb' },
    { exercise: 'push_up', reps: 8, weight: 20, unit: 'lb' },
    { exercise: 'push_up', reps: 6, weight: 20, unit: 'lb' },
  ] }], 'chest');
  assert.equal(charts.length, 2);
  assert.deepEqual(charts.map(c => c.points[0].value).sort((a,b) => a-b), [15, 160]);
  assert.deepEqual(muscleProgress([], 'chest'), []);
  assert.deepEqual(muscleProgress([], 'unknown'), []);
});
