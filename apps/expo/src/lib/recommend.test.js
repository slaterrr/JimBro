// Adaptive weight recommendation: conservative, explained, optional (the user approves), and
// checked against history afterwards.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACTIONS, evaluateRecommendations, recommendNext } from './recommend.js';

const base = { exercise: 'bench', unit: 'lb', weight: 135, target: 8, completed: 8 };
const fatigue = (level) => ({ level, signals: [], text: '' });

describe('recommendNext', () => {
  it('only uses the six actions and always needs approval', () => {
    assert.deepEqual(ACTIONS, ['increase', 'same', 'decrease', 'more_rest', 'fewer_reps', 'none']);
    const r = recommendNext({ ...base, rpe: 7, fatigue: fatigue('normal') });
    assert.ok(ACTIONS.includes(r.action));
    assert.equal(r.needsApproval, true);
    assert.ok(r.reasons.length > 0);
  });

  it('a completed weighted set keeps the actual load even at easy effort', () => {
    const r = recommendNext({ ...base, rpe: 7, fatigue: fatigue('normal') });
    assert.equal(r.action, 'same');
    assert.equal(r.weight, 135);
    assert.equal(r.reps, 8);
  });

  it('never increases just because the reps looked clean (no effort reported)', () => {
    const r = recommendNext({ ...base, rpe: null, fatigue: fatigue('normal') });
    assert.notEqual(r.action, 'increase');
    assert.ok(r.reasons.some((x) => /how hard|rate/i.test(x)));
    const extraReps = recommendNext({ ...base, completed: 11, rpe: null, fatigue: fatigue('normal') });
    assert.equal(extraReps.action, 'same');
    assert.equal(extraReps.weight, 135);
  });

  it('hard but complete: same weight', () => {
    assert.equal(recommendNext({ ...base, rpe: 8.5, fatigue: fatigue('normal') }).action, 'same');
  });

  it('possible fatigue mid-workout: more rest, not an automatic weight change', () => {
    const r = recommendNext({ ...base, rpe: 8, fatigue: fatigue('possible_fatigue'), setNo: 2, sets: 4 });
    assert.equal(r.action, 'more_rest');
    assert.equal(r.weight, 135);
    assert.ok(r.extraRestS >= 30);
  });

  it('missed the target: keep, cut reps, or reduce depending on how far', () => {
    assert.equal(recommendNext({ ...base, completed: 7, rpe: 9, fatigue: fatigue('increasing_difficulty'), setNo: 2, sets: 3 }).action, 'fewer_reps');
    const far = recommendNext({ ...base, completed: 5, rpe: 10, fatigue: fatigue('increasing_difficulty') });
    assert.equal(far.action, 'decrease');
    assert.ok(far.weight < 135 && far.weight >= 135 * 0.9, `→ ${far.weight}`);
    const failed = recommendNext({ ...base, completed: 6, rpe: null, fatigue: fatigue('failed_attempt') });
    assert.equal(failed.action, 'decrease');
  });

  it('very hard (RPE 10 / no reps left) on a complete set: same weight', () => {
    assert.equal(recommendNext({ ...base, rpe: 10, fatigue: fatigue('increasing_difficulty') }).action, 'same');
  });

  it('no weight or no count: no recommendation', () => {
    assert.equal(recommendNext({ ...base, weight: null, rpe: 7 }).action, 'none');
    assert.equal(recommendNext({ ...base, completed: null, rpe: 7 }).action, 'none');
  });

  it('bodyweight: never adds load; adds a rep when easy', () => {
    const r = recommendNext({ ...base, exercise: 'push_up', weight: 0, rpe: 6, fatigue: fatigue('normal') });
    assert.equal(r.weight, 0);
    assert.equal(r.action, 'same');
    assert.equal(r.reps, 9);
  });

  it('keeps the logged load in kilograms', () => {
    const r = recommendNext({ ...base, unit: 'kg', weight: 60, rpe: 6.5, fatigue: fatigue('normal') });
    assert.equal(r.action, 'same');
    assert.equal(r.weight, 60);
  });

  it('history: after an accepted increase that turned out too hard, hold instead of increasing again', () => {
    const history = [
      { exercise: 'bench', unit: 'lb', weight: 135, reps: 8, rpe: 7, rec: { action: 'increase', weight: 140, accepted: true } },
      { exercise: 'bench', unit: 'lb', weight: 140, reps: 5, rpe: 10 },
    ];
    const r = recommendNext({ ...base, rpe: 7, fatigue: fatigue('normal'), history });
    assert.equal(r.action, 'same');
    assert.ok(r.reasons.some((x) => /last time|last increase/i.test(x)));
  });
});

describe('evaluateRecommendations', () => {
  it('checks accepted suggestions against what happened next, and admits when there is too little data', () => {
    const history = [
      { exercise: 'bench', unit: 'lb', weight: 135, reps: 8, target: 8, rpe: 7, rec: { action: 'increase', weight: 140, reps: 8, accepted: true } },
      { exercise: 'bench', unit: 'lb', weight: 140, reps: 8, target: 8, rpe: 8.5 },
      { exercise: 'curl', unit: 'lb', weight: 30, reps: 10, target: 10, rpe: 7, rec: { action: 'increase', weight: 32.5, reps: 10, accepted: true } },
      { exercise: 'curl', unit: 'lb', weight: 32.5, reps: 6, target: 10, rpe: 10 },
      { exercise: 'squat', unit: 'lb', weight: 185, reps: 5, target: 5, rpe: 7, rec: { action: 'increase', weight: 190, reps: 5, accepted: false } },
    ];
    const e = evaluateRecommendations(history);
    assert.equal(e.accepted, 2);
    assert.equal(e.declined, 1);
    assert.equal(e.worked, 1);
    assert.equal(e.tooHard, 1);
    assert.equal(e.enoughData, false);
    assert.match(e.text, /not enough|too early/i);
  });
});

describe('measured speed vs reported effort', () => {
  const easy = { ...base, rir: 3, rpe: null };
  const metrics = (velocityLossPct) => ({ velocityLossPct, calibrated: false });

  it('agreeing evidence: cites both sources and is more confident', () => {
    const r = recommendNext({ ...easy, fatigue: fatigue('normal'), metrics: metrics(5) });
    assert.equal(r.action, 'same');
    assert.equal(r.agreement, 'agree');
    assert.equal(r.confidence, 'higher');
    assert.deepEqual(r.evidence.map((e) => e.source).sort(), ['measured', 'reported']);
  });

  it('reps slowed a lot but the user felt fresh: no increase, asks to check', () => {
    const r = recommendNext({ ...easy, fatigue: fatigue('normal'), metrics: metrics(35) });
    assert.notEqual(r.action, 'increase');
    assert.equal(r.agreement, 'measured_harder');
    assert.ok(r.reasons.some((x) => /slowed|slower/i.test(x) && /check|one more/i.test(x)));
  });

  it('user says it was very hard while speed held: the user wins', () => {
    const r = recommendNext({ ...base, rir: 0, fatigue: fatigue('increasing_difficulty'), metrics: metrics(4) });
    assert.notEqual(r.action, 'increase');
    assert.equal(r.agreement, 'reported_harder');
    assert.ok(r.evidence.some((e) => e.source === 'reported'));
  });

  it('only one source: lower confidence and says what is missing', () => {
    const r = recommendNext({ ...easy, fatigue: fatigue('normal') });
    assert.equal(r.confidence, 'lower');
    assert.equal(r.agreement, 'reported_only');
  });
});
