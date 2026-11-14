import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateEffort } from './effort.js';

// Curl: the lifting phase is the counter's concentric (rest → peak).
const curl = (lift, rom = 120) => ({ concentric_ms: lift, peak_pause_ms: 200, eccentric_ms: 1200, rom_deg: rom });

test('no estimate from a single rep', () => {
  const e = estimateEffort({ movement: 'curl', reps: [curl(800)] });
  assert.equal(e.rpe, null);
  assert.equal(e.rir, null);
  assert.equal(e.confidence, 'low');
  assert.equal(e.estimate, true);
});

test('two reps give an estimate with low confidence', () => {
  const e = estimateEffort({ movement: 'curl', reps: [curl(800), curl(800)] });
  assert.equal(e.confidence, 'low');
  assert.equal(e.rpe, 6);
});

test('steady rep speed reads as easy (about 4+ reps in reserve)', () => {
  const e = estimateEffort({ movement: 'curl', reps: Array(8).fill(0).map(() => curl(800)) });
  assert.equal(e.velocityLossPct, 0);
  assert.deepEqual({ rpe: e.rpe, rir: e.rir, confidence: e.confidence }, { rpe: 6, rir: 4, confidence: 'medium' });
});

test('about 20% velocity loss reads as RPE 8 (2 in reserve)', () => {
  // last two reps take 1000 ms vs 800 ms: velocity 0.8 of the first → 20% loss
  const e = estimateEffort({ movement: 'curl', reps: [800, 800, 850, 900, 950, 1000, 1000].map((d) => curl(d)) });
  assert.equal(e.velocityLossPct, 20);
  assert.deepEqual({ rpe: e.rpe, rir: e.rir }, { rpe: 8, rir: 2 });
  assert.ok(e.evidence.some((x) => /20%/.test(x)));
});

test('40%+ velocity loss reads as at or near failure (RPE 10)', () => {
  const e = estimateEffort({ movement: 'curl', reps: [600, 600, 800, 1000, 1200].map((d) => curl(d)) });
  assert.ok(e.velocityLossPct >= 40);
  assert.deepEqual({ rpe: e.rpe, rir: e.rir }, { rpe: 10, rir: 0 });
});

test('shrinking range of motion counts as effort even when speed holds', () => {
  const same = estimateEffort({ movement: 'curl', reps: [120, 120, 120, 120, 120, 120].map((r) => curl(800, r)) });
  const shrink = estimateEffort({ movement: 'curl', reps: [120, 120, 115, 110, 100, 100].map((r) => curl(800 * r / 120, r)) });
  assert.equal(shrink.velocityLossPct, 0); // shorter path in shorter time: same speed
  assert.ok(shrink.romLossPct >= 15);
  assert.ok(shrink.rpe > same.rpe);
  assert.ok(shrink.evidence.some((x) => /range/i.test(x)));
});

test('squats and push-ups use the push/stand-up phase (counter eccentric) as the lifting phase', () => {
  const rep = (up) => ({ concentric_ms: 900, peak_pause_ms: 100, eccentric_ms: up, rom_deg: 80 });
  const e = estimateEffort({ movement: 'push_up', reps: [800, 800, 900, 1000, 1000].map(rep) });
  assert.equal(e.velocityLossPct, 20);
  const lowerSlower = estimateEffort({ movement: 'push_up', reps: [800, 1200, 1600].map((d) => ({ ...rep(800), concentric_ms: d })) });
  assert.equal(lowerSlower.velocityLossPct, 0);
});

test('evidence always says it is an estimate', () => {
  const e = estimateEffort({ movement: 'curl', reps: Array(5).fill(0).map(() => curl(800)) });
  assert.ok(e.evidence.some((x) => /estimate/i.test(x)));
});
