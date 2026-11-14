import assert from 'node:assert/strict';
import { test } from 'node:test';

import { goalProgress, planAdherence, weeklyCheckIn, migrateGoals } from './goals.js';

const NOW = new Date('2026-11-14T12:00:00Z'); // Saturday; week starts Mon 2026-11-09
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const set = (exercise, weight, reps, extra = {}) => ({ exercise, weight, reps, unit: 'lb', rpe: null, source: 'manual', ...extra });
const w = (n, sets, extra = {}) => ({ id: `w${n}`, name: 'S', startedAt: daysAgo(n), sets, ...extra });

test('strength goal: current e1RM, pct and evidence with real numbers', () => {
  const g = { id: 'g', type: 'strength', exercise: 'bench', metric: 'e1rm', target: 250, unit: 'lb' };
  const r = goalProgress(g, [w(20, [set('bench', 185, 5)]), w(2, [set('bench', 200, 5)])], NOW);
  assert.equal(r.current, 232.5); // Epley 233.3 rounded to the 2.5 lb step
  assert.equal(r.target, 250);
  assert.equal(r.pct, 93);
  assert.match(r.evidence, /232\.5/);
  assert.match(r.evidence, /200 lb × 5/);
  assert.ok(r.nextStep.length > 0);
});

test('strength goal: onTrack is null with fewer than 2 weekly data points', () => {
  const g = { id: 'g', type: 'strength', exercise: 'bench', metric: 'weight', target: 250, unit: 'lb' };
  const r = goalProgress(g, [w(2, [set('bench', 200, 5)])], NOW);
  assert.equal(r.onTrack, null);
  assert.equal(r.projectedDate, null);
});

test('strength goal: rising trend projects a date and compares with deadline', () => {
  const ws = [w(22, [set('bench', 170, 1)]), w(15, [set('bench', 180, 1)]), w(8, [set('bench', 190, 1)]), w(1, [set('bench', 200, 1)])];
  const g = { id: 'g', type: 'strength', exercise: 'bench', metric: 'weight', target: 220, unit: 'lb', deadline: '2026-12-31' };
  const r = goalProgress(g, ws, NOW);
  assert.equal(r.current, 200);
  assert.equal(r.onTrack, true);
  assert.equal(r.projectedDate, '2026-11-28'); // +10 lb/week, 20 lb to go = 2 weeks
  const tight = goalProgress({ ...g, deadline: '2026-11-20' }, ws, NOW);
  assert.equal(tight.onTrack, false);
});

test('strength goal: flat trend is not on track and has no projected date', () => {
  const ws = [w(15, [set('bench', 200, 1)]), w(1, [set('bench', 200, 1)])];
  const r = goalProgress({ id: 'g', type: 'strength', exercise: 'bench', metric: 'weight', target: 220, unit: 'lb' }, ws, NOW);
  assert.equal(r.onTrack, false);
  assert.equal(r.projectedDate, null);
});

test('strength goal: converts kg sets to the goal unit and reports reached', () => {
  const r = goalProgress({ id: 'g', type: 'strength', exercise: 'squat', metric: 'weight', target: 220, unit: 'lb' }, [w(1, [set('squat', 100, 1, { unit: 'kg' })])], NOW);
  assert.equal(r.current, 220.5);
  assert.equal(r.pct, 100);
  assert.equal(r.onTrack, true);
});

test('consistency goal: counts weeks meeting N workouts', () => {
  const ws = [w(16, [set('curl', 20, 10)]), w(15, [set('curl', 20, 10)]), w(9, [set('curl', 20, 10)]), w(8, [set('curl', 20, 10)]), w(3, [set('curl', 20, 10)]), w(2, [set('curl', 20, 10)])];
  const r = goalProgress({ id: 'g', type: 'consistency', perWeek: 2, weeks: 4 }, ws, NOW);
  assert.equal(r.current, 3);
  assert.equal(r.target, 4);
  assert.equal(r.pct, 75);
  assert.equal(r.onTrack, true);
  assert.match(r.evidence, /2 workouts this week/);
});

test('consistency goal: no data gives honest null and a start suggestion', () => {
  const r = goalProgress({ id: 'g', type: 'consistency', perWeek: 3, weeks: 4 }, [], NOW);
  assert.equal(r.current, 0);
  assert.equal(r.onTrack, null);
  assert.match(r.evidence, /No workouts/);
});

