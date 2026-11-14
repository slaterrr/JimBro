// Logic behind the redesigned screens: muscle recency map, progression stats, live cues.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { liveCue } from './cues.js';
import { MUSCLE_GROUPS, muscleDetail, muscleStatus } from './muscles.js';
import { overview, toUnit, weeklyStrength, weeklyVolume } from './stats.js';

const NOW = new Date('2026-11-14T12:00:00Z'); // a Saturday
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const w = (n, sets) => ({ id: `w${n}-${sets.length}`, name: 'W', startedAt: daysAgo(n), sets });
const set = (exercise, weight, reps, unit = 'lb', pr = false) => ({ id: `${exercise}${weight}${reps}`, exercise, weight, reps, unit, rpe: null, pr });

describe('muscles', () => {
  it('covers the body map groups', () => {
    assert.deepEqual(MUSCLE_GROUPS.map((g) => g.id).sort(), [
      'abs', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings',
      'lats', 'lower_back', 'quads', 'shoulders', 'traps', 'triceps',
    ]);
  });
  it('classifies trained (<=3d), recent (4-7d) and rest (>=8d or never)', () => {
    const status = muscleStatus([w(2, [set('bench', 135, 8)]), w(5, [set('squat', 185, 5)]), w(20, [set('pull_up', 0, 8)])], NOW);
    assert.equal(status.chest, 'trained');
    assert.equal(status.triceps, 'trained');
    assert.equal(status.quads, 'recent');
    assert.equal(status.glutes, 'recent');
    assert.equal(status.lats, 'rest');
    assert.equal(status.calves, 'rest');
  });
  it('uses the most recent session and exact day boundaries', () => {
    const s = muscleStatus([w(10, [set('curl', 30, 10)]), w(3, [set('curl', 30, 10)])], NOW);
    assert.equal(s.biceps, 'trained');
    assert.equal(muscleStatus([w(4, [set('curl', 30, 10)])], NOW).biceps, 'recent');
    assert.equal(muscleStatus([w(7, [set('curl', 30, 10)])], NOW).biceps, 'recent');
    assert.equal(muscleStatus([w(8, [set('curl', 30, 10)])], NOW).biceps, 'rest');
  });
  it('describes a muscle group for the detail sheet', () => {
    const d = muscleDetail([w(2, [set('bench', 135, 8), set('bench', 135, 8)]), w(9, [set('bench', 135, 8)])], 'chest', NOW);
    assert.equal(d.days, 2);
    assert.equal(d.setsThisWeek, 2);
    assert.deepEqual(d.exercises, ['bench']);
    assert.equal(muscleDetail([], 'chest', NOW).days, null);
  });
});

describe('stats', () => {
  it('converts units', () => {
    assert.equal(toUnit(100, 'kg', 'lb'), 220.5);
    assert.equal(toUnit(225, 'lb', 'lb'), 225);
    assert.equal(toUnit(220.5, 'lb', 'kg'), 100);
  });
  it('totals the best estimated 1RM per lift per week, carrying lifts forward', () => {
    const hist = [
      w(26, [set('bench', 200, 5), set('squat', 250, 5)]),
      w(19, [set('bench', 205, 5)]),
      w(12, [set('squat', 260, 5)]),
      w(5, [set('bench', 215, 5), set('squat', 270, 5)]),
    ];
    const weeks = weeklyStrength(hist, 'lb', NOW, 4);
    assert.deepEqual(weeks.map((x) => x.label), ['W1', 'W2', 'W3', 'W4']);
    // bench e1RM: 200x5 -> 233.5 ... totals rise as lifts improve
    assert.ok(weeks.every((x, i) => i === 0 || x.total >= weeks[i - 1].total));
    assert.ok(weeks[0].total > 0);
  });
  it('builds the overview tiles from real history', () => {
    const hist = [
      w(26, [set('bench', 200, 5)]),
      w(19, [set('bench', 205, 5)]),
      w(12, [set('bench', 210, 5, 'lb', true)]),
      w(9, [set('bench', 220, 5, 'lb', true)]),
      w(1, [set('bench', 225, 5, 'lb', true)]),
    ];
    const o = overview(hist, 'lb', NOW);
    assert.equal(o.topLift.exercise, 'bench');
    assert.equal(o.topLift.e1rm, 262.5); // 225 x 5 -> 262.5
    assert.ok(o.topLift.delta > 0);
    assert.ok(o.strengthChangePct > 0);
    assert.deepEqual(o.consistency, { weeks: 4, of: 4, pct: 100 });
    // Records come from history, not a stored flag: 205, 210, 220 and 225 each beat
    // the previous heaviest (the first 200 is a baseline), and 225 is this week.
    assert.deepEqual(o.prs, { count: 4, newThisWeek: 1 });
  });
  it('is empty-safe', () => {
    const o = overview([], 'lb', NOW);
    assert.equal(o.topLift, null);
    assert.equal(o.strengthChangePct, null);
    assert.deepEqual(o.consistency, { weeks: 0, of: 4, pct: 0 });
    assert.equal(weeklyStrength([], 'lb', NOW).every((x) => x.total === 0), true);
  });
  it('sums weekly volume in one unit', () => {
    const v = weeklyVolume([w(2, [set('bench', 100, 10), set('curl', 10, 10, 'kg')])], 'lb', NOW, 4);
    assert.equal(v[3].volume, 1000 + 220.5);
  });
});

describe('liveCue', () => {
  const rep = (c, e) => ({ concentric_ms: c, peak_pause_ms: 100, eccentric_ms: e });
  it('asks the lifter to get in frame when tracking is lost or weak', () => {
    assert.match(liveCue({ movement: 'curl', count: 0, target: 12, lastRep: null, tracking: 'lost' }), /can't see you/i);
    assert.match(liveCue({ movement: 'curl', count: 0, target: 12, lastRep: null, tracking: 'low' }), /side-on|light/i);
  });
  it('coaches pace and counts down to the target with a form tip', () => {
    assert.equal(
      liveCue({ movement: 'curl', count: 8, target: 12, lastRep: rep(900, 1500), tracking: 'ok' }),
      'Good pace — 4 more reps. Keep your elbows pinned to your sides.',
    );
    assert.match(liveCue({ movement: 'squat', count: 3, target: 10, lastRep: rep(300, 1500), tracking: 'ok' }), /control/i);
    assert.match(liveCue({ movement: 'shoulder_press', count: 3, target: 10, lastRep: rep(900, 400), tracking: 'ok' }), /lower slower/i);
    assert.match(liveCue({ movement: 'curl', count: 12, target: 12, lastRep: rep(900, 1500), tracking: 'ok' }), /that's the set/i);
    assert.match(liveCue({ movement: 'squat', count: 0, target: 10, lastRep: null, tracking: 'ok' }), /hips back/i);
  });
});
