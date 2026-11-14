// Expected numbers computed by hand from the demo fixture (arithmetic in the comments).
process.env.TZ = 'America/New_York';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compareSessions, comparePeriods, historyNewestFirst, workoutVolume } from './compare.js';

const data = JSON.parse(readFileSync(new URL('./fixtures/demo-workouts.json', import.meta.url), 'utf8'));
const W = data.history;
const NOW = new Date('2026-11-14T17:00:00Z');

test('history is newest first and complete; input not mutated', () => {
  const h = historyNewestFirst(W);
  assert.equal(h.length, 14);
  assert.equal(h[0].startedAt.slice(0, 10), '2026-11-12');
  assert.equal(h[13].startedAt.slice(0, 10), '2026-10-14');
  assert.equal(W[0].startedAt.slice(0, 10), '2026-10-14');
});

test('workout volume: Nov 12 = squat 135x(8+8+7)=3105 + deadlift 155x(6+6+5)=2635', () => {
  assert.equal(workoutVolume(W[13], 'lb'), 5740);
});

test('curl: Nov 10 (25x10x3) vs Nov 5 (22.5x10,10,9)', () => {
  const c = compareSessions(W, 'curl', 'lb');
  // e1RM Epley 25*(1+10/30)=33.3 -> 32.5 (2.5 lb step); 22.5*4/3 = 30
  assert.deepEqual([c.current.topWeight, c.current.e1rm, c.current.volume], [25, 32.5, 750]);
  assert.deepEqual([c.previous.topWeight, c.previous.e1rm, c.previous.volume], [22.5, 30, 652.5]);
  // 25/22.5 = +11.1%, 32.5/30 = +8.3%, 750/652.5 = +14.9%
  assert.deepEqual(c.change, { topWeightPct: 11.1, e1rmPct: 8.3, volumePct: 14.9 });
  assert.equal(c.text, 'Bicep curl Nov 10 vs Nov 5: +11.1% weight, +8.3% est. 1RM, +14.9% volume');
});

test('squat: Nov 12 vs Nov 7 shows the small volume dip honestly', () => {
  const c = compareSessions(W, 'squat', 'lb');
  // 135*(1+8/30)=171 -> 170; 130*(1+8/30)=164.7 -> 165; volume 3105 vs 3120
  assert.equal(c.current.e1rm, 170);
  assert.equal(c.previous.e1rm, 165);
  assert.deepEqual(c.change, { topWeightPct: 3.8, e1rmPct: 3, volumePct: -0.5 });
});

test('only one session: no previous, honest text; never logged: null', () => {
  const c = compareSessions([W[0]], 'curl', 'lb');
  assert.equal(c.previous, null);
  assert.equal(c.change, null);
  assert.match(c.text, /first session/i);
  assert.equal(compareSessions(W, 'nonexistent', 'lb'), null);
});

test('kg display converts loads (25 lb = 11.3 kg)', () => {
  assert.equal(compareSessions(W, 'curl', 'kg').current.topWeight, 11.3);
});

test('month to month: Nov 2026 (6 sessions) vs Oct 2026 (8 sessions)', () => {
  const m = comparePeriods(W, { period: 'month', now: NOW, unit: 'lb' });
  assert.equal(m.current.label, 'Nov 2026');
  assert.equal(m.previous.label, 'Oct 2026');
  assert.equal(m.current.sessions, 6);
  assert.equal(m.previous.sessions, 8);
  // Nov: 4395+5730+4332.5+5730+4830+5740; Oct: 3960+4940+3960+5310+3915+5310+4395+5340
  assert.equal(m.current.volume, 30757.5);
  assert.equal(m.previous.volume, 37130);
  assert.equal(m.change.volumePct, -17.2);
  assert.equal(m.change.sessionsPct, -25);
  const bench = m.exercises.find((e) => e.exercise === 'bench');
  // 115x8 -> 145.7 -> 145; 105x8 -> 133 -> 132.5; +9.4%
  assert.equal(bench.current.bestE1rm, 145);
  assert.equal(bench.previous.bestE1rm, 132.5);
  assert.equal(bench.change.e1rmPct, 9.4);
  const pull = m.exercises.find((e) => e.exercise === 'pull_up');
  assert.equal(pull.current.bestE1rm, null); // bodyweight sets (0 lb) have no e1RM
  assert.equal(pull.current.sessions, 3);
});

test('year to year: no 2025 data is reported, not invented', () => {
  const y = comparePeriods(W, { period: 'year', now: NOW, unit: 'lb' });
  assert.equal(y.current.label, '2026');
  assert.equal(y.current.sessions, 14);
  assert.equal(y.current.volume, 67887.5);
  assert.equal(y.previous, null);
  assert.equal(y.change, null);
  assert.equal(y.text, 'No data for 2025 to compare against.');
});
