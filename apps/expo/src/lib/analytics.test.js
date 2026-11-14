// Progress analytics: derived from history, never stored.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calendar,
  compareLatest,
  convert,
  currentRecords,
  durationMin,
  filterWorkouts,
  frequency,
  liftKey,
  liftSessions,
  lifts,
  periodVolume,
  recordHistory,
  recordSetIds,
  restBefore,
  volumeByLift,
  volumeByMuscle,
} from './analytics.js';

let n = 0;
const set = (exercise, weight, reps, extra = {}) => ({ id: `s${++n}`, exercise, weight, reps, unit: 'kg', ...extra });
const workout = (date, sets, extra = {}) => ({ id: `w-${date}-${++n}`, name: 'Session', startedAt: `${date}T10:00:00Z`, sets, ...extra });
const BENCH = liftKey({ exercise: 'bench' });

describe('lifts and units', () => {
  it('treats exercise + variation + equipment as the lift, and never mixes them', () => {
    const h = [workout('2026-11-02', [set('bench', 100, 5), set('bench', 80, 5, { variation: 'Paused' }), set('bench', 40, 8, { equipment: 'dumbbell' })])];
    assert.equal(lifts(h).length, 3);
    assert.equal(liftSessions(h, BENCH, 'kg')[0].topWeight, 100);
    assert.equal(liftSessions(h, 'bench|paused|', 'kg')[0].topWeight, 80);
    assert.ok(lifts(h).some((l) => l.label.includes('dumbbell')));
  });

  it('converts kg and lb exactly, so the same load in either unit compares equal', () => {
    assert.ok(Math.abs(convert(100, 'kg', 'lb') - 220.462) < 0.001);
    assert.equal(convert(convert(225, 'lb', 'kg'), 'kg', 'lb').toFixed(6), '225.000000');
    const h = [workout('2026-11-02', [set('squat', 100, 5)]), workout('2026-11-09', [set('squat', 220.462262, 5, { unit: 'lb' })])];
    // 220.46 lb == 100 kg: not a new heaviest record.
    assert.equal(recordHistory(h, 'kg').filter((e) => e.type === 'heaviest').length, 1);
  });
});

describe('sessions and comparisons', () => {
  const h = [
    workout('2026-11-02', [set('bench', 80, 8), set('bench', 85, 6), set('bench', 85, 5, { completed: false })], { planned: { items: [{ exercise: 'bench', sets: 4, reps_low: 6, reps_high: 8 }] } }),
    workout('2026-11-09', [set('bench', 90, 5), set('bench', 90, 5)]),
  ];

  it('computes top weight, volume, average weight per rep, e1RM and completion', () => {
    const [a, b] = liftSessions(h, BENCH, 'kg');
    assert.equal(a.topWeight, 85);
    assert.equal(a.volume, 80 * 8 + 85 * 6); // the incomplete set doesn't count
    assert.equal(a.avgWeightPerRep, Math.round(((80 * 8 + 85 * 6) / 14) * 10) / 10);
    assert.equal(a.completedSets, 2);
    assert.equal(a.sets, 3);
    assert.equal(a.plannedSets, 4);
    assert.equal(b.bestE1RM, 105); // 90 × (1 + 5/30) = 105 (Epley)
  });

  it('compares the latest session with the previous one', () => {
    const c = compareLatest(h, BENCH, 'kg');
    assert.equal(c.change.topWeight, 5);
    assert.equal(c.change.reps, 10 - 14);
    assert.equal(compareLatest([h[0]], BENCH, 'kg'), null);
  });

  it('handles bodyweight sets with reps, not load', () => {
    const s = liftSessions([workout('2026-11-02', [set('pull_up', 0, 8), set('pull_up', 0, 6)])], 'pull_up||', 'kg')[0];
    assert.equal(s.bodyweight, true);
    assert.equal(s.reps, 14);
    assert.equal(s.volume, null);
    assert.equal(s.bestE1RM, null);
  });

  it('labels e1RM only for sets of 10 reps or fewer', () => {
    const s = liftSessions([workout('2026-11-02', [set('curl', 15, 12)])], 'curl||', 'kg')[0];
    assert.equal(s.bestE1RM, null);
  });
});

