// Lifter tools: estimated 1RM, plate math, restoring an export, repeating a workout.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { estimate1RM, parseImport, plateBreakdown, repeatPlan } from './tools.js';

describe('estimate1RM (Epley)', () => {
  it('estimates from sets of 1-10 reps and rounds to the loading step', () => {
    assert.equal(estimate1RM({ weight: 100, reps: 1, unit: 'kg' }), 100);
    assert.equal(estimate1RM({ weight: 100, reps: 5, unit: 'kg' }), 116.5); // 116.67 -> 0.5 kg steps
    assert.equal(estimate1RM({ weight: 225, reps: 3, unit: 'lb' }), 247.5); // 247.5 -> 2.5 lb steps
  });
  it('refuses unreliable inputs', () => {
    assert.equal(estimate1RM({ weight: 100, reps: 12, unit: 'kg' }), null);
    assert.equal(estimate1RM({ weight: 0, reps: 5, unit: 'kg' }), null);
    assert.equal(estimate1RM({ weight: 50, reps: 0, unit: 'kg' }), null);
  });
});

describe('plateBreakdown', () => {
  it('splits the load per side with standard plates', () => {
    assert.deepEqual(plateBreakdown(225, 'lb'), { bar: 45, perSide: [45, 45], remainder: 0 });
    assert.deepEqual(plateBreakdown(135, 'lb'), { bar: 45, perSide: [45], remainder: 0 });
    assert.deepEqual(plateBreakdown(100, 'kg'), { bar: 20, perSide: [25, 15], remainder: 0 });
    assert.deepEqual(plateBreakdown(62.5, 'kg'), { bar: 20, perSide: [20, 1.25], remainder: 0 });
  });
  it('reports what cannot be loaded', () => {
    assert.deepEqual(plateBreakdown(46, 'lb'), { bar: 45, perSide: [], remainder: 1 });
    assert.equal(plateBreakdown(30, 'lb'), null); // lighter than the bar
    assert.deepEqual(plateBreakdown(45, 'lb'), { bar: 45, perSide: [], remainder: 0 });
  });
});

describe('parseImport', () => {
  const good = {
    format: 'jimbro-phone-export-v1',
    history: [{ id: 'w1', name: 'A', startedAt: '2026-11-01T10:00:00.000Z', sets: [{ id: 's1', exercise: 'curl', weight: 10, unit: 'kg', reps: 8, rpe: null }] }],
    plan: null,
    settings: { tone: 'hard' },
  };
  it('accepts a JimBro export', () => {
    const r = parseImport(JSON.stringify(good));
    assert.equal(r.history.length, 1);
    assert.equal(r.settings.tone, 'hard');
  });
  it('rejects anything else with a reason', () => {
    assert.throws(() => parseImport('not json'), /not a JimBro export/);
    assert.throws(() => parseImport(JSON.stringify({ format: 'other' })), /not a JimBro export/);
    const badSet = structuredClone(good);
    badSet.history[0].sets[0].unit = 'stone';
    assert.throws(() => parseImport(JSON.stringify(badSet)), /workout 1/);
    const badEx = structuredClone(good);
    badEx.history[0].sets[0].exercise = 'zumba';
    assert.throws(() => parseImport(JSON.stringify(badEx)), /workout 1/);
  });
  it('merges by workout id without duplicates', async () => {
    const { mergeHistory } = await import('./tools.js');
    const merged = mergeHistory(good.history, [...good.history, { ...good.history[0], id: 'w2', startedAt: '2026-10-01T10:00:00.000Z' }]);
    assert.deepEqual(merged.map((w) => w.id), ['w2', 'w1']); // chronological
  });
});

describe('repeatPlan', () => {
  it('turns a past workout into a checklist of its exercises', () => {
    const w = { name: 'Push', sets: [
      { exercise: 'bench', reps: 8 }, { exercise: 'bench', reps: 6 }, { exercise: 'shoulder_press', reps: 10 }, { exercise: 'bench', reps: 7 },
    ] };
    assert.deepEqual(repeatPlan(w), {
      day: null,
      items: [
        { exercise: 'bench', sets: 3, reps_low: 6, reps_high: 8 },
        { exercise: 'shoulder_press', sets: 1, reps_low: 10, reps_high: 10 },
      ],
    });
  });
});
