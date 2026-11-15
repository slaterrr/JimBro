// What Jim says about performance: short during a set, a question after it, and chat answers
// built only from recorded data.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { afterSetLines, answerPerformance, liveSlowdownCue, recLine } from './perfCoach.js';

const rep = (i, lift) => ({ index: i, concentric_ms: lift, peak_pause_ms: 100, eccentric_ms: 1000, rom_deg: 100 });
const steady = (n) => Array.from({ length: n }, (_, i) => rep(i + 1, 900));
const slowing = (n) => Array.from({ length: n }, (_, i) => rep(i + 1, 800 + i * 120));

describe('during a set', () => {
  it('one short line, only after enough reps and a clear slowdown', () => {
    assert.equal(liveSlowdownCue('curl', steady(8)), null);
    assert.equal(liveSlowdownCue('curl', slowing(4)), null); // too early
    assert.equal(liveSlowdownCue('curl', slowing(8)), 'Your last three reps were noticeably slower.');
    assert.equal(liveSlowdownCue('curl', slowing(8), true), null); // already said this set
    assert.ok(liveSlowdownCue('curl', slowing(8)).split(' ').length <= 8);
  });
});

describe('after a set', () => {
  it('target met: asks how many more you had', () => {
    const l = afterSetLines({ completed: 8, target: 8, fatigue: { level: 'normal', signals: [] } });
    assert.match(l.say, /You completed all 8 reps/);
    assert.match(l.ask, /How many more/i);
  });

  it('target missed with a lower-weight suggestion: asks before changing', () => {
    const l = afterSetLines({ completed: 5, target: 8, fatigue: { level: 'increasing_difficulty', signals: [] }, rec: { action: 'decrease', weight: 125, unit: 'lb' } });
    assert.match(l.say, /5 of 8/);
    assert.match(l.ask, /reduce the weight/i);
  });

  it('mentions slowing only when the data showed it', () => {
    const slow = afterSetLines({ completed: 8, target: 8, fatigue: { level: 'possible_fatigue', signals: ['Your last reps were 35% slower than your first.'] } });
    assert.match(slow.say, /slower/);
    const ok = afterSetLines({ completed: 8, target: 8, fatigue: { level: 'normal', signals: [] } });
    assert.doesNotMatch(ok.say, /slower/);
  });
});

describe('recommendation lines', () => {
  it('each action has a short, optional line; none says nothing', () => {
    assert.match(recLine({ action: 'increase', weight: 140, unit: 'lb' }), /140 lb.*\?/);
    assert.match(recLine({ action: 'same', weight: 135, unit: 'lb' }, { history: true }), /recent workouts, keeping this weight may be appropriate/);
    assert.match(recLine({ action: 'decrease', weight: 125, unit: 'lb' }), /125 lb.*\?/);
    assert.match(recLine({ action: 'more_rest', extraRestS: 60 }), /extra minute/);
    assert.match(recLine({ action: 'fewer_reps', reps: 6 }), /6 reps/);
    assert.equal(recLine({ action: 'none' }), null);
  });
});

describe('chat answers about performance', () => {
  const last = { exercise: 'curl', weight: 30, unit: 'lb', reps: 8, target: 8, rpe: 8, reps_detail: slowing(8), rec: { action: 'same', weight: 30, reps: 8, accepted: false } };

  it('answers "how was my last set" from the recorded set', () => {
    const a = answerPerformance('how was my last set?', { history: [], active: { sets: [last] } });
    assert.match(a, /curl/i);
    assert.match(a, /slower/);
    assert.match(a, /30 lb/);
  });

  it('answers "should I go heavier" with the recommendation and its reason', () => {
    const a = answerPerformance('should I go heavier?', { history: [], active: { sets: [last] } });
    assert.match(a, /keep|same|30 lb/i);
  });

  it('answers how suggestions have worked, honestly when there is little data', () => {
    const a = answerPerformance('are your suggestions working?', { history: [], active: { sets: [last] } });
    assert.match(a, /too early/i);
  });

  it('no data: says so; unrelated messages: not handled here', () => {
    assert.match(answerPerformance('how was my last set', { history: [], active: null }), /don't have a set/i);
    assert.equal(answerPerformance('log 3x10 curls at 25', { history: [], active: null }), null);
    assert.equal(answerPerformance('hello', { history: [], active: null }), null);
  });
});

describe('coaching principles in practice', () => {
  it('after a set with fewer reps than last time, Jim asks about recovery', () => {
    const l = afterSetLines({ completed: 6, target: 8, fatigue: { level: 'increasing_difficulty', signals: ['2 fewer reps than last time at 135 lb.'] } });
    assert.match(l.ask, /sleep|stress/i);
  });

  it('an experienced user is asked for their own call first', () => {
    const sets = [{ exercise: 'bench', weight: 135, unit: 'lb', reps: 8, target: 8, rpe: 7 }];
    const history = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, startedAt: '2026-11-01', sets }));
    const a = answerPerformance('should I go heavier on bench?', { history, active: null });
    assert.match(a, /what would you pick/i);
    const fresh = answerPerformance('should I go heavier on bench?', { history: history.slice(0, 2), active: null });
    assert.doesNotMatch(fresh, /what would you pick/i);
  });
});
