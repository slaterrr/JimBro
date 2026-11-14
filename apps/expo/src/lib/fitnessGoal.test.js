import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_GOAL_SETTINGS, FITNESS_GOAL_IDS, FITNESS_GOALS, fitnessGoalLabel, migrateGoalSettings } from './fitnessGoal.js';
import { MUSCLE_GROUPS } from './muscles.js';

test('five goal ids with labels, in contract order', () => {
  assert.deepEqual(FITNESS_GOAL_IDS, ['strength', 'muscle', 'endurance', 'fat_loss', 'general']);
  for (const g of FITNESS_GOALS) assert.ok(g.label.length > 0 && fitnessGoalLabel(g.id) === g.label);
  assert.equal(fitnessGoalLabel('nope'), fitnessGoalLabel('general'));
});

test('defaults: general goal, empty look, no focus muscles, activityLevel null', () => {
  assert.deepEqual(DEFAULT_GOAL_SETTINGS, { fitnessGoal: 'general', physiqueGoal: '', focusMuscles: [], activityLevel: null });
});

test('migration: old saves without goal fields get defaults, never crash', () => {
  assert.deepEqual(migrateGoalSettings(undefined), DEFAULT_GOAL_SETTINGS);
  const old = migrateGoalSettings({ persona: 'zen', unit: 'kg' });
  assert.equal(old.fitnessGoal, 'general');
  assert.equal(old.persona, 'zen');
  assert.deepEqual(old.focusMuscles, []);
});

test('migration: keeps valid values, repairs bad ones', () => {
  const ok = migrateGoalSettings({ fitnessGoal: 'strength', physiqueGoal: 'Broader shoulders', focusMuscles: ['shoulders', 'lats'], activityLevel: 'active' });
  assert.equal(ok.fitnessGoal, 'strength');
  assert.equal(ok.physiqueGoal, 'Broader shoulders');
  assert.deepEqual(ok.focusMuscles, ['shoulders', 'lats']);
  assert.equal(ok.activityLevel, 'active');
  const bad = migrateGoalSettings({ fitnessGoal: 'bulk', physiqueGoal: 42, focusMuscles: ['wings', 'chest'], activityLevel: 'couch' });
  assert.equal(bad.fitnessGoal, 'general');
  assert.equal(bad.physiqueGoal, '');
  assert.deepEqual(bad.focusMuscles, ['chest']);
  assert.equal(bad.activityLevel, null);
  assert.ok(MUSCLE_GROUPS.some((m) => m.id === 'chest'));
});
