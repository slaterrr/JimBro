// Push-up sweeps on SIMULATED landmarks (seeds × noise). These test the counter and the rep-type
// classifier; they say nothing about real MediaPipe accuracy on push-ups (no real clip yet).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LiveSession } from '../../../apps/expo/src/lib/live.js';
import { replay, scoreClip } from '../lib/evaluate.mjs';
import { simulatePushups, simulateSet, simulateUprightElbowBends } from '../lib/simulate.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 100 + i);
const NOISES = [0.003, 0.006];

function variants(frames) {
  const s = new LiveSession('push_up');
  for (const f of frames) s.frame(f.t, f.pose);
  return s.repsDetail().map((r) => r.variant);
}

for (const variant of ['standard', 'knee', 'incline']) {
  test(`push-up sweep (${variant}): counted exactly and labelled ${variant}`, () => {
    let tp = 0; let fp = 0; let fn = 0; let labelled = 0; let wrong = 0;
    for (const noise of NOISES) {
      for (const seed of SEEDS) {
        const { frames, trueEnds } = simulatePushups({ reps: 12, variant, noise, seed, slowdown: 0.5 });
        const s = scoreClip({ trueEnds, predEnds: replay('push_up', frames).predEnds });
        tp += s.tp; fp += s.fp; fn += s.fn;
        for (const v of variants(frames)) (v === variant ? labelled++ : wrong++);
      }
    }
    const total = SEEDS.length * NOISES.length * 12;
    console.log(`[sim] push-up ${variant}: tp ${tp}/${total}, fp ${fp}, fn ${fn}; labelled ${variant} ${labelled}, other label ${wrong}`);
    assert.deepEqual({ tp, fp, fn, wrong }, { tp: total, fp: 0, fn: 0, wrong: 0 });
  });
}

test('knee push-ups with flat shins (feet on the floor) are still labelled knee', () => {
  const { frames } = simulatePushups({ reps: 8, variant: 'knee', shinDeg: 0, seed: 9 });
  assert.deepEqual(variants(frames), Array(8).fill('knee'));
});

test('half push-ups are not counted', () => {
  const { frames } = simulatePushups({ reps: 8, rom: 0.4, seed: 10 });
  assert.equal(replay('push_up', frames).predEnds.length, 0);
});

test('adversarial sweep: elbow bends while standing or kneeling tall are never push-ups', () => {
  let fp = 0; let sets = 0;
  for (const kneeling of [false, true]) {
    for (const noise of NOISES) {
      for (const seed of SEEDS) {
        fp += replay('push_up', simulateUprightElbowBends({ kneeling, noise, seed }).frames).predEnds.length;
        sets += 1;
      }
    }
  }
  console.log(`[sim] upright elbow bends in push-up mode: ${fp} false push-ups over ${sets} sets × 8 bends`);
  assert.equal(fp, 0);
});

test('other lifts in push-up mode are not counted', () => {
  for (const lift of ['curl', 'squat', 'shoulder_press']) {
    assert.equal(replay('push_up', simulateSet(lift, { reps: 6, seed: 12 }).frames).predEnds.length, 0, lift);
  }
});

test('push-ups in other modes: none counted, push-up suggested (sweep)', () => {
  const tally = {};
  for (const mode of ['curl', 'squat', 'shoulder_press']) {
    let counted = 0; let suggested = 0;
    for (const variant of ['standard', 'knee']) {
      for (const seed of SEEDS) {
        const out = replay(mode, simulatePushups({ reps: 6, variant, seed }).frames);
        counted += out.predEnds.length;
        if (out.suggested === 'push_up') suggested += 1;
      }
    }
    tally[mode] = { counted, suggested };
  }
  console.log(`[sim] push-ups in other modes (40 sets each): ${JSON.stringify(tally)}`);
  for (const m of Object.keys(tally)) assert.deepEqual(tally[m], { counted: 0, suggested: 40 }, m);
});

test('normal curl / squat / press sets never suggest push-ups', () => {
  for (const m of ['curl', 'squat', 'shoulder_press']) {
    for (const view of ['side', 'front']) {
      const out = replay(m, simulateSet(m, { reps: 10, view, seed: 13 }).frames);
      assert.notEqual(out.suggested, 'push_up', `${m} ${view}`);
      assert.ok(!out.frames.some((f) => f.hint === 'push_up'), `${m} ${view}`);
    }
  }
});
