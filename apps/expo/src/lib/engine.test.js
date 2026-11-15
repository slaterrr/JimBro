// On-phone engine: ports of the backend's tested logic (reps, coach, plans, progress)
// plus records and streaks. Cases mirror backend/tests so behaviour stays identical.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coachReply, suggestNext, TONES } from './coach.js';
import { buildPlan, validatePlan } from './plans.js';
import { personalRecords, streak, trend, weeklyProgress } from './progress.js';
import { CURL, MOVEMENTS, RepCounter, SHOULDER_PRESS, SQUAT, movementConfig } from './reps.js';

// --- rep counter ---------------------------------------------------------------------

const DT = 33;
const ramp = (a, b, ms, t0) => {
  const n = Math.max(1, Math.floor(ms / DT));
  return Array.from({ length: n }, (_, i) => [t0 + (i + 1) * DT, a + ((b - a) * (i + 1)) / n]);
};
const hold = (a, ms, t0) => Array.from({ length: Math.max(1, Math.floor(ms / DT)) }, (_, i) => [t0 + (i + 1) * DT, a]);
function curlReps(n, { up = 800, top = 200, down = 1200, rest = 400, low = 170, high = 40 } = {}) {
  let out = [[0, low]];
  for (let k = 0; k < n; k++) {
    for (const seg of [(t) => hold(low, rest, t), (t) => ramp(low, high, up, t), (t) => hold(high, top, t), (t) => ramp(high, low, down, t)]) {
      out = out.concat(seg(out[out.length - 1][0]));
    }
  }
  return out.concat(hold(low, rest, out[out.length - 1][0]));
}
function feed(samples, config = CURL, confidence = 0.9) {
  const c = new RepCounter(config);
  const reps = [];
  for (const [t, a] of samples) {
    const r = c.update({ t_ms: t, angle_deg: a, confidence });
    if (r) reps.push(r);
  }
  return [c, reps];
}

describe('RepCounter (port of reps.py)', () => {
  it('counts 5 full curls with indices and zero for a stationary arm', () => {
    const [c, reps] = feed(curlReps(5));
    assert.equal(c.count, 5);
    assert.deepEqual(reps.map((r) => r.index), [1, 2, 3, 4, 5]);
    assert.equal(feed(hold(170, 5000, 0))[0].count, 0);
  });
  it('reports phase timing that sums to TUT', () => {
    const [, [r]] = feed(curlReps(1, { up: 900, top: 300, down: 1500 }));
    assert.ok(r.concentric_ms >= 450 && r.concentric_ms <= 900);
    assert.ok(r.eccentric_ms > r.concentric_ms);
    assert.equal(r.tut_ms, r.concentric_ms + r.peak_pause_ms + r.eccentric_ms);
    assert.equal(r.end_ms - r.start_ms, r.tut_ms);
  });
  it('rejects partials, fast bounces and jitter double counts', () => {
    const [p] = feed(curlReps(3, { high: 110 }));
    assert.deepEqual([p.count, p.partials], [0, 3]);
    const [b] = feed(curlReps(1, { up: 100, top: 0, down: 100 }));
    assert.deepEqual([b.count, b.partials], [0, 1]);
    const noisy = curlReps(2).map(([t, a], i) => [t, a + (i % 2 ? 6 : -6)]);
    assert.equal(feed(noisy)[0].count, 2);
  });
  it('aborts on long occlusion and ignores out-of-order and NaN samples', () => {
    const s = curlReps(1);
    const mid = Math.floor(s.length / 2);
    const c = new RepCounter(CURL);
    s.slice(0, mid).forEach(([t, a]) => c.update({ t_ms: t, angle_deg: a, confidence: 0.9 }));
    hold(90, 1500, s[mid][0]).forEach(([t, a]) => c.update({ t_ms: t, angle_deg: a, confidence: 0.1 }));
    hold(170, 600, s[mid][0] + 1500).forEach(([t, a]) => c.update({ t_ms: t, angle_deg: a, confidence: 0.9 }));
    assert.deepEqual([c.count, c.state], [0, 'rest']);
    const d = new RepCounter(CURL);
    d.update({ t_ms: 1000, angle_deg: 170, confidence: 0.9 });
    d.update({ t_ms: 900, angle_deg: 40, confidence: 0.9 });
    d.update({ t_ms: 1100, angle_deg: NaN, confidence: 0.9 });
    assert.equal(d.state, 'rest');
  });
  it('handles squat and the increasing shoulder press', () => {
    assert.equal(feed(curlReps(2, { low: 172, high: 85 }), SQUAT)[0].count, 2);
    assert.equal(feed(curlReps(3, { low: 80, high: 168 }), SHOULDER_PRESS)[0].count, 3);
    assert.deepEqual(Object.keys(MOVEMENTS), ['curl', 'squat', 'shoulder_press', 'push_up', 'pull_up', 'deadlift', 'lunge']); // last three experimental (lib/analyzers.js)
  });
  it('matches the exact threshold boundaries of the backend', () => {
    const cfg = movementConfig({ name: 't', rest_deg: 170, peak_deg: 50, hysteresis_deg: 10, smoothing: 1, min_rep_ms: 0, cooldown_ms: 0 });
    const run = (steps) => { const c = new RepCounter(cfg); steps.forEach(([t, d]) => c.update({ t_ms: t, angle_deg: 170 - d, confidence: 0.9 })); return c; };
    assert.equal(run([[0, 0], [100, 20]]).state, 'rest');
    assert.equal(run([[0, 0], [100, 20.5]]).state, 'concentric');
    assert.equal(run([[0, 0], [100, 50], [200, 110]]).state, 'peak');
    assert.equal(run([[0, 0], [100, 50], [200, 115], [300, 100]]).state, 'peak');
    assert.equal(run([[0, 0], [100, 50], [200, 115], [300, 99.5]]).state, 'eccentric');
    assert.equal(run([[0, 0], [100, 50], [200, 115], [300, 50], [400, 10]]).count, 1);
  });
  it('validates configs', () => {
    assert.throws(() => movementConfig({ name: 'x', rest_deg: 100, peak_deg: 100, hysteresis_deg: 0 }), /must differ/);
    assert.throws(() => movementConfig({ name: 'x', rest_deg: 170, peak_deg: 50, smoothing: 0 }), /smoothing/);
  });
});

