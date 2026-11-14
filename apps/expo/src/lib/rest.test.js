import assert from 'node:assert/strict';
import { test } from 'node:test';

import { restFor } from './rest.js';

test('heavy compound lifts at low reps get long strength rest', () => {
  const r = restFor({ exercise: 'squat', reps: 5, rpe: 8 });
  assert.equal(r.seconds, 180);
  assert.equal(r.goal, 'strength');
  assert.equal(r.text, 'Squat · 5 reps: 3:00 rest for strength');
  assert.equal(restFor({ exercise: 'deadlift', reps: 3 }).seconds, 180);
  assert.equal(restFor({ exercise: 'bench', reps: 6 }).seconds, 180);
});

test('heavy compounds at 7-8 reps rest 2:30; higher reps 2:00', () => {
  assert.equal(restFor({ exercise: 'bench', reps: 8, rpe: 7 }).seconds, 150);
  assert.equal(restFor({ exercise: 'squat', reps: 12 }).seconds, 120);
});

test('other compounds (press, pull-up) sit between heavy lifts and isolation', () => {
  assert.equal(restFor({ exercise: 'shoulder_press', reps: 5 }).seconds, 150);
  assert.equal(restFor({ exercise: 'pull_up', reps: 8 }).seconds, 120);
});

test('isolation (curl) rests 60-90 s', () => {
  assert.equal(restFor({ exercise: 'curl', reps: 8 }).seconds, 90);
  assert.equal(restFor({ exercise: 'curl', reps: 12 }).seconds, 75);
  assert.equal(restFor({ exercise: 'curl', reps: 10, rpe: 7 }).text, 'Bicep curl · 10 reps: 1:15 rest for muscle growth');
});

test('RPE 9+ adds 30 s; core work stays short', () => {
  const hard = restFor({ exercise: 'squat', reps: 5, rpe: 9.5 });
  assert.equal(hard.seconds, 210);
  assert.match(hard.text, /RPE 9\.5/);
  assert.equal(restFor({ exercise: 'curl', reps: 12, rpe: 10 }).seconds, 105);
  assert.equal(restFor({ exercise: 'plank', reps: 1 }).seconds, 45);
  assert.equal(restFor({ exercise: 'crunch', reps: 15 }).seconds, 45);
});

test('unknown exercise falls back to 90 s; missing reps assumes a moderate set', () => {
  assert.equal(restFor({ exercise: 'mystery', reps: 10 }).seconds, 90);
  assert.equal(restFor({ exercise: 'bench' }).seconds, 150);
  assert.equal(restFor({ exercise: 'bench' }).text, 'Bench press: 2:30 rest for strength');
});
