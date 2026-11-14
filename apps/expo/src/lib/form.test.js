// Form review: per-rep fault rules over landmark frames. Fixtures come from the vision-lab
// side-view simulator (SIMULATED DATA: proves the rule logic, not real-camera accuracy).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { body } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { analyzeRep, formatFault, IDEAL, THRESHOLDS } from './form.js';

const MOVE = {
  curl: (p) => ({ upperArm: 5, elbow: 170 - 125 * p }),
  squat: (p) => ({ knee: 175 - 95 * p }),
  shoulder_press: (p) => ({ upperArm: 95 + 75 * p, elbow: 80 + 85 * p }),
};
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/** One rep at 20 fps: rest -> peak over upMs, hold, peak -> rest over downMs. `edit(pose, p)` injects faults. */
export function rep(movement, { upMs = 1000, holdMs = 200, downMs = 1000, args = MOVE[movement], edit, t0 = 1000 } = {}) {
  const frames = [];
  const total = upMs + holdMs + downMs;
  for (let t = 0; t <= total; t += 50) {
    const p = t < upMs ? ease(t / upMs) : t < upMs + holdMs ? 1 : 1 - ease((t - upMs - holdMs) / downMs);
    const pose = body(args(p));
    if (edit) edit(pose, p);
    frames.push({ t: t0 + t, pose });
  }
  return frames;
}
const ids = (a) => a.faults.map((f) => f.id).sort();
const get = (a, id) => a.faults.find((f) => f.id === id);

/** Rotate the landmarks in `idx` about point `c` by `deg` (image coords). */
function rotate(pose, idx, c, deg) {
  const r = (deg * Math.PI) / 180;
  const cx = c.x;
  const cy = c.y;
  for (const i of idx) {
    const dx = pose[i].x - cx;
    const dy = pose[i].y - cy;
    pose[i] = { ...pose[i], x: cx + dx * Math.cos(r) - dy * Math.sin(r), y: cy + dx * Math.sin(r) + dy * Math.cos(r) };
  }
}

describe('analyzeRep: clean reps', () => {
  for (const m of ['curl', 'squat', 'shoulder_press']) {
    it(`${m}: a clean simulated rep has no faults`, () => {
      const a = analyzeRep(m, rep(m));
      assert.equal(a.uncertain, undefined);
      assert.deepEqual(a.faults, []);
      assert.equal(a.ok, true);
    });
  }
});

describe('analyzeRep: curl faults', () => {
  it('upper-arm swing reports the measured shoulder angle', () => {
    const a = analyzeRep('curl', rep('curl', { args: (p) => ({ upperArm: 5 + 35 * p, elbow: 170 - 125 * p }) }));
    const f = get(a, 'upper_arm_swing');
    assert.ok(f, ids(a).join());
    assert.ok(Math.abs(f.measured - 40) <= 3, String(f.measured));
    assert.equal(f.threshold, THRESHOLDS.curl.upperArmSwingDeg);
    assert.equal(a.ok, false);
    assert.ok(f.fix.length >= 2 && f.fix.length <= 4 && f.why && f.cue && f.title);
    assert.ok(['minor', 'major'].includes(f.severity));
  });
  it('incomplete top', () => {
    const a = analyzeRep('curl', rep('curl', { args: (p) => ({ upperArm: 5, elbow: 170 - 85 * p }) }));
    assert.deepEqual(ids(a), ['incomplete_top']);
    assert.ok(Math.abs(get(a, 'incomplete_top').measured - 85) <= 2);
  });
  it('incomplete bottom', () => {
    const a = analyzeRep('curl', rep('curl', { args: (p) => ({ upperArm: 5, elbow: 135 - 90 * p }) }));
    assert.deepEqual(ids(a), ['incomplete_bottom']);
    assert.ok(Math.abs(get(a, 'incomplete_bottom').measured - 135) <= 2);
  });
  it('fast lowering, with t at the top of the rep', () => {
    const a = analyzeRep('curl', rep('curl', { downMs: 300 }));
    assert.deepEqual(ids(a), ['fast_lowering']);
    const f = get(a, 'fast_lowering');
    assert.ok(f.measured < THRESHOLDS.curl.minEccentricS);
    assert.ok(f.t >= 1900 && f.t <= 2250, String(f.t));
  });
  it('torso swing (shoulder travels forward)', () => {
    const a = analyzeRep('curl', rep('curl', {
      edit: (pose, p) => { for (const i of [11, 13, 15]) pose[i] = { ...pose[i], x: pose[i].x + 0.1 * p }; },
    }));
    const f = get(a, 'torso_swing');
    assert.ok(f, ids(a).join());
    assert.ok(Math.abs(f.measured - 0.4) < 0.05, String(f.measured));
  });
});

