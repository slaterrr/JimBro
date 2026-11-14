import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchReps, replay, scoreClip, summarize } from '../lib/evaluate.mjs';

test('matchReps pairs each true rep with at most one prediction inside the tolerance', () => {
  const m = matchReps([1000, 2000, 3000], [1100, 2900, 5000], 400);
  assert.deepEqual(m.matched, [[1000, 1100], [3000, 2900]]);
  assert.deepEqual(m.missed, [2000]);
  assert.deepEqual(m.false, [5000]);
});

test('a double count near one true rep is a false positive, not two hits', () => {
  const m = matchReps([1000], [900, 1100], 400);
  assert.equal(m.matched.length, 1);
  assert.equal(m.false.length, 1);
});

test('scoreClip computes precision/recall; an adversarial clip with 0 true reps has recall null', () => {
  const s = scoreClip({ trueEnds: [1000, 2000], predEnds: [1000, 2000, 2600] });
  assert.equal(s.tp, 2); assert.equal(s.fp, 1); assert.equal(s.fn, 0);
  assert.equal(s.precision, 2 / 3); assert.equal(s.recall, 1);
  const adv = scoreClip({ trueEnds: [], predEnds: [500] });
  assert.equal(adv.recall, null); assert.equal(adv.fp, 1);
});

test('summarize pools counts across clips (micro-average) per split', () => {
  const rows = [
    { split: 'dev', tp: 4, fp: 1, fn: 0, adversarial: false },
    { split: 'dev', tp: 0, fp: 2, fn: 0, adversarial: true },
    { split: 'heldout', tp: 3, fp: 0, fn: 1, adversarial: false },
  ];
  const s = summarize(rows);
  assert.equal(s.dev.precision, 4 / 7);
  assert.equal(s.dev.recall, 1);
  assert.equal(s.dev.adversarialFalseReps, 2);
  assert.equal(s.heldout.recall, 3 / 4);
});

test('replay runs landmark frames through the production LiveSession and records rep end times and issues', () => {
  // Synthetic elbow trace: 2 full curls, built as 33-landmark poses (left arm only visible).
  const frames = [];
  const curl = (deg) => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
    const sh = { x: 0.5, y: 0.3, visibility: 0.99 };
    const el = { x: 0.5, y: 0.5, visibility: 0.99 };
    const r = (deg * Math.PI) / 180; // angle at elbow between shoulder (up) and wrist
    const wr = { x: 0.5 + 0.2 * Math.sin(r), y: 0.5 - 0.2 * Math.cos(r), visibility: 0.99 };
    pose[11] = sh; pose[13] = el; pose[15] = wr; pose[23] = { x: 0.5, y: 0.8, visibility: 0.99 };
    return pose;
  };
  let t = 0;
  for (let rep = 0; rep < 2; rep++) {
    for (let i = 0; i <= 20; i++) frames.push({ t: (t += 50), pose: curl(170 - (120 * i) / 20) });
    for (let i = 0; i <= 20; i++) frames.push({ t: (t += 50), pose: curl(50 + (120 * i) / 20) });
  }
  const out = replay('curl', frames);
  assert.equal(out.predEnds.length, 2);
  assert.ok(out.frames.every((f) => 'issue' in f && 'count' in f));
  assert.equal(out.trackingOkRatio, 1);
});
