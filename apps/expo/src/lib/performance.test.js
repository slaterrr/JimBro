// Per-rep performance metrics and a conservative fatigue assessment from camera rep timing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessFatigue, FATIGUE_LEVELS, repMetrics } from './performance.js';

// Curl: lifting phase is concentric. rom 100° each unless given.
const rep = (i, lift, { rom = 100, lower = 1200, pause = 100 } = {}) => ({ index: i, concentric_ms: lift, peak_pause_ms: pause, eccentric_ms: lower, rom_deg: rom });
const steady = (n, lift = 900) => Array.from({ length: n }, (_, i) => rep(i + 1, lift));
const slowing = (n, from = 800, to = 1500) => Array.from({ length: n }, (_, i) => rep(i + 1, Math.round(from + ((to - from) * i) / (n - 1))));

describe('repMetrics', () => {
  it('reports relative measurements only, and says what it cannot measure', () => {
    const m = repMetrics('curl', steady(6));
    assert.equal(m.calibrated, false);
    assert.match(m.units, /relative|degrees/i);
    assert.equal(m.reps.length, 6);
    assert.equal(m.reps[0].lift_ms, 900);
    assert.equal(m.reps[0].lower_ms, 1200);
    assert.equal(m.reps[0].speed_dps, Math.round(100 / 0.9));
    for (const k of ['peak_velocity', 'acceleration', 'displacement_m']) {
      assert.ok(m.omitted.some((o) => o.metric === k && o.why.length > 10), k);
    }
    assert.ok(!('velocity_mps' in m));
  });

  it('velocity loss and consistency across the set', () => {
    assert.equal(repMetrics('curl', steady(6)).velocityLossPct, 0);
    const s = repMetrics('curl', slowing(8));
    assert.ok(s.velocityLossPct >= 30, `loss ${s.velocityLossPct}`);
    assert.ok(s.consistencyCv > repMetrics('curl', steady(8)).consistencyCv);
  });

  it('uses the lifting phase of each exercise (squat: standing up is the eccentric counter phase)', () => {
    const squat = [rep(1, 900, { lower: 800 }), rep(2, 900, { lower: 800 }), rep(3, 900, { lower: 1600 })];
    assert.equal(repMetrics('squat', squat).reps[2].lift_ms, 1600);
    assert.ok(repMetrics('squat', squat).velocityLossPct > 0);
  });

  it('too few reps: no velocity loss, with a reason', () => {
    const m = repMetrics('curl', steady(2));
    assert.equal(m.velocityLossPct, null);
    assert.ok(m.omitted.some((o) => o.metric === 'velocity_loss'));
  });
});

describe('assessFatigue', () => {
  it('uses only the six levels', () => {
    assert.deepEqual(FATIGUE_LEVELS, ['normal', 'possible_fatigue', 'increasing_difficulty', 'incomplete_rep', 'failed_attempt', 'uncertain']);
  });

  it('steady reps, target met: normal variation', () => {
    const f = assessFatigue({ movement: 'curl', reps: steady(8), target: 8 });
    assert.equal(f.level, 'normal');
  });

  it('a slow set is possible fatigue, never failure', () => {
    const f = assessFatigue({ movement: 'curl', reps: slowing(8), target: 8 });
    assert.equal(f.level, 'possible_fatigue');
    assert.doesNotMatch(f.text, /fail/i);
    assert.ok(f.signals.some((s) => /slower/i.test(s)));
  });

  it('moderate slowing is increasing difficulty', () => {
    const f = assessFatigue({ movement: 'curl', reps: slowing(8, 900, 1150), target: 8 });
    assert.equal(f.level, 'increasing_difficulty');
  });

  it('failed attempt only when an unfinished attempt was seen after the last rep and the target was missed', () => {
    const seen = assessFatigue({ movement: 'curl', reps: steady(6), target: 8, partials: 1, partialAfterLastRep: true });
    assert.equal(seen.level, 'failed_attempt');
    const hit = assessFatigue({ movement: 'curl', reps: steady(8), target: 8, partials: 1, partialAfterLastRep: true });
    assert.equal(hit.level, 'incomplete_rep'); // target met: a half rep at the end is not a failure
    const mid = assessFatigue({ movement: 'curl', reps: steady(6), target: 8, partials: 1, partialAfterLastRep: false });
    assert.equal(mid.level, 'incomplete_rep');
  });

  it('not enough data: uncertain, and says so', () => {
    const f = assessFatigue({ movement: 'curl', reps: steady(2), target: 8 });
    assert.equal(f.level, 'uncertain');
    assert.match(f.text, /not enough|too few/i);
    assert.equal(assessFatigue({ movement: 'bench', reps: [], target: 8, completed: 8 }).level, 'uncertain');
  });

  it('what you report counts, and is labelled as yours', () => {
    const f = assessFatigue({ movement: 'bench', reps: [], target: 8, completed: 8, rpe: 10 });
    assert.equal(f.level, 'increasing_difficulty');
    assert.ok(f.signals.some((s) => /you rated/i.test(s)));
    const r = assessFatigue({ movement: 'curl', reps: steady(8), target: 8, rir: 0 });
    assert.equal(r.level, 'increasing_difficulty');
  });

  it('fewer reps than last time at the same weight is a signal', () => {
    const history = [{ exercise: 'bench', weight: 135, unit: 'lb', reps: 10 }];
    const f = assessFatigue({ movement: 'bench', reps: [], target: 10, completed: 7, weight: 135, unit: 'lb', history });
    assert.ok(f.signals.some((s) => /last time/i.test(s)));
    assert.notEqual(f.level, 'normal');
  });

  it('never reports a reps-in-reserve number from video', () => {
    const f = assessFatigue({ movement: 'curl', reps: slowing(8), target: 8 });
    assert.ok(!('rir' in f));
    assert.doesNotMatch(f.text, /\bRIR\b|in reserve/i);
  });
});

describe('live session reports an unfinished attempt after the last rep', () => {
  it('a half rep at the end sets partialAfterLastRep; one mid-set does not', async () => {
    const { body } = await import('../../../../tools/vision-lab/lib/simulate.mjs');
    const { LiveSession } = await import('./live.js');
    const frames = (angles) => angles.map((elbow, i) => ({ t: 1000 + i * 50, pose: body({ elbow }) }));
    const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
    const full = [...ramp(170, 45, 16), ...ramp(45, 170, 16), ...ramp(170, 170, 6)];
    const half = [...ramp(170, 115, 12), ...ramp(115, 170, 12), ...ramp(170, 170, 6)];
    const run = (seq) => { const s = new LiveSession('curl'); frames(seq).forEach((f) => s.frame(f.t, f.pose)); return s; };
    const end = run([...ramp(170, 170, 10), ...full, ...full, ...half]);
    assert.equal(end.count, 2);
    assert.equal(end.quality().partials, 1);
    assert.equal(end.quality().partialAfterLastRep, true);
    const mid = run([...ramp(170, 170, 10), ...full, ...half, ...full]);
    assert.equal(mid.count, 2);
    assert.equal(mid.quality().partialAfterLastRep, false);
  });
});
