import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LiveSession } from './live.js';
import { sessionReport, setReport } from './sessionReport.js';

const rep = (index, total) => ({ index, concentric_ms: total * 0.4, peak_pause_ms: total * 0.1, eccentric_ms: total * 0.5 });

test('setReport lists counted reps with per-rep duration and tracking reliability', () => {
  const r = setReport({ movement: 'curl', reps: [rep(1, 2000), rep(2, 2200)], quality: { frames: 100, okFrames: 90, issues: {}, partials: 0 } });
  assert.equal(r.counted, 2);
  assert.deepEqual(r.repDurationsMs, [2000, 2200]);
  assert.equal(r.trackingPct, 90);
});

test('tempo change is only reported with enough reps (>= 6) to compare first and last three', () => {
  const few = setReport({ movement: 'curl', reps: [1, 2, 3, 4].map((i) => rep(i, 2000)), quality: null });
  assert.equal(few.tempo, null);
  const many = setReport({ movement: 'curl', reps: [2000, 2000, 2000, 2200, 2600, 3000].map((d, i) => rep(i + 1, d)), quality: null });
  assert.equal(many.tempo.firstMs, 2000);
  assert.equal(many.tempo.lastMs, 2600);
  assert.equal(many.tempo.changePct, 30);
});

test('suggestions are tied to measured evidence and never invent effort', () => {
  const poor = setReport({ movement: 'curl', reps: [rep(1, 2000)], quality: { frames: 100, okFrames: 60, issues: { tracking: 4, arm_swing: 3 }, partials: 2 } });
  const ids = poor.suggestions.map((s) => s.id);
  assert.deepEqual(ids.sort(), ['camera', 'elbow', 'range']);
  for (const s of poor.suggestions) assert.match(s.evidence, /\d/);
  const clean = setReport({ movement: 'curl', reps: [rep(1, 2000)], quality: { frames: 100, okFrames: 100, issues: {}, partials: 0 } });
  assert.deepEqual(clean.suggestions, []);
});

test('load suggestion appears only when the user entered RPE and hit the target', () => {
  const base = { movement: 'squat', reps: Array.from({ length: 10 }, (_, i) => rep(i + 1, 2500)), quality: null, target: 10 };
  assert.ok(!setReport(base).suggestions.some((s) => s.id === 'load'));
  assert.ok(setReport({ ...base, rpe: 6 }).suggestions.some((s) => s.id === 'load'));
  assert.ok(!setReport({ ...base, rpe: 9 }).suggestions.some((s) => s.id === 'load'));
});

test('sessionReport summarizes only camera sets of a workout', () => {
  const w = { sets: [
    { exercise: 'curl', reps: 2, rpe: null, source: 'camera', reps_detail: [rep(1, 2000), rep(2, 2000)], camera_quality: { frames: 50, okFrames: 50, issues: {}, partials: 1 } },
    { exercise: 'bench', reps: 5, source: 'manual', reps_detail: [] },
  ] };
  const r = sessionReport(w);
  assert.equal(r.sets.length, 1);
  assert.equal(r.totals.counted, 2);
  assert.equal(r.totals.partials, 1);
});

test('LiveSession.quality counts frames, OK frames and issue episodes (not issue frames)', () => {
  const s = new LiveSession('curl');
  for (let i = 0; i < 5; i++) s.frame(i * 50, null);
  const q = s.quality();
  assert.equal(q.frames, 5);
  assert.equal(q.okFrames, 0);
  assert.equal(q.issues.tracking, 1);
});