test('volume goal on a muscle group sums lifts training it over the last 7 days', () => {
  const ws = [w(2, [set('curl', 30, 10), set('pull_up', 0, 10), set('bench', 100, 10)]), w(10, [set('curl', 100, 10)])];
  const r = goalProgress({ id: 'g', type: 'volume', muscle: 'biceps', target: 600, unit: 'lb' }, ws, NOW);
  assert.equal(r.current, 300);
  assert.equal(r.pct, 50);
  assert.match(r.evidence, /300/);
});

test('volume goal on an exercise', () => {
  const r = goalProgress({ id: 'g', type: 'volume', exercise: 'bench', target: 1000, unit: 'lb' }, [w(1, [set('bench', 100, 10)])], NOW);
  assert.equal(r.current, 1000);
  assert.equal(r.pct, 100);
});

test('reps goal counts only camera-verified sets when cameraOnly', () => {
  const ws = [w(3, [set('curl', 20, 22, { source: 'manual' }), set('curl', 20, 14, { source: 'camera' })])];
  const g = { id: 'g', type: 'reps', exercise: 'curl', target: 20, cameraOnly: true };
  const r = goalProgress(g, ws, NOW);
  assert.equal(r.current, 14);
  assert.equal(r.pct, 70);
  assert.match(r.evidence, /camera/);
  assert.equal(goalProgress({ ...g, cameraOnly: false }, ws, NOW).current, 22);
});

const PLAN = {
  goal: 'general',
  days: [
    { day: 1, items: [{ exercise: 'squat', sets: 3 }, { exercise: 'bench', sets: 3 }] },
    { day: 2, items: [{ exercise: 'deadlift', sets: 3 }, { exercise: 'curl', sets: 3 }] },
    { day: 3, items: [{ exercise: 'pull_up', sets: 3 }] },
  ],
};

test("planAdherence matches this week's workouts to planned days", () => {
  const ws = [
    w(4, [set('squat', 100, 5), set('squat', 100, 5), set('squat', 100, 5), set('bench', 100, 5)], { planned: PLAN.days[0] }),
    w(2, [set('curl', 20, 10), set('curl', 20, 10), set('curl', 20, 10)]),
    w(9, [set('pull_up', 0, 5)]), // last week: ignored
  ];
  const a = planAdherence(PLAN, ws, NOW);
  assert.equal(a.planned, 3);
  assert.equal(a.completed, 2);
  assert.deepEqual(a.days.map((d) => d.done), [true, true, false]);
  assert.deepEqual(a.done.map((i) => i.exercise), ['squat', 'curl']);
  assert.deepEqual(a.missed.map((i) => `${i.day}:${i.exercise}`), ['1:bench', '2:deadlift', '3:pull_up']);
});

test('planAdherence without a plan returns null', () => {
  assert.equal(planAdherence(null, [], NOW), null);
});

test('weeklyCheckIn says so when there is no data', () => {
  const c = weeklyCheckIn({ history: [], active: null, plan: null, goals: [] }, NOW);
  assert.equal(c.hasData, false);
  assert.match(c.suggestion, /Log/);
});

test('weeklyCheckIn builds wins, misses and a suggestion from data', () => {
  const state = {
    history: [w(2, [set('bench', 200, 5, { pr: true }), set('curl', 20, 15, { source: 'camera' })])],
    active: null,
    plan: PLAN,
    goals: [{ id: 'g', type: 'reps', exercise: 'curl', target: 20, cameraOnly: true }],
  };
  const c = weeklyCheckIn(state, NOW);
  assert.equal(c.hasData, true);
  assert.ok(c.wins.some((s) => /1 workout/.test(s)));
  assert.ok(c.wins.some((s) => /record/i.test(s)));
  assert.ok(c.wins.some((s) => /camera/i.test(s)));
  assert.ok(c.misses.some((s) => /planned/.test(s)));
  assert.equal(typeof c.suggestion, 'string');
  assert.ok(c.adherence);
});

test('migrateGoals treats a missing or bad field as empty', () => {
  assert.deepEqual(migrateGoals(undefined), []);
  assert.deepEqual(migrateGoals('x'), []);
  assert.deepEqual(migrateGoals([{ id: 'a', type: 'reps' }, { nope: 1 }]), [{ id: 'a', type: 'reps' }]);
});
