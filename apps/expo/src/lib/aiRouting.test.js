import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeToClaude, AI_TASKS } from './aiRouting.js';

const ctx = { settings: { fitnessGoal: 'strength' }, plan: { goal: 'strength' } };
const task = (m, c = ctx) => routeToClaude(m, c);

test('goal changes go to Claude to re-plan exercises', () => {
  for (const m of ['change my goal to building muscle', 'I want to focus on endurance now', 'switch my goal to fat loss', 'new goal: get stronger legs'])
    assert.equal(task(m).task, 'goal_change', m);
});
test('a request that conflicts with the saved goal or plan goes to Claude', () => {
  assert.equal(task('I want to lose weight but my plan is all heavy lifting').task, 'conflict');
  assert.equal(task('my knee hurts on squats but they are in my plan, what do I do instead').task, 'conflict');
  assert.equal(task('I mainly want to run a marathon').task, 'conflict'); // saved goal is strength
});
test('complex questions go to Claude', () => {
  assert.equal(task('why am I getting weaker on bench even though I train it twice a week and sleep fine?').task, 'complex_question');
  assert.equal(task('should I do more volume or more intensity for my squat?').task, 'complex_question');
});
test('talking about a workout gets a personalised AI review', () => {
  for (const m of ['how did my workout go?', 'review my last workout', 'let’s talk about today’s session'])
    assert.equal(task(m).task, 'workout_review', m);
});
test('the weekly progress review uses Claude', () => {
  for (const m of ['weekly review', 'how was my week?', 'review my week']) assert.equal(task(m).task, 'weekly_review', m);
});
test('simple commands, logging and quick facts stay on the phone', () => {
  for (const m of ['log 10 curls at 25', 'yes', 'start workout', 'how many reps', 'rest timer', 'what is next', 'delete my last set', 'hi'])
    assert.equal(task(m).use, false, m);
});
test('every Claude route explains why, so the UI can show it', () => {
  const r = task('weekly review');
  assert.equal(r.use, true);
  assert.ok(r.reason.length > 10);
  assert.deepEqual(Object.keys(AI_TASKS).sort(), ['complex_question', 'conflict', 'goal_change', 'weekly_review', 'workout_review']);
});
