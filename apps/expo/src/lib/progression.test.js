// Session-to-session progression from real history, and a prepared workout whose prescribed sets
// are filled in automatically but never recorded as done without the user's tap.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exerciseSessions, recommendNext } from './progression.js';
import { loggedFor, prepareWorkout, setFromTap } from './prescription.js';

const workout = (date, sets) => ({ id: `w-${date}`, startedAt: `${date}T15:00:00.000Z`, finishedAt: `${date}T16:00:00.000Z`, sets: sets.map((s, i) => ({ id: `${date}-${i}`, unit: 'lb', ...s })) });
const bench = (date, reps, weight = 135) => workout(date, reps.map((r) => ({ exercise: 'bench', reps: r, weight })));
const range = { reps_low: 6, reps_high: 10, unit: 'lb' };

describe('progression', () => {
  it('reads sessions in order and keeps every result', () => {
    const h = [bench('2026-11-05', [9, 9, 8]), bench('2026-11-01', [8, 8, 7])];
    const s = exerciseSessions(h, 'bench', 'lb');
    assert.deepEqual(s.map((x) => x.date), ['2026-11-01', '2026-11-05']);
    assert.equal(s[1].top.weight, 135);
    assert.equal(h[0].sets.length, 3); // input untouched
  });

  it('135 × 8, 9, 10: improving, every set at the top of the range -> add weight', () => {
    const h = [bench('2026-11-01', [8, 8]), bench('2026-11-04', [9, 9]), bench('2026-11-07', [10, 10])];
    const r = recommendNext(h, 'bench', range);
    assert.equal(r.trend, 'improving');
    assert.equal(r.action, 'increase');
    assert.equal(r.weight, 140);
    assert.equal(r.reps, 6);
    assert.match(r.why, /135 lb/);
  });

  it('still inside the range -> same weight, one more rep', () => {
    const r = recommendNext([bench('2026-11-01', [8, 8]), bench('2026-11-04', [9, 8])], 'bench', range);
    assert.equal(r.action, 'add_rep');
    assert.equal(r.weight, 135);
    assert.equal(r.reps, 9);
  });

  it('three sessions stuck -> plateau, hold and explain', () => {
    const h = ['2026-11-01', '2026-11-04', '2026-11-07'].map((d) => bench(d, [8, 7]));
    const r = recommendNext(h, 'bench', range);
    assert.equal(r.trend, 'plateau');
    assert.equal(r.action, 'hold');
    assert.match(r.why, /three sessions|3 sessions/i);
  });

  it('two drops in a row -> declining, reduce about 10% (rounded to a plate step)', () => {
    const h = [bench('2026-11-01', [10, 10]), bench('2026-11-04', [8, 8]), bench('2026-11-07', [6, 5])];
    const r = recommendNext(h, 'bench', range);
    assert.equal(r.trend, 'declining');
    assert.equal(r.action, 'reduce');
    assert.equal(r.weight, 120);
    assert.match(r.why, /recover|sleep|rest/i);
  });

  it('lower body steps are bigger; kg uses kg steps', () => {
    const squat = [workout('2026-11-01', [{ exercise: 'squat', reps: 10, weight: 100, unit: 'kg' }, { exercise: 'squat', reps: 10, weight: 100, unit: 'kg' }])];
    const r = recommendNext(squat, 'squat', { reps_low: 6, reps_high: 10, unit: 'kg' });
    assert.equal(r.weight, 105);
  });

  it('no history -> no invented weight', () => {
    const r = recommendNext([], 'bench', range);
    assert.equal(r.action, 'start');
    assert.equal(r.weight, null);
    assert.equal(r.reps, 6);
  });
});

describe('prepared workout', () => {
  const planned = { name: 'Push', items: [{ exercise: 'bench', sets: 3, reps_low: 6, reps_high: 10, rest_min: 2.5, rpe_low: 7, rpe_high: 8 }, { exercise: 'push_up', sets: 2, reps_low: 10, reps_high: 15, rest_min: 1 }, { exercise: 'lateral_raise', sets: 2, reps_low: 12, reps_high: 15, rest_min: 1 }] };
  const history = [bench('2026-11-01', [8, 8]), bench('2026-11-04', [9, 8])];

  it('fills prescribed sets, reps, rest and weight from the plan and history', () => {
    const p = prepareWorkout(planned, { history, unit: 'lb' });
    const b = p.exercises[0];
    assert.equal(b.sets, 3);
    assert.deepEqual([b.target.reps, b.target.weight, b.target.rest_sec], [9, 135, 150]);
    assert.match(b.previous.text, /9, 8 × 135 lb/);
    assert.equal(p.exercises[1].target.weight, null);
    assert.equal(p.exercises[1].bodyweight, true);
    assert.equal(p.exercises[2].needsWeight, true); // no history: the user picks the weight
  });

  it('preparing records nothing; one tap records the target, edits record the actual', () => {
    const p = prepareWorkout(planned, { history, unit: 'lb' });
    assert.equal(loggedFor({ sets: [] }, 'bench').length, 0);
    const tap = setFromTap(p.exercises[0], 0);
    assert.deepEqual([tap.reps, tap.weight, tap.target, tap.set_index, tap.prescribed], [9, 135, 9, 0, true]);
    const edited = setFromTap(p.exercises[0], 1, { reps: 7 });
    assert.deepEqual([edited.reps, edited.target], [7, 9]);
    assert.equal(setFromTap(p.exercises[2], 0), null); // no weight known yet: not recorded
    assert.equal(setFromTap(p.exercises[2], 0, { weight: 15 }).weight, 15);
    assert.equal(setFromTap(p.exercises[1], 0).weight, 0); // bodyweight
    assert.equal(loggedFor({ sets: [tap, edited] }, 'bench').length, 2);
  });
});
