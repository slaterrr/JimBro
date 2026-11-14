// Home "Start a Workout": pick the saved plan's next day, else a quick workout.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HOME_OPTIONS, HOME_SUBTITLE, nextWorkout } from './homeActions.js';

const plan = { days: [{ day: 1, items: ['a'] }, { day: 2, items: ['b'] }, { day: 3, items: ['c'] }] };
const done = (name) => ({ id: name, name, startedAt: '2026-11-10T10:00:00Z', sets: [] });

describe('home options', () => {
  it('has the subtitle and three options from the team doc', () => {
    assert.equal(HOME_SUBTITLE, 'Your AI gym bro. Tell me what you want to work on today.');
    assert.deepEqual(HOME_OPTIONS.map((o) => o.label.replace('\n', ' ')), ['Start a Workout', 'Create a New Plan', 'Review My Progress']);
    assert.deepEqual(HOME_OPTIONS.map((o) => o.id), ['start', 'plan', 'progress']);
  });
});

describe('nextWorkout', () => {
  it('starts a quick workout without a plan', () => {
    assert.deepEqual(nextWorkout(null, []), { name: 'Quick workout', planned: null });
    assert.deepEqual(nextWorkout({ days: [] }, []), { name: 'Quick workout', planned: null });
  });
  it('starts plan day 1 when no plan day was done yet', () => {
    assert.deepEqual(nextWorkout(plan, [done('Quick log')]), { name: 'Plan day 1', planned: plan.days[0] });
  });
  it('continues after the most recent plan day and wraps around', () => {
    assert.equal(nextWorkout(plan, [done('Plan day 1')]).name, 'Plan day 2');
    assert.equal(nextWorkout(plan, [done('Plan day 1'), done('Plan day 2'), done('Squats')]).name, 'Plan day 3');
    assert.equal(nextWorkout(plan, [done('Plan day 2'), done('Plan day 3')]).name, 'Plan day 1');
  });
});
