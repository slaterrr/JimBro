import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXERCISES, exerciseInfo } from './exercises.js';
import { countsWithCamera } from './analyzers.js';
import { parseSetUtterance } from './parse.js';
import { matchExercise } from './importWorkouts.js';
import { buildPlan } from './plans.js';
import { planFromGoal } from './planFromGoal.js';
import { FOCUS_EXERCISES, cameraSwap } from './mission.js';
import { repeatPlan, parseImport } from './tools.js';
import { suggestNext } from './coach.js';
import { migrateRetiredExercises } from './retiredExercises.js';

test('bicep curl is unavailable in selectors, camera support, text logging and spreadsheet imports', () => {
  assert.equal(EXERCISES.some((e) => e.id === 'curl'), false);
  assert.equal(exerciseInfo('curl'), null);
  assert.equal(countsWithCamera('curl'), false);
  for (const name of ['curl', 'curls', 'bicep curl', 'biceps curls']) {
    assert.equal(parseSetUtterance(`10 ${name} at 20 lb`), null);
    assert.equal(matchExercise(name), null);
  }
});

test('plans and camera substitutions never prescribe the retired lift', () => {
  const plan = buildPlan({ goal: 'hypertrophy', days_per_week: 6, minutes_per_session: 90, equipment: ['barbell', 'dumbbells', 'pullup_bar'] });
  const goal = planFromGoal({ focusMuscles: ['biceps'], daysPerWeek: 6 });
  for (const p of [plan, goal]) assert.equal(p.days.some((d) => d.items.some((i) => i.exercise === 'curl')), false);
  assert.equal(Object.values(FOCUS_EXERCISES).flat().includes('curl'), false);
  assert.notEqual(cameraSwap('pull_up'), 'curl');
});

test('old curl records survive restore but cannot generate new work', () => {
  const set = { exercise: 'curl', weight: 20, reps: 10, unit: 'lb' };
  const history = [{ id: 'old', startedAt: '2026-11-01T12:00:00Z', sets: [set] }];
  assert.deepEqual(parseImport(JSON.stringify({ format: 'jimbro-phone-export-v1', history })).history, history);
  assert.deepEqual(repeatPlan(history[0]).items, []);
  assert.equal(suggestNext([set]), null);
  const plan = { weeks: [{ sessions: [{ items: [{ exercise: 'curl' }, { exercise: 'squat' }] }] }] };
  const data = { history, plan, active: { sets: [set], planned: { items: [{ exercise: 'curl' }] } }, goals: [{ exercise: 'curl' }], mission: { state: { exercise: 'curl' } } };
  const migrated = migrateRetiredExercises(data);
  assert.deepEqual(migrated.history, history);
  assert.deepEqual(migrated.active.sets, [set]);
  assert.deepEqual(migrated.plan.weeks[0].sessions[0].items, [{ exercise: 'squat' }]);
  assert.deepEqual(migrated.active.planned.items, []);
  assert.deepEqual(migrated.goals, []);
  assert.equal(migrated.mission, null);
});