describe('analyzeRep: squat faults', () => {
  it('shallow depth', () => {
    const a = analyzeRep('squat', rep('squat', { args: (p) => ({ knee: 175 - 60 * p }) }));
    assert.deepEqual(ids(a), ['shallow_depth']);
    assert.ok(Math.abs(get(a, 'shallow_depth').measured - 115) <= 2);
  });
  it('forward torso lean', () => {
    const a = analyzeRep('squat', rep('squat', {
      edit: (pose, p) => rotate(pose, [11, 13, 15], { ...pose[23] }, 40 * p),
    }));
    const f = get(a, 'forward_lean');
    assert.ok(f, ids(a).join());
    assert.ok(f.measured > 55 && f.measured < 70, String(f.measured));
  });
  it('fast descent', () => {
    const a = analyzeRep('squat', rep('squat', { upMs: 300 }));
    assert.deepEqual(ids(a), ['fast_descent']);
  });
});

describe('analyzeRep: shoulder press faults', () => {
  it('incomplete lockout', () => {
    const a = analyzeRep('shoulder_press', rep('shoulder_press', { args: (p) => ({ upperArm: 95 + 60 * p, elbow: 80 + 60 * p }) }));
    assert.deepEqual(ids(a), ['incomplete_lockout']);
    assert.ok(Math.abs(get(a, 'incomplete_lockout').measured - 140) <= 2);
  });
  it('leaning back', () => {
    const a = analyzeRep('shoulder_press', rep('shoulder_press', {
      edit: (pose, p) => rotate(pose, [11, 13, 15], { ...pose[23] }, 28 * p),
    }));
    const f = get(a, 'lean_back');
    assert.ok(f, ids(a).join());
    assert.ok(Math.abs(f.measured - 29) <= 3, String(f.measured));
  });
  it('partial bottom', () => {
    const a = analyzeRep('shoulder_press', rep('shoulder_press', { args: (p) => ({ upperArm: 120 + 50 * p, elbow: 120 + 45 * p }) }));
    assert.deepEqual(ids(a), ['partial_bottom']);
  });
});

describe('analyzeRep: uncertainty', () => {
  it('returns uncertain instead of faults when tracking was low', () => {
    const frames = rep('curl', { args: (p) => ({ upperArm: 5 + 35 * p, elbow: 170 - 125 * p }) });
    frames.forEach((f, i) => { if (i % 2) f.pose[13] = { ...f.pose[13], visibility: 0.2 }; });
    const a = analyzeRep('curl', frames);
    assert.equal(a.uncertain, true);
    assert.deepEqual(a.faults, []);
    assert.equal(a.ok, false);
  });
  it('too few frames is uncertain', () => {
    assert.equal(analyzeRep('curl', rep('curl').slice(0, 3)).uncertain, true);
  });
});

describe('formatFault and IDEAL', () => {
  it('formats a fault for the review list', () => {
    assert.equal(formatFault({ title: 'Elbow swing', measured: 34, threshold: 25, unit: 'deg' }), 'Elbow swing · 34° (limit 25°)');
    assert.equal(formatFault({ title: 'Fast lowering', measured: 0.3, threshold: 0.6, unit: 's' }), 'Fast lowering · 0.3s (limit 0.6s)');
  });
  for (const m of ['curl', 'squat', 'shoulder_press']) {
    it(`${m}: ideal demo poses are clean and checkpoints are listed`, () => {
      const ideal = IDEAL[m];
      assert.ok(ideal.checkpoints.length >= 3 && ideal.checkpoints.length <= 5);
      const frames = [];
      for (let i = 0; i <= 40; i++) frames.push({ t: i * 60, pose: ideal.phase(i / 40) });
      assert.equal(frames[0].pose.length, 33);
      assert.equal(analyzeRep(m, frames).ok, true);
    });
  }
});
