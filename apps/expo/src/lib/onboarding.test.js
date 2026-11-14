import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SAFETY_TEXT } from './coach.js';
import { isOnboarded, ONBOARDING_QUESTIONS, onboardingResult } from './onboarding.js';
import { validatePlan } from './plans.js';

test('three questions: experience, goal, pain', () => {
  assert.deepEqual(ONBOARDING_QUESTIONS.map((q) => q.id), ['experience', 'goal', 'pain']);
  assert.deepEqual(ONBOARDING_QUESTIONS[0].options.map(([id]) => id), ['new', 'returning', 'experienced']);
  assert.deepEqual(ONBOARDING_QUESTIONS[1].options.map(([id]) => id), ['habit', 'stronger', 'muscle', 'health']);
  assert.deepEqual(ONBOARDING_QUESTIONS[2].options.map(([id]) => id), ['no', 'yes']);
});

for (const experience of ['new', 'returning']) {
  test(`${experience}: zen persona, conservative plan, consistency goal`, () => {
    const r = onboardingResult({ experience, goal: 'muscle', pain: 'no' });
    assert.equal(r.persona, 'zen');
    assert.equal(r.safety, null);
    assert.equal(r.plan.days.length, 2);
    for (const d of r.plan.days) {
      assert.ok(d.estimated_minutes <= 30);
      for (const i of d.items) { assert.equal(i.sets, 2); assert.ok(i.reps_high <= 12); }
    }
    assert.deepEqual(validatePlan(r.plan, r.plan.request), []);
    assert.deepEqual(r.goal, { type: 'consistency', perWeek: 2, weeks: 4 });
  });
}

test('experienced: persona untouched, regular plan from the goal', () => {
  const r = onboardingResult({ experience: 'experienced', goal: 'stronger', pain: 'no' });
  assert.equal(r.persona, null);
  assert.equal(r.plan.goal, 'strength');
  assert.equal(r.plan.days.length, 3);
  assert.deepEqual(r.goal, { type: 'consistency', perWeek: 3, weeks: 4 });
});

test('pain: safety message, see a professional, never a plan', () => {
  for (const experience of ['new', 'returning', 'experienced']) {
    const r = onboardingResult({ experience, goal: 'stronger', pain: 'yes' });
    assert.equal(r.plan, null);
    assert.equal(r.goal, null);
    assert.equal(r.safety, SAFETY_TEXT);
    assert.match(r.message, /doctor|physical therapist/i);
  }
});

test('skipped or partial answers never build a plan or change the persona', () => {
  const r = onboardingResult({});
  assert.equal(r.plan, null);
  assert.equal(r.persona, null);
  assert.equal(r.goal, null);
});

test('migration: old saves with history count as onboarded', () => {
  assert.equal(isOnboarded(undefined, []), false);
  assert.equal(isOnboarded({}, [{ id: 'w' }]), true);
  assert.equal(isOnboarded({ onboarded: true }, []), true);
  assert.equal(isOnboarded({ onboarded: false }, undefined), false);
});
