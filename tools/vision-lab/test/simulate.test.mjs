import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jointAngle } from '../../../apps/expo/src/lib/angles.js';
import { replay, scoreClip } from '../lib/evaluate.mjs';
import { body, simulateHallucination, simulateSet, simulateWave } from '../lib/simulate.mjs';

test('the simulated body produces the requested elbow and knee angles', () => {
  const p = body({ upperArm: 5, elbow: 60, knee: 100 });
  assert.ok(Math.abs(jointAngle(p[11], p[13], p[15]) - 60) < 0.5);
  assert.ok(Math.abs(jointAngle(p[23], p[25], p[27]) - 100) < 0.5);
});

test('simulation is deterministic for a seed', () => {
  assert.deepEqual(simulateSet('curl', { seed: 7 }).frames, simulateSet('curl', { seed: 7 }).frames);
});

for (const movement of ['curl', 'squat', 'shoulder_press']) {
  test(`${movement}: a 20-rep set is counted exactly, with timing inside tolerance`, () => {
    const { frames, trueEnds } = simulateSet(movement, { reps: 20, repMs: 1800, slowdown: 0.6, seed: 11 });
    assert.equal(trueEnds.length, 20);
    const s = scoreClip({ trueEnds, predEnds: replay(movement, frames).predEnds });
    assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: 20, fp: 0, fn: 0 });
  });
}

test('partial-range reps are not counted', () => {
  const { frames } = simulateSet('curl', { reps: 10, rom: 0.5, seed: 5 });
  assert.equal(replay('curl', frames).predEnds.length, 0);
});

test('waving with a raised arm is not counted as curls', () => {
  const { frames } = simulateWave();
  assert.equal(replay('curl', frames).predEnds.length, 0);
});

test('a hallucinated wrist (forearm length jumps, upper arm still) is not counted as curls', () => {
  const { frames } = simulateHallucination();
  assert.equal(replay('curl', frames).predEnds.length, 0);
});

test('fast but real curls (about 1.1 s per rep) are still all counted', () => {
  const { frames, trueEnds } = simulateSet('curl', { reps: 20, repMs: 1100, restMs: 250, seed: 21 });
  const s = scoreClip({ trueEnds, predEnds: replay('curl', frames).predEnds });
  assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: 20, fp: 0, fn: 0 });
});

test('curls with the hips below the frame edge (waist-up framing) are paused, not counted', () => {
  const { frames } = simulateSet('curl', { reps: 6, seed: 9 });
  const cropped = frames.map((f) => ({ ...f, pose: f.pose.map((p, i) => ([23, 24].includes(i) ? { ...p, y: 0.99 } : p)) }));
  const out = replay('curl', cropped);
  assert.equal(out.predEnds.length, 0);
  assert.ok(out.frames.some((f) => f.issue === 'framing'));
});
