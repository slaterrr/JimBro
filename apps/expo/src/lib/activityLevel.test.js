import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTIVITY_LEVELS, activityLevel } from './activityLevel.js';

const NOW = new Date('2026-11-14T12:00:00Z');
// n consecutive days ending yesterday, each produced by fn(i).
const days = (n, fn) => Array.from({ length: n }, (_, i) => {
  const d = new Date(NOW.getTime() - (i + 1) * 86400000);
  return { date: d.toISOString().slice(0, 10), ...fn(i) };
});

test('levels list matches the shared settings contract', () => {
  assert.deepEqual(ACTIVITY_LEVELS, ['sedentary', 'light', 'moderate', 'active', 'very_active']);
});

for (const [steps, level] of [[3000, 'sedentary'], [6000, 'light'], [8500, 'moderate'], [11000, 'active'], [14000, 'very_active']]) {
  test(`steps only: ${steps}/day for 30 days -> ${level} (Tudor-Locke bands)`, () => {
    const r = activityLevel({ daily: days(30, () => ({ steps })) }, NOW);
    assert.equal(r.level, level);
    assert.equal(r.daysOfData, 30);
    assert.ok(r.evidence.some((e) => e.includes(steps.toLocaleString('en-US'))));
  });
}

for (const [min, level] of [[0, 'sedentary'], [5, 'light'], [15, 'moderate'], [30, 'active'], [50, 'very_active']]) {
  test(`exercise only: ${min} min/day (${min * 7}/wk) -> ${level} (WHO 150 min/wk)`, () => {
    const r = activityLevel({ daily: days(28, () => ({ exerciseMin: min })) }, NOW);
    assert.equal(r.level, level);
  });
}

test('steps and exercise combined: average of the two bands, rounded up', () => {
  // light steps (6000) + active exercise (30 min/day = 210/wk) -> between -> moderate
  const r = activityLevel({ daily: days(30, () => ({ steps: 6000, exerciseMin: 30 })) }, NOW);
  assert.equal(r.level, 'moderate');
  assert.equal(r.confidence, 'high');
});

test('workouts count toward weekly minutes when no exercise-time data', () => {
  const workouts = days(28, () => ({})).filter((_, i) => i % 7 < 3).map((d) => ({ date: d.date, minutes: 60 })); // 3x60 = 180/wk
  const r = activityLevel({ daily: days(28, () => ({ steps: 11000 })), workouts }, NOW);
  assert.equal(r.level, 'active');
  assert.ok(r.evidence.some((e) => /workouts/.test(e)));
});

test('median steps ignores one-off outliers (a marathon day)', () => {
  const r = activityLevel({ daily: days(30, (i) => ({ steps: i === 3 ? 60000 : 4000 })) }, NOW);
  assert.equal(r.level, 'sedentary');
});

test('fewer than 7 days of data -> no level, honest message', () => {
  const r = activityLevel({ daily: days(5, () => ({ steps: 12000 })) }, NOW);
  assert.equal(r.level, null);
  assert.equal(r.confidence, 'none');
  assert.equal(r.daysOfData, 5);
  assert.match(r.message, /not enough/i);
});

test('gaps: days with no records are not counted as zero steps', () => {
  const r = activityLevel({ daily: days(60, (i) => (i % 3 === 0 ? { steps: 9000 } : {})) }, NOW);
  assert.equal(r.daysOfData, 20);
  assert.equal(r.level, 'moderate');
  assert.equal(r.confidence, 'medium');
});

test('7-13 days -> low confidence', () => {
  const r = activityLevel({ daily: days(10, () => ({ steps: 9000 })) }, NOW);
  assert.equal(r.confidence, 'low');
});

test('data older than 90 days is ignored', () => {
  const old = days(120, () => ({ steps: 15000 })).slice(90);
  const r = activityLevel({ daily: old }, NOW);
  assert.equal(r.level, null);
});

test('active energy is shown as evidence but does not set the level', () => {
  const r = activityLevel({ daily: days(30, () => ({ steps: 3000, activeKcal: 900 })) }, NOW);
  assert.equal(r.level, 'sedentary');
  assert.ok(r.evidence.some((e) => /900 kcal/.test(e)));
});

test('wording never shames', () => {
  const r = activityLevel({ daily: days(30, () => ({ steps: 1000 })) }, NOW);
  assert.doesNotMatch([r.message, ...r.evidence].join(' '), /lazy|bad|poor|fail|should be ashamed|couch/i);
});
