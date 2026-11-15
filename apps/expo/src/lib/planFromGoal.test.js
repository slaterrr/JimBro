import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXERCISE_MUSCLES } from './muscles.js';
import { planFromGoal, planProposal, validateEmphasis } from './planFromGoal.js';

const history = [
  { id: 'w1', startedAt: '2026-11-01T12:00:00.000Z', sets: [{ exercise: 'shoulder_press', reps: 10, weight: 25, unit: 'lb' }, { exercise: 'bench', reps: 8, weight: 135, unit: 'lb' }] },
  { id: 'w2', startedAt: '2026-11-04T12:00:00.000Z', sets: [{ exercise: 'shoulder_press', reps: 10, weight: 30, unit: 'lb' }] },
];

describe('planFromGoal (offline, no photo)', () => {
  it('uses the rep scheme of the fitness goal', () => {
    const muscle = planFromGoal({ fitnessGoal: 'muscle' });
    const strength = planFromGoal({ fitnessGoal: 'strength' });
    assert.deepEqual([muscle.days[0].items[0].reps_low, muscle.days[0].items[0].reps_high], [8, 12]);
    assert.deepEqual([strength.days[0].items[0].reps_low, strength.days[0].items[0].reps_high], [3, 5]);
    assert.equal(planFromGoal({ fitnessGoal: 'nonsense' }).goal, 'general');
    assert.equal(planFromGoal({}).goal, 'general');
  });
  it('puts exercises for the focus muscles on every day with an extra set', () => {
    const p = planFromGoal({ fitnessGoal: 'muscle', focusMuscles: ['biceps'], daysPerWeek: 3 });
    assert.equal(p.days.length, 3);
    for (const d of p.days) {
      const top = d.items[0];
      assert.ok(EXERCISE_MUSCLES[top.exercise].includes('biceps'), `day ${d.day} starts with a biceps lift`);
      assert.equal(top.sets, 5);
      assert.ok(d.items.length >= 3 && d.items.length <= 4);
    }
    assert.deepEqual(p.focus, ['biceps']);
    assert.equal(p.source, 'rules');
  });
  it('keeps the week balanced: legs, push and pull all appear', () => {
    const p = planFromGoal({ fitnessGoal: 'general', focusMuscles: ['biceps'] });
    const all = new Set(p.days.flatMap((d) => d.items.map((i) => i.exercise)));
    assert.ok(['squat', 'deadlift', 'lunge'].some((e) => all.has(e)));
    assert.ok(['bench', 'shoulder_press'].some((e) => all.has(e)));
    assert.ok(['pull_up', 'shoulder_press'].some((e) => all.has(e)));
  });
  it('starts loads from the most recent imported/logged set', () => {
    const p = planFromGoal({ fitnessGoal: 'muscle', focusMuscles: ['shoulders'], history });
    const curl = p.days.flatMap((d) => d.items).find((i) => i.exercise === 'shoulder_press');
    assert.deepEqual(curl.start, { weight: 30, unit: 'lb' });
    assert.match(p.notes.join(' '), /history/);
  });
  it('ignores unknown muscles and dedupes', () => {
    assert.deepEqual(planFromGoal({ focusMuscles: ['biceps', 'biceps', 'wings'] }).focus, ['biceps']);
  });
  it('photo emphasis comes first and marks the source', () => {
    const p = planFromGoal({ fitnessGoal: 'muscle', focusMuscles: ['quads'], emphasis: [{ muscle: 'shoulders', reason: 'Rounded delts are visible.' }] });
    assert.deepEqual(p.focus, ['shoulders', 'quads']);
    assert.equal(p.source, 'photo');
    assert.ok(EXERCISE_MUSCLES[p.days[0].items[0].exercise].includes('shoulders'));
  });
});

describe('validateEmphasis', () => {
  it('keeps known muscles with short neutral reasons', () => {
    assert.deepEqual(validateEmphasis([{ muscle: 'lats', reason: 'Wide upper back in the reference.' }, { muscle: 'lats', reason: 'dup' }, { muscle: 'wings', reason: 'x' }]), [{ muscle: 'lats', reason: 'Wide upper back in the reference.' }]);
  });
  it('drops reasons that judge weight, fat, attractiveness or health', () => {
    for (const reason of ['You look overweight', 'Lower your body fat first', 'More attractive arms', 'Unhealthy posture', 'Too skinny', 'BMI looks high']) {
      assert.deepEqual(validateEmphasis([{ muscle: 'chest', reason }]), [], reason);
    }
  });
  it('handles junk input', () => {
    assert.deepEqual(validateEmphasis(null), []);
    assert.deepEqual(validateEmphasis([{ muscle: 'chest', reason: 'x'.repeat(400) }]), []);
    assert.equal(validateEmphasis(Array(9).fill(0).map((_, i) => ({ muscle: ['chest', 'lats', 'quads', 'biceps', 'triceps', 'calves'][i % 6], reason: 'ok' }))).length, 4);
  });
});

describe('planProposal', () => {
  it('wraps a plan in a confirm-card intent', () => {
    const plan = planFromGoal({ fitnessGoal: 'muscle', focusMuscles: ['biceps', 'shoulders'] });
    const p = planProposal(plan);
    assert.equal(p.type, 'plan');
    assert.equal(p.plan, plan);
    assert.equal(p.summary, 'Save a 3-day muscle plan that prioritizes biceps and shoulders?');
  });
});
