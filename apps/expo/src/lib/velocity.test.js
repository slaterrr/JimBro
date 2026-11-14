// Per-rep angular velocity measured from the joint-angle trace (relative: degrees per second).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { simulateSet } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { LiveSession } from './live.js';
import { repMetrics } from './performance.js';

const run = (movement, o) => {
  const s = new LiveSession(movement);
  for (const f of simulateSet(movement, o).frames) s.frame(f.t, f.pose);
  return s.repsDetail();
};

describe('angle-trace velocity', () => {
  it('peak angular speed matches the known simulated motion (curl, 2 s reps: ~196 deg/s)', () => {
    // Simulated elbow: 170 - 125 sin^2(pi t / d) -> peak speed 125 * pi / d = 196 deg/s at d = 2000 ms.
    const reps = run('curl', { reps: 6, repMs: 2000, noise: 0.002, seed: 4 });
    assert.equal(reps.length, 6);
    for (const r of reps) {
      assert.ok(r.peak_dps > 196 * 0.7 && r.peak_dps < 196 * 1.4, `peak ${r.peak_dps}`);
      assert.ok(r.mean_dps > 0 && r.mean_dps < r.peak_dps, `mean ${r.mean_dps}`);
    }
  });

  it('slowing reps show falling peak speed', () => {
    const reps = run('curl', { reps: 8, repMs: 1600, slowdown: 1.0, noise: 0.002, seed: 5 });
    assert.ok(reps.at(-1).peak_dps < reps[0].peak_dps * 0.8, `${reps[0].peak_dps} -> ${reps.at(-1).peak_dps}`);
  });

  it('metrics use the measured trace and label how trustworthy each one is', () => {
    const reps = run('curl', { reps: 6, repMs: 2000, noise: 0.002, seed: 4 });
    const m = repMetrics('curl', reps);
    assert.ok(m.reps[0].peak_dps > 0);
    assert.equal(m.omitted.some((o) => o.metric === 'peak_velocity'), false); // now measured (relative)
    assert.ok(m.omitted.some((o) => o.metric === 'acceleration'));
    assert.equal(m.classes.peak_dps, 'measured_relative');
    assert.equal(m.classes.velocityLossPct, 'derived');
    assert.equal(m.classes.effortRpe, 'estimate');
  });

  it('low tracking marks measurements low-confidence', () => {
    const reps = run('curl', { reps: 6, repMs: 2000, noise: 0.002, seed: 4 });
    assert.equal(repMetrics('curl', reps, { trackedPct: 60 }).confidence, 'low');
    assert.equal(repMetrics('curl', reps, { trackedPct: 98 }).confidence, 'normal');
  });

  it('old saved reps without a trace still work (no peak, reason kept)', () => {
    const m = repMetrics('curl', [{ index: 1, concentric_ms: 900, peak_pause_ms: 100, eccentric_ms: 1000, rom_deg: 100 }]);
    assert.equal(m.reps[0].peak_dps, null);
    assert.ok(m.omitted.some((o) => o.metric === 'peak_velocity'));
  });
});
