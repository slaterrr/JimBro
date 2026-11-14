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

test('front squats (facing the camera) are counted: 10 of 10', () => {
  const { frames, trueEnds } = simulateSet('squat', { reps: 10, view: 'front', seed: 31 });
  const s = scoreClip({ trueEnds, predEnds: replay('squat', frames).predEnds });
  assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: 10, fp: 0, fn: 0 });
});

test('front-view half squats are still not counted', () => {
  const { frames } = simulateSet('squat', { reps: 8, rom: 0.4, view: 'front', seed: 32 });
  assert.equal(replay('squat', frames).predEnds.length, 0);
});

test('front squat with feet cut off tells the user what to fix (not silent)', () => {
  const { frames } = simulateSet('squat', { reps: 3, view: 'front', seed: 33 });
  const cut = frames.map((f) => ({ ...f, pose: f.pose.map((p, i) => ([27, 28, 29, 30, 31, 32].includes(i) ? { ...p, visibility: 0.05 } : p)) }));
  const out = replay('squat', cut);
  assert.ok(out.frames.some((f) => f.issue && f.hint === 'feet'), 'expected a "show your feet" hint');
});

test('lunges done in squat mode are not counted as squats, and the change is detected (side view)', async () => {
  const { simulateLunges } = await import('../lib/simulate.mjs');
  const out = replay('squat', simulateLunges().frames);
  assert.equal(out.predEnds.length, 0);
  assert.ok(out.frames.some((f) => f.issue === 'exercise_change' && f.hint === 'lunge'));
  assert.equal(out.suggested, 'lunge');
});

test('lunges facing the camera are not counted as squats either', async () => {
  const { simulateLunges } = await import('../lib/simulate.mjs');
  const out = replay('squat', simulateLunges({ view: 'front', seed: 42 }).frames);
  assert.equal(out.predEnds.length, 0);
  assert.equal(out.suggested, 'lunge');
});

test('switching from squats to lunges mid-set keeps the squats already counted', async () => {
  const { simulateLunges } = await import('../lib/simulate.mjs');
  const sq = simulateSet('squat', { reps: 5, seed: 43 });
  const last = sq.frames[sq.frames.length - 1].t;
  const lu = simulateLunges({ seed: 44 }).frames.map((f) => ({ ...f, t: f.t + last + 50 }));
  const out = replay('squat', [...sq.frames, ...lu]);
  assert.equal(out.predEnds.length, 5);
  assert.equal(out.suggested, 'lunge');
});

// Arm-lift exercise changes. Generators: lib/simulate.mjs simulateOtherLift / simulateSwitch.
for (const view of ['side', 'front']) {
  test(`shoulder presses in curl mode are not counted, and the change is suggested (${view} view)`, async () => {
    const { simulateOtherLift } = await import('../lib/simulate.mjs');
    const out = replay('curl', simulateOtherLift('shoulder_press', { reps: 8, view, seed: 61 }).frames);
    assert.equal(out.predEnds.length, 0);
    assert.ok(out.frames.some((f) => f.issue === 'exercise_change' && f.hint === 'shoulder_press'));
    assert.equal(out.suggested, 'shoulder_press');
  });

  test(`curls in shoulder-press mode are not counted, and the change is suggested (${view} view)`, async () => {
    const { simulateOtherLift } = await import('../lib/simulate.mjs');
    const out = replay('shoulder_press', simulateOtherLift('curl', { reps: 8, view, seed: 62 }).frames);
    assert.equal(out.predEnds.length, 0);
    assert.ok(out.frames.some((f) => f.issue === 'exercise_change' && f.hint === 'curl'));
    assert.equal(out.suggested, 'curl');
  });

  test(`curls or presses while standing still in squat mode: no squats, no suggestion (${view} view)`, () => {
    for (const lift of ['curl', 'shoulder_press']) {
      const out = replay('squat', simulateSet(lift, { reps: 6, view, seed: 63 }).frames);
      assert.equal(out.predEnds.length, 0);
      assert.equal(out.suggested, null);
      assert.ok(!out.frames.some((f) => f.issue === 'exercise_change'));
    }
  });
}

test('switching from curls to presses mid-set keeps the 5 curls and suggests shoulder press', async () => {
  const { simulateSwitch } = await import('../lib/simulate.mjs');
  const { frames, trueEnds } = simulateSwitch('curl', 'shoulder_press', { fromReps: 5, toReps: 6 });
  const out = replay('curl', frames);
  const s = scoreClip({ trueEnds, predEnds: out.predEnds });
  assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: 5, fp: 0, fn: 0 });
  assert.equal(out.suggested, 'shoulder_press');
});

test('a normal shoulder-press set facing the camera is counted exactly and suggests nothing', () => {
  const { frames, trueEnds } = simulateSet('shoulder_press', { reps: 20, repMs: 1800, slowdown: 0.6, view: 'front', seed: 64 });
  const out = replay('shoulder_press', frames);
  const s = scoreClip({ trueEnds, predEnds: out.predEnds });
  assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: 20, fp: 0, fn: 0 });
  assert.equal(out.suggested, null);
});

test('normal curl and press sets never suggest a change; a wave stays arm_swing', () => {
  for (const m of ['curl', 'shoulder_press']) {
    assert.equal(replay(m, simulateSet(m, { reps: 20, repMs: 1800, slowdown: 0.6, seed: 11 }).frames).suggested, null);
  }
  const wave = replay('curl', simulateWave().frames);
  assert.ok(wave.frames.some((f) => f.issue === 'arm_swing'));
  assert.ok(!wave.frames.some((f) => f.issue === 'exercise_change'));
  assert.equal(wave.suggested, null);
});

test('real press clip shows no exercise change', async () => {
  const { readFileSync } = await import('node:fs');
  const clip = JSON.parse(readFileSync(new URL('../fixtures/fs_press_rear.landmarks.json', import.meta.url), 'utf8'));
  const frames = clip.frames.map(({ t, pose }) => ({ t, pose: pose && pose.map(([x, y, visibility]) => ({ x, y, visibility })) }));
  const out = replay('shoulder_press', frames);
  assert.ok(!out.frames.some((f) => f.issue === 'exercise_change'));
  assert.equal(out.suggested, null);
});
