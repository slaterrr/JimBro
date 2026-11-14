// Push-up counting and rep-type classification on simulated side-view landmarks.
// SIMULATED poses (tools/vision-lab/lib/simulate.mjs) test the logic, not real MediaPipe accuracy.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pushupBody, simulatePushups, simulateUprightElbowBends, body } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { pushupShape } from './angles.js';
import { EXERCISES } from './exercises.js';
import { LiveSession } from './live.js';
import { MOVEMENTS } from './reps.js';

const run = (movement, frames) => {
  const s = new LiveSession(movement);
  const out = frames.map((f) => s.frame(f.t, f.pose));
  return { s, out };
};

test('push-up is a camera-tracked exercise with an elbow-angle counter', () => {
  assert.ok(EXERCISES.some((e) => e.id === 'push_up' && e.camera));
  assert.ok(MOVEMENTS.push_up);
});

test('pushupShape: horizontal body with straight legs is a standard push-up (top and bottom)', () => {
  for (const elbow of [170, 80]) assert.deepEqual(pushupShape(pushupBody({ elbow }), 'left').variant, 'standard');
  assert.equal(pushupShape(pushupBody({ elbow: 80 }), 'left').shape, 'pushup');
});

test('pushupShape: knees on the floor is a knee push-up, shins raised or flat', () => {
  for (const shinDeg of [0, 35, 60]) {
    for (const elbow of [170, 80]) {
      const s = pushupShape(pushupBody({ elbow, variant: 'knee', shinDeg }), 'left');
      assert.equal(s.shape, 'pushup');
      assert.equal(s.variant, 'knee', `shin ${shinDeg}°, elbow ${elbow}°`);
    }
  }
});

test('pushupShape: hands raised on a bench is an incline push-up', () => {
  assert.equal(pushupShape(pushupBody({ elbow: 120, variant: 'incline' }), 'left').variant, 'incline');
});

test('pushupShape: standing or kneeling tall is upright, not a push-up', () => {
  assert.equal(pushupShape(body({ upperArm: 90, elbow: 90 }), 'left').shape, 'upright');
  const kneel = simulateUprightElbowBends({ kneeling: true }).frames[40].pose;
  assert.equal(pushupShape(kneel, 'left').shape, 'upright');
});

test('standard push-ups are counted and every rep is labelled standard', () => {
  const { frames, trueEnds } = simulatePushups({ reps: 10, seed: 3 });
  const { s } = run('push_up', frames);
  assert.equal(s.count, trueEnds.length);
  assert.deepEqual(s.repsDetail().map((r) => r.variant), Array(10).fill('standard'));
});

test('knee push-ups (the reported bug) are counted as KNEE push-ups, not standard', () => {
  const { frames } = simulatePushups({ reps: 8, variant: 'knee', seed: 4 });
  const { s } = run('push_up', frames);
  assert.equal(s.count, 8);
  assert.deepEqual(s.repsDetail().map((r) => r.variant), Array(8).fill('knee'));
});

test('elbow bends while upright (standing or kneeling tall) are not counted as push-ups', () => {
  for (const kneeling of [false, true]) {
    const { s, out } = run('push_up', simulateUprightElbowBends({ kneeling }).frames);
    assert.equal(s.count, 0, kneeling ? 'kneeling' : 'standing');
    assert.ok(out.some((o) => o.issue === 'exercise_change'));
  }
});

test('push-ups in curl or squat mode are not counted there and push-up is suggested', () => {
  for (const mode of ['curl', 'squat', 'shoulder_press']) {
    const { s, out } = run(mode, simulatePushups({ reps: 6, seed: 5 }).frames);
    assert.equal(s.count, 0, mode);
    assert.ok(out.some((o) => o.issue === 'exercise_change' && o.hint === 'push_up'), mode);
    assert.equal(s.suggested, 'push_up', mode);
  }
});

test('each rep carries its range of motion in degrees', () => {
  const { s } = run('push_up', simulatePushups({ reps: 4, seed: 6 }).frames);
  for (const r of s.repsDetail()) assert.ok(r.rom_deg > 60 && r.rom_deg < 100, `rom ${r.rom_deg}`);
});