describe('volume and consistency', () => {
  const h = [
    workout('2026-10-27', [set('squat', 100, 5)]), // Monday, week of 10-27
    workout('2026-11-01', [set('squat', 100, 5)]), // Sunday, same ISO week
    workout('2026-11-02', [set('curl', 10, 10), set('pull_up', 0, 10)]), // next Monday
  ];

  it('buckets weekly volume on ISO weeks and monthly volume on calendar months', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    const weeks = periodVolume(h, 'kg', 'week', Date.parse('2026-10-27T00:00:00Z'), now);
    assert.deepEqual(weeks.map((w) => w.volume), [1000, 100]);
    const months = periodVolume(h, 'kg', 'month', Date.parse('2026-10-01T00:00:00Z'), now);
    assert.deepEqual(months.map((m) => [m.label, m.volume]), [['2026-10', 500], ['2026-11', 600]]);
  });

  it('allocates muscle load 100% primary / 50% secondary', () => {
    const m = Object.fromEntries(volumeByMuscle(h, 'kg').map((x) => [x.muscle, x]));
    assert.equal(m.quads.volume, 1000);
    assert.equal(m.hamstrings.volume, 500);
    assert.equal(m.biceps.sets, 1 + 0.5); // curl primary + pull-up secondary
    assert.equal(m.lats.volume, 0); // bodyweight: sets, not load
    assert.equal(m.lats.sets, 1);
  });

  it('ranks volume by lift and counts frequency, calendar days and duration', () => {
    assert.equal(volumeByLift(h, 'kg')[0].key, 'squat||');
    const f = frequency(h, Date.parse('2026-10-27T00:00:00Z'), Date.parse('2026-11-05T00:00:00Z'));
    assert.deepEqual(f.weeks.map((w) => w.workouts), [2, 1]);
    assert.equal(f.perWeek, 1.5);
    assert.deepEqual(calendar(h, '2026-11'), { '2026-11-01': 1, '2026-11-02': 1 });
    assert.equal(durationMin({ startedAt: '2026-11-02T10:00:00Z', finishedAt: '2026-11-02T10:47:30Z' }), 48);
    assert.equal(durationMin({ startedAt: '2026-11-02T10:00:00Z' }), null);
  });

  it('filters by exercise, date range and program', () => {
    const p = [...h, workout('2026-11-03', [set('bench', 60, 5)], { program: 'Get Stronger' })];
    assert.equal(filterWorkouts(p, { exercise: 'squat' }).length, 2);
    assert.equal(filterWorkouts(p, { from: '2026-11-02', to: '2026-11-04' }).length, 2);
    assert.equal(filterWorkouts(p, { program: 'Get Stronger' }).length, 1);
  });

  it('measures rest from log times, ignoring gaps over 10 minutes', () => {
    const w = { sets: [
      { id: 'a', loggedAt: '2026-11-02T10:00:00Z' },
      { id: 'b', loggedAt: '2026-11-02T10:01:30Z' },
      { id: 'c', loggedAt: '2026-11-02T10:20:00Z' },
    ] };
    assert.deepEqual(restBefore(w), { b: 90, c: null });
  });
});

describe('personal records', () => {
  const base = () => [
    workout('2026-11-02', [set('bench', 100, 5, { id: 'b1' }), set('bench', 100, 5, { id: 'b2' })]),
    workout('2026-11-09', [set('bench', 100, 7, { id: 'b3' }), set('bench', 105, 3, { id: 'b4' })]),
  ];

  it('records only strict improvements, labels measured vs estimated', () => {
    const ev = recordHistory(base(), 'kg');
    const heaviest = ev.filter((e) => e.type === 'heaviest');
    assert.deepEqual(heaviest.map((e) => e.weight), [100, 105]); // the repeated 100×5 isn't a second record
    const reps = ev.filter((e) => e.type === 'reps_at_weight');
    assert.deepEqual(reps.map((e) => [e.weight, e.reps]), [[100, 7]]); // first time at a weight is not a "reps" record
    assert.ok(ev.filter((e) => e.type === 'e1rm').every((e) => e.source === 'estimated'));
    assert.ok(ev.filter((e) => e.type !== 'e1rm').every((e) => e.source === 'measured'));
    assert.deepEqual(ev.filter((e) => e.type === 'session_volume').map((e) => e.value), [1000, 1015]);
  });

  it('recalculates after a set is edited or deleted (nothing stale)', () => {
    const h = base();
    assert.ok(recordSetIds(h).has('b4'));
    // Delete the 105 set: 100 is the heaviest again.
    h[1].sets = h[1].sets.filter((s) => s.id !== 'b4');
    const cur = currentRecords(h, 'kg')[0];
    assert.equal(cur.heaviest.weight, 100);
    assert.ok(!recordSetIds(h).has('b4'));
    // Edit the first set down: the record now belongs to b2.
    h[0].sets[0] = { ...h[0].sets[0], weight: 90 };
    assert.equal(currentRecords(h, 'kg')[0].heaviest.setId, 'b2');
  });

  it('ignores incomplete and bodyweight sets for load records, and handles no data', () => {
    const h = [workout('2026-11-02', [set('bench', 120, 1, { completed: false }), set('pull_up', 0, 12)])];
    assert.deepEqual(recordHistory(h, 'kg'), []);
    assert.deepEqual(currentRecords([], 'kg'), []);
  });
});

describe('stored data', () => {
  it('migrates old data without losing anything and keeps old exports importable', async () => {
    const { migrateData } = await import('./migrate.js');
    const old = { settings: { unit: 'kg' }, history: [{ id: 'w', name: 'Old', startedAt: '2025-01-01T10:00:00Z', sets: [{ id: 's', exercise: 'bench', weight: 60, reps: 5, unit: 'kg', pr: true }] }] };
    const m = migrateData(old, { settings: {}, active: null, history: [], plan: null }, { unit: 'lb', tone: 'friendly' });
    assert.equal(m.version, 3);
    assert.equal(m.settings.unit, 'kg');
    assert.equal(m.settings.tone, 'friendly');
    assert.equal(m.history[0].sets[0].completed, true);
    assert.equal(m.history[0].sets[0].weight, 60);
    assert.equal(m.active, null);
  });

  it("doesn't count a lift's first set as a record", () => {
    const h = [workout('2026-11-02', [set('deadlift', 140, 5, { id: 'd1' })])];
    assert.equal(recordSetIds(h).size, 0);
    assert.ok(recordHistory(h, 'kg').every((e) => e.first));
  });
});