// --- coach -----------------------------------------------------------------------------

const set = (weight, reps, rpe, unit = 'kg', exercise = 'curl') => ({ exercise, weight, reps, rpe, unit });

describe('suggestNext (port of coach.suggest_next)', () => {
  it('holds recorded weighted targets, retains cautious reductions and allows bodyweight progression', () => {
    assert.equal(suggestNext([]), null);
    const easy = suggestNext([set(20, 10, 6)]);
    assert.deepEqual([easy.weight, easy.reps], [20, 10]);
    assert.match(easy.rationale, /RPE 6/);
    const hard = suggestNext([set(20, 6, 9.5)]);
    assert.ok(hard.weight < 20 && hard.weight >= 18);
    assert.deepEqual([suggestNext([set(20, 8, 8)]).weight, suggestNext([set(20, 8, 8)]).reps], [20, 8]);
    assert.deepEqual([suggestNext([set(20, 8, null)]).weight, suggestNext([set(20, 8, null)]).reps], [20, 8]);
    assert.deepEqual([suggestNext([set(0, 5, 6)]).weight, suggestNext([set(0, 5, 6)]).reps], [0, 6]);
    const lb = suggestNext([set(45, 10, 6, 'lb')]);
    assert.ok(lb.unit === 'lb' && lb.weight === 45);
  });
});

describe('coachReply', () => {
  const history = [set(20, 10, 6)];
  it('changes style by tone but keeps the grounded numbers', () => {
    const texts = TONES.map((t) => coachReply('what next?', t, history));
    assert.equal(new Set(texts.map((r) => r.text)).size, 4);
    for (const r of texts) {
      assert.match(r.text, /21/);
      assert.equal(r.suggestion.exercise, 'curl');
    }
  });
  it('gives the same safety reply in every tone and asks for a first set when empty', () => {
    const safety = new Set(TONES.map((t) => coachReply('sharp pain in my knee', t, history).text));
    assert.equal(safety.size, 1);
    assert.match([...safety][0], /stop/i);
    assert.match(coachReply('hi', 'friendly', []).text, /log/i);
  });
  it('focuses on the exercise named in the message', () => {
    const r = coachReply('how about squats?', 'direct', [set(20, 10, 6), set(60, 5, 8, 'kg', 'squat')]);
    assert.equal(r.suggestion.exercise, 'squat');
  });
});

// --- plans -----------------------------------------------------------------------------

