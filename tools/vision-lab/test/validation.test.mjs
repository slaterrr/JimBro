// Real-video validation framework: landmark reliability + engine-API scoring + aggregation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { landmarkReliability } from '../lib/reliability.mjs';
import { simulateSet } from '../lib/simulate.mjs';
import { aggregate, loadClip, validateClip } from '../lib/validation.mjs';

const fixture = (name) => loadClip(JSON.parse(readFileSync(new URL(`../fixtures/${name}.landmarks.json`, import.meta.url), 'utf8')));

describe('landmark reliability', () => {
  it('reports tracked share, per-joint visibility, jitter, dropouts and jumps', () => {
    const r = landmarkReliability(fixture('fs_squat_rear').frames, 'squat');
    assert.ok(r.trackedPct >= 0 && r.trackedPct <= 100);
    assert.ok(r.joints.knee.meanVisibility > 0);
    assert.ok(Number.isFinite(r.jitterTorsoPct));
    assert.ok(Number.isInteger(r.dropouts) && Number.isInteger(r.jumps));
  });

  it('a clean simulated set is fully tracked with low jitter; dropped frames are counted', () => {
    const { frames } = simulateSet('curl', { reps: 4, noise: 0.002 });
    const clean = landmarkReliability(frames, 'curl');
    assert.equal(clean.trackedPct, 100);
    assert.equal(clean.dropouts, 0);
    const holes = frames.map((f, i) => (i % 40 < 5 ? { ...f, pose: null } : f));
    assert.ok(landmarkReliability(holes, 'curl').dropouts >= 3);
  });
});

describe('validateClip (through the engine API)', () => {
  it('scores the four real clips: 3 true reps matched, 0 false, 0 missed', () => {
    const rows = ['fs_squat_rear', 'fs_press_rear', 'ez_talk_a', 'ez_talk_b'].map((n) => validateClip(fixture(n)));
    const tp = rows.reduce((a, r) => a + r.tp, 0);
    assert.equal(tp, 3);
    assert.equal(rows.reduce((a, r) => a + r.fp, 0), 0);
    assert.equal(rows.reduce((a, r) => a + r.fn, 0), 0);
    assert.ok(rows.every((r) => r.source === 'real'));
    assert.ok(rows.every((r) => r.reliability && r.validation));
  });

  it('wrong-mode runs: counts there are false counts, and mismatches are reported', () => {
    const clip = { ...loadClip({ clip: 'sim_squat', movement: 'squat', source: 'sim', reps: [], frames: [] }), ...(() => {
      const s = simulateSet('squat', { reps: 5 });
      return { frames: s.frames, reps: s.trueEnds.map((end_ms) => ({ end_ms })), wrongModes: ['curl', 'deadlift'] };
    })() };
    const r = validateClip(clip);
    assert.equal(r.tp, 5);
    assert.equal(r.wrongMode.length, 2);
    for (const w of r.wrongMode) assert.equal(w.falseCounts, 0, w.mode);
  });
});

describe('aggregate', () => {
  it('never mixes real and simulated results, and groups by exercise and view', () => {
    const real = validateClip(fixture('fs_squat_rear'));
    const s = simulateSet('squat', { reps: 4 });
    const sim = validateClip(loadClip({ clip: 'sim', movement: 'squat', source: 'sim', view: 'side', reps: s.trueEnds.map((end_ms) => ({ end_ms })), frames: s.frames }));
    const a = aggregate([real, sim]);
    assert.ok(a.real.squat && a.sim.squat);
    assert.equal(a.real.squat.tp, 2);
    assert.equal(a.sim.squat.tp, 4);
    assert.ok(a.real.squat.recall === 1 && a.real.squat.precision === 1);
    assert.ok(a.byView.real['squat/unknown']); // fixtures don't record the camera view
  });

  it('clips without a source are treated as unknown, not real', () => {
    const c = loadClip({ clip: 'x', movement: 'curl', reps: [], frames: [] });
    assert.equal(c.source, 'unknown');
  });
});
