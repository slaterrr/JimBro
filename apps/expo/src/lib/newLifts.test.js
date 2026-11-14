// EXPERIMENTAL pull-up and deadlift camera counting, on SIMULATED landmarks only
// (tools/vision-lab/lib/simulate.mjs). These test the counting logic, not real MediaPipe accuracy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { simulateDeadlifts, simulatePullups, simulateSet, simulateWave } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { LiveSession } from './live.js';

const run = (movement, frames) => {
  const s = new LiveSession(movement);
  const out = frames.map((f) => s.frame(f.t, f.pose));
  return { s, out };
};

describe('pull-up (experimental, simulated)', () => {
  it('counts every rep from a dead hang across seeds, noise and slowing reps', () => {
    for (const seed of [101, 102, 103, 104, 105]) {
      for (const noise of [0.002, 0.005]) {
        const { frames, trueEnds } = simulatePullups({ reps: 8, seed, noise, slowdown: seed % 2 ? 0.6 : 0 });
        const { s } = run('pull_up', frames);
        assert.equal(s.count, trueEnds.length, `seed ${seed} noise ${noise}: ${s.count}/${trueEnds.length}`);
      }
    }
  });

  it('half reps are not counted', () => {
    const { frames } = simulatePullups({ reps: 6, rom: 0.5 });
    assert.equal(run('pull_up', frames).s.count, 0);
  });

  it('presses, curls and waving in pull-up mode count nothing', () => {
    assert.equal(run('pull_up', simulateSet('shoulder_press', { view: 'front', reps: 8 }).frames).s.count, 0, 'front press');
    assert.equal(run('pull_up', simulateSet('shoulder_press', { reps: 8 }).frames).s.count, 0, 'side press');
    assert.equal(run('pull_up', simulateSet('curl', { reps: 8 }).frames).s.count, 0, 'curl');
    assert.equal(run('pull_up', simulateWave().frames).s.count, 0, 'wave');
  });

  it('records per-rep timing for the performance report', () => {
    const { s } = run('pull_up', simulatePullups({ reps: 5 }).frames);
    const d = s.repsDetail();
    assert.equal(d.length, 5);
    assert.ok(d.every((r) => r.concentric_ms > 0 && r.rom_deg > 60));
  });
});

describe('deadlift (experimental, simulated)', () => {
  it('counts every rep from the floor across seeds, noise and slowing reps', () => {
    for (const seed of [91, 92, 93, 94, 95]) {
      for (const noise of [0.002, 0.005]) {
        const { frames, trueEnds } = simulateDeadlifts({ reps: 6, seed, noise, slowdown: seed % 2 ? 0.6 : 0 });
        const { s } = run('deadlift', frames);
        assert.equal(s.count, trueEnds.length, `seed ${seed} noise ${noise}: ${s.count}/${trueEnds.length}`);
      }
    }
  });

  it('partial pulls are not counted', () => {
    assert.equal(run('deadlift', simulateDeadlifts({ reps: 5, rom: 0.5 }).frames).s.count, 0);
  });

  it('squats in deadlift mode are not counted and Jim suggests squat', () => {
    const { s, out } = run('deadlift', simulateSet('squat', { reps: 8 }).frames);
    assert.equal(s.count, 0);
    assert.ok(out.some((o) => o.issue === 'exercise_change'));
    assert.equal(s.suggested, 'squat');
  });

  it('curls and waving in deadlift mode count nothing', () => {
    assert.equal(run('deadlift', simulateSet('curl', { reps: 8 }).frames).s.count, 0);
    assert.equal(run('deadlift', simulateWave().frames).s.count, 0);
  });

  it('deadlifts are not counted as squats or curls in those modes', () => {
    const { frames } = simulateDeadlifts({ reps: 6 });
    assert.equal(run('squat', frames).s.count, 0);
    assert.equal(run('curl', frames).s.count, 0);
  });
});

describe('guidance for the new lifts names the right exercise', () => {
  it('deadlift and pull-up switch lines', async () => {
    const { cameraGuidance } = await import('./guidance.js');
    assert.match(cameraGuidance('exercise_change', 'squat', 'deadlift'), /squats, so deadlift counting is paused/);
    assert.match(cameraGuidance('exercise_change', 'shoulder_press', 'pull_up'), /shoulder presses, so pull-up counting is paused/);
    assert.match(cameraGuidance('exercise_change', 'hang', 'pull_up'), /arms overhead/);
    // existing wording unchanged
    assert.match(cameraGuidance('exercise_change', 'shoulder_press', 'curl'), /so curl counting is paused/);
  });
});

describe('walking is not a rep in any mode', () => {
  it('walking across the frame counts nothing in squat, deadlift, lunge-adjacent or arm modes', async () => {
    const { simulateWalk } = await import('../../../../tools/vision-lab/lib/simulate.mjs');
    for (const seed of [111, 112, 113]) {
      const { frames } = simulateWalk({ seed, steps: 12 });
      for (const mode of ['squat', 'deadlift', 'curl', 'shoulder_press', 'push_up']) {
        assert.equal(run(mode, frames).s.count, 0, `${mode} seed ${seed}`);
      }
    }
  });
});