describe('buildPlan (port of plans.build_plan)', () => {
  it('honours days, minutes and equipment for every goal', () => {
    for (const goal of ['strength', 'hypertrophy', 'general']) {
      for (let days = 1; days <= 6; days++) {
        const req = { goal, days_per_week: days, minutes_per_session: 45, equipment: ['barbell', 'dumbbells', 'pullup_bar', 'bodyweight'] };
        const plan = buildPlan(req);
        assert.equal(plan.days.length, days);
        assert.deepEqual(validatePlan(plan, req), []);
      }
    }
  });
  it('restricts exercises to the equipment and varies reps by goal', () => {
    const used = new Set(buildPlan({ goal: 'general', days_per_week: 2, minutes_per_session: 30, equipment: ['bodyweight'] }).days.flatMap((d) => d.items.map((i) => i.exercise)));
    assert.deepEqual([...used], ['squat']);
    const s = buildPlan({ goal: 'strength', days_per_week: 3, minutes_per_session: 60, equipment: ['barbell'] });
    const h = buildPlan({ goal: 'hypertrophy', days_per_week: 3, minutes_per_session: 60, equipment: ['barbell'] });
    assert.ok(Math.max(...s.days.flatMap((d) => d.items.map((i) => i.reps_high))) <= 6);
    assert.ok(Math.min(...h.days.flatMap((d) => d.items.map((i) => i.reps_low))) > 6);
  });
  it('fits very short sessions and catches violations', () => {
    const req = { goal: 'hypertrophy', days_per_week: 3, minutes_per_session: 15, equipment: ['barbell'] };
    assert.ok(buildPlan(req).days.every((d) => d.estimated_minutes <= 15 && d.items.length >= 1));
    const bad = buildPlan({ goal: 'general', days_per_week: 2, minutes_per_session: 30, equipment: ['dumbbells'] });
    bad.days[0].items[0].exercise = 'deadlift';
    bad.days.pop();
    const problems = validatePlan(bad, { goal: 'general', days_per_week: 2, minutes_per_session: 30, equipment: ['dumbbells'] });
    assert.ok(problems.some((p) => /days/.test(p)) && problems.some((p) => /equipment/.test(p)));
    assert.throws(() => buildPlan({ ...req, equipment: [] }), /equipment/);
  });
});

// --- progress, records, streaks -----------------------------------------------------------

const workout = (date, sets) => ({ id: date, startedAt: `${date}T10:00:00.000Z`, sets });

describe('progress', () => {
  const history = [
    workout('2026-11-02', [set(10, 10, null), set(12, 8, null)]),
    workout('2026-11-05', [set(14, 8, null), set(30, 8, null, 'lb')]),
  ];
  it('trends per unit with first-session denominator', () => {
    const t = trend(history, 'curl');
    assert.deepEqual(t.kg.points.map((p) => p.top_weight), [12, 14]);
    assert.equal(t.kg.top_weight_change_pct, Math.round(((14 - 12) / 12) * 1000) / 10);
    assert.equal(t.lb.top_weight_change_pct, null);
  });
  it('shows a historical high from completed sets even after a lighter workout', () => {
    const t = trend([
      ...history,
      workout('2026-11-10', [set(9, 10, null), set(99, 0, null)]),
    ], 'curl');
    assert.deepEqual(t.kg.points.map((p) => p.top_weight), [12, 14, 9]);
    assert.equal(t.kg.best_logged_weight, 14);
    assert.equal(t.lb.best_logged_weight, 30);
  });

  it('finds personal records per exercise and unit (heaviest, most reps, best volume set)', () => {
    const pr = personalRecords(history);
    const kg = pr.find((r) => r.exercise === 'curl' && r.unit === 'kg');
    assert.deepEqual([kg.heaviest.weight, kg.most_reps.reps, kg.best_set_volume], [14, 10, 112]);
    assert.ok(pr.some((r) => r.unit === 'lb'));
  });
  it('flags a set that beats the previous record', () => {
    const pr = personalRecords(history, set(15, 8, null));
    assert.equal(pr.find((r) => r.unit === 'kg').is_new_heaviest, true);
    assert.equal(personalRecords(history, set(13, 3, null)).find((r) => r.unit === 'kg').is_new_heaviest, false);
  });
  it('counts week streaks and weekly goal progress', () => {
    const days = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-04', '2026-11-11'].map((d) => workout(d, [set(1, 1, null)]));
    const now = new Date('2026-11-14T12:00:00Z');
    assert.equal(streak(days, now), 4); // four consecutive ISO weeks up to this one
    assert.equal(streak([], now), 0);
    assert.deepEqual(weeklyProgress(days, 3, now), { done: 1, goal: 3 });
  });
});
