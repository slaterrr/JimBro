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


// Goal-personalized rest (settings.fitnessGoal). No goal / 'general' keeps the rules above.
test('general goal (and no goal) keep the moderate per-exercise rules', () => {
  for (const ex of ['squat', 'bench', 'curl', 'pull_up', 'plank']) {
    for (const reps of [5, 10]) {
      assert.equal(restFor({ exercise: ex, reps, fitnessGoal: 'general' }).seconds, restFor({ exercise: ex, reps }).seconds);
    }
  }
});

test('strength goal: heavy compounds rest 3 min (2-5 min range), with the reason shown', () => {
  const r = restFor({ exercise: 'squat', reps: 5, fitnessGoal: 'strength' });
  assert.equal(r.seconds, 180);
  assert.equal(r.text, 'Squat · 5 reps: 3:00 rest. Strength goal + heavy lift');
  assert.equal(restFor({ exercise: 'squat', reps: 10, fitnessGoal: 'strength' }).seconds, 180);
  assert.equal(restFor({ exercise: 'shoulder_press', reps: 6, fitnessGoal: 'strength' }).seconds, 150);
  assert.equal(restFor({ exercise: 'curl', reps: 8, fitnessGoal: 'strength' }).seconds, 90);
});

test('muscle goal: 60-120 s', () => {
  const s = (exercise) => restFor({ exercise, reps: 10, fitnessGoal: 'muscle' }).seconds;
  assert.equal(s('squat'), 120);
  assert.equal(s('row'), 90);
  assert.equal(s('curl'), 60);
  assert.match(restFor({ exercise: 'curl', reps: 10, fitnessGoal: 'muscle' }).text, /Muscle goal/);
});

test('endurance goal: 30-60 s', () => {
  const s = (exercise) => restFor({ exercise, reps: 15, fitnessGoal: 'endurance' }).seconds;
  assert.equal(s('squat'), 60);
  assert.equal(s('pull_up'), 45);
  assert.equal(s('curl'), 30);
  assert.equal(s('plank'), 30);
});

test('the removed fat-loss goal (old saves) uses the general rules', () => {
  for (const ex of ['squat', 'row', 'curl']) {
    assert.equal(restFor({ exercise: ex, reps: 12, fitnessGoal: 'fat_loss' }).seconds, restFor({ exercise: ex, reps: 12 }).seconds, ex);
  }
});

test('every goal: hard set (RPE 9+) adds 30 s; beginners and sedentary users get +15 s', () => {
  for (const fitnessGoal of ['strength', 'muscle', 'endurance', 'general']) {
    const b = restFor({ exercise: 'bench', reps: 8, fitnessGoal }).seconds;
    assert.equal(restFor({ exercise: 'bench', reps: 8, rpe: 9, fitnessGoal }).seconds, b + 30, fitnessGoal);
    const easy = restFor({ exercise: 'bench', reps: 8, fitnessGoal, experience: 'new' });
    assert.equal(easy.seconds, b + 15, fitnessGoal);
    assert.match(easy.text, /easing in/);
    assert.equal(restFor({ exercise: 'bench', reps: 8, fitnessGoal, activityLevel: 'sedentary' }).seconds, b + 15);
    assert.equal(restFor({ exercise: 'bench', reps: 8, fitnessGoal, experience: 'new', activityLevel: 'sedentary' }).seconds, b + 15);
    assert.equal(restFor({ exercise: 'bench', reps: 8, fitnessGoal, activityLevel: 'very_active' }).seconds, b);
  }
});

test('unknown goal falls back to general', () => {
  assert.equal(restFor({ exercise: 'squat', reps: 5, fitnessGoal: 'bulk' }).seconds, 180);
});
