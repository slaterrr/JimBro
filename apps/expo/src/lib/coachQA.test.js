// Workout-context questions answered from records; missing data is admitted, never invented.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answerContext } from './coachQA.js';

const plan = { goal: 'general', days: [
  { day: 1, items: [{ exercise: 'squat', sets: 3, reps_low: 6, reps_high: 10, rest_min: 2 }, { exercise: 'bench', sets: 3, reps_low: 6, reps_high: 10, rest_min: 2 }] },
  { day: 2, items: [{ exercise: 'deadlift', sets: 3, reps_low: 5, reps_high: 5, rest_min: 3 }] },
] };
const rep = (i, lift) => ({ index: i, concentric_ms: lift, peak_pause_ms: 100, eccentric_ms: 1000, rom_deg: 100 });
const day = (d) => `2026-11-${String(d).padStart(2, '0')}T18:00:00Z`;

describe('what am I training today?', () => {
  it('names the next plan day and its exercises', () => {
    const a = answerContext('What am I training today?', { plan, history: [{ name: 'Plan day 1', startedAt: day(10), sets: [] }] });
    assert.match(a, /deadlift/i);
    assert.match(a, /3 sets/);
  });
  it('no plan: says so and offers options', () => {
    assert.match(answerContext("what's my workout today", { plan: null, history: [] }), /no plan|don't have a plan/i);
  });
});

describe('how many sets are left?', () => {
  it('counts planned minus done in the active workout', () => {
    const active = { planned: { items: [{ exercise: 'squat', sets: 3 }, { exercise: 'bench', sets: 3 }] }, sets: [{ exercise: 'squat' }, { exercise: 'squat' }] };
    const a = answerContext('How many sets do I have left?', { active, history: [] });
    assert.match(a, /4 sets left/);
    assert.match(a, /1 squat/i);
  });
  it('no planned workout running: says so', () => {
    assert.match(answerContext('how many sets left', { active: null, history: [] }), /no planned workout|not running/i);
  });
});

describe('why did my reps slow down?', () => {
  it('explains from the measured set, without calling it failure', () => {
    const slow = [800, 850, 900, 1000, 1150, 1300].map((l, i) => rep(i + 1, l));
    const active = { sets: [{ exercise: 'curl', reps: 6, weight: 30, unit: 'lb', reps_detail: slow }] };
    const a = answerContext('Why did my repetitions slow down?', { active, history: [] });
    assert.match(a, /curl/i);
    assert.match(a, /\d\.\d s/);
    assert.doesNotMatch(a, /fail/i);
  });
  it('no rep timing: says the camera did not time that set', () => {
    const active = { sets: [{ exercise: 'bench', reps: 5, weight: 135, unit: 'lb', reps_detail: [] }] };
    assert.match(answerContext('why did my reps slow down', { active, history: [] }), /didn't time|no rep timing|camera/i);
  });
});

describe('what should I do instead of X?', () => {
  it('uses the equipment the user listed', () => {
    const a = answerContext('What should I do instead of lat pulldowns?', { profile: { equipment: ['pullup_bar', 'dumbbells'] }, history: [] });
    assert.match(a, /chin-up|pull-up/i);
    assert.match(a, /start lighter|carry over|reps you could/i);
  });
  it('without known equipment: asks, and shows options with what they need', () => {
    const a = answerContext('alternative to bench press?', { history: [] });
    assert.match(a, /what equipment/i);
  });
});

describe('how has my X progressed?', () => {
  it('compares first and latest sessions with estimated 1RM', () => {
    const history = [
      { startedAt: day(1), sets: [{ exercise: 'deadlift', weight: 225, reps: 5, unit: 'lb' }] },
      { startedAt: day(8), sets: [{ exercise: 'deadlift', weight: 245, reps: 5, unit: 'lb' }] },
      { startedAt: day(15), sets: [{ exercise: 'deadlift', weight: 255, reps: 5, unit: 'lb' }] },
    ];
    const a = answerContext('How has my deadlift progressed?', { history });
    assert.match(a, /3 sessions/);
    assert.match(a, /225/);
    assert.match(a, /255/);
    assert.match(a, /estimate/i);
  });
  it('one session or none: not enough to call it progress', () => {
    assert.match(answerContext('how is my squat progressing', { history: [] }), /no squat|haven't logged/i);
  });
});

describe('make it shorter / how long to rest', () => {
  it('shorter: concrete offer that needs a yes', () => {
    const active = { planned: { items: [{ exercise: 'squat', sets: 4 }, { exercise: 'bench', sets: 4 }] }, sets: [{ exercise: 'squat' }] };
    const a = answerContext('Can you make today\'s workout shorter?', { active, history: [] });
    assert.match(a, /\d+ sets/);
    assert.match(a, /minutes/i);
  });
  it('rest: from the last set, with the reason', () => {
    const active = { sets: [{ exercise: 'squat', reps: 5, weight: 225, unit: 'lb', rpe: 9 }] };
    const a = answerContext('How long should I rest?', { active, history: [], settings: { fitnessGoal: 'strength' } });
    assert.match(a, /\d:\d\d/);
  });
});

describe('not a context question', () => {
  it('returns null so the AI can answer', () => {
    assert.equal(answerContext('tell me a joke', { history: [] }), null);
    assert.equal(answerContext('log 3x10 curls at 25', { history: [] }), null);
  });
});

describe('what did I train last time?', () => {
  const s = (exercise, weight, reps) => ({ exercise, weight, reps, unit: 'lb' });
  const history = [
    { id: 'w1', name: 'Legs', startedAt: '2026-11-08T12:00:00Z', sets: [s('squat', 185, 5)] },
    { id: 'w2', name: 'Push', startedAt: '2026-11-12T12:00:00Z', sets: [s('bench', 135, 8), s('bench', 135, 8), s('shoulder_press', 65, 10)] },
  ];
  for (const q of ['what did I train last time?', 'what was my last workout', 'what did I do last session?']) {
    it(`"${q}" names the newest workout, its exercises and set counts`, () => {
      const a = answerContext(q, { history });
      assert.match(a, /Push/);
      assert.match(a, /bench press 2 sets/i);
      assert.doesNotMatch(a, /squat/i);
    });
  }
  it('no history: says so', () => {
    assert.match(answerContext('what did I train last time?', { history: [] }), /no workouts/i);
  });
});
