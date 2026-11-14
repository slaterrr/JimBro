import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { healthSummary } from './healthSummary.js';

const demo = JSON.parse(readFileSync(new URL('./fixtures/demo-workouts.json', import.meta.url), 'utf8'));
// Fri 2026-11-13; the week (Mon UTC) starts 2026-11-09 -> demo workouts on 11-10 and 11-12, no camera sets.
const NOW = new Date('2026-11-13T12:00:00Z');
const GOAL = { id: 'g1', type: 'consistency', perWeek: 3, weeks: 8 };

test('demo fixture: 2 sessions, 0 camera reps, consistency 2/3, next step from the goal', () => {
  const s = healthSummary({ history: demo.history, goals: [GOAL] }, NOW);
  assert.equal(s.empty, false);
  assert.equal(s.sessions, 2);
  assert.equal(s.cameraReps, 0);
  assert.deepEqual(s.consistency, { done: 2, perWeek: 3 });
  assert.equal(s.nextStep, '1 more workout this week keeps the streak going.');
  assert.equal(s.text, 'This week: 2 sessions · 0 camera-verified reps · consistency goal 2/3 · next step: 1 more workout this week keeps the streak going.');
});

test('active workout with camera sets counts (10 + 8 camera reps, manual set ignored)', () => {
  const active = { id: 'a', startedAt: '2026-11-13T10:00:00Z', sets: [
    { exercise: 'squat', weight: 95, unit: 'lb', reps: 10, source: 'camera' },
    { exercise: 'curl', weight: 20, unit: 'lb', reps: 8, source: 'camera' },
    { exercise: 'bench', weight: 95, unit: 'lb', reps: 8, source: 'manual' },
  ] };
  const s = healthSummary({ history: demo.history, active, goals: [GOAL] }, NOW);
  assert.equal(s.sessions, 3);
  assert.equal(s.cameraReps, 18);
  assert.deepEqual(s.consistency, { done: 3, perWeek: 3 });
});

test('no consistency goal: that segment is left out', () => {
  const s = healthSummary({ history: demo.history }, NOW);
  assert.equal(s.consistency, null);
  assert.doesNotMatch(s.text, /consistency/);
  assert.match(s.text, /^This week: 2 sessions · 0 camera-verified reps · next step: /);
});

test('one session reads singular', () => {
  const s = healthSummary({ history: demo.history.slice(0, -1) }, NOW);
  assert.match(s.text, /^This week: 1 session · /);
});

test('honest empty state', () => {
  const s = healthSummary({ history: demo.history }, new Date('2026-11-23T12:00:00Z'));
  assert.equal(s.empty, true);
  assert.equal(s.sessions, 0);
  assert.equal(s.text, 'No workouts yet this week — start one below');
  assert.equal(healthSummary({}, NOW).text, 'No workouts yet this week — start one below');
});
