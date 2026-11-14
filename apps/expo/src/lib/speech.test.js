// Jim reads the set report aloud: short, and only numbers that are in the report.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setReport } from './sessionReport.js';
import { spokenReport } from './speech.js';

const rep = (ms) => ({ concentric_ms: ms / 2, peak_pause_ms: 0, eccentric_ms: ms / 2 });
const words = (s) => s.trim().split(/\s+/).length;
const numbers = (s) => (s.match(/\d+/g) ?? []).map(Number);

describe('spokenReport', () => {
  it('says count, uncounted movements and tempo change', () => {
    const reps = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1200, 1200, 1200].map(rep);
    const report = setReport({ movement: 'curl', reps, target: 12, quality: { frames: 100, okFrames: 95, issues: { arm_swing: 2 }, partials: 0 } });
    const s = spokenReport(report);
    assert.equal(s, "10 of 12 curls. 2 weren't counted: arm swing. Your last reps were 20% slower — keep this weight.");
    assert.ok(words(s) < 25);
  });
  it('handles a clean set without a target', () => {
    const report = setReport({ movement: 'squat', reps: [rep(2000), rep(2000)] });
    assert.equal(spokenReport(report), '2 squats. Every rep counted.');
  });
  it('uses a generic noun for other movements', () => {
    const report = setReport({ movement: 'shoulder_press', reps: [rep(1500)], target: 8 });
    assert.equal(spokenReport(report), '1 of 8 reps. Every rep counted.');
  });
  it('only speaks numbers present in the report and never claims fatigue or effort', () => {
    const reps = [900, 900, 900, 1000, 1300, 1400, 1500].map(rep);
    const report = setReport({ movement: 'curl', reps, target: 10, rpe: 9, quality: { frames: 50, okFrames: 30, issues: { framing: 3, tracking: 1 }, partials: 1 } });
    const s = spokenReport(report, 'hype');
    const allowed = new Set([report.counted, report.target, report.rpe, report.partials, report.trackingPct, report.tempo.changePct,
      ...Object.values(report.issues), Object.values(report.issues).reduce((a, b) => a + b, 0)]);
    for (const n of numbers(s)) assert.ok(allowed.has(n), `${n} not in report: ${s}`);
    assert.doesNotMatch(s, /tired|fatigue|effort|cheat/i);
    assert.ok(words(s) < 25, s);
  });
  it('mentions faster reps without advice', () => {
    const reps = [1500, 1500, 1500, 1000, 1000, 1000].map(rep);
    const s = spokenReport(setReport({ movement: 'curl', reps }));
    assert.match(s, /33% faster\.$/);
  });
  it('returns an empty string without a report', () => {
    assert.equal(spokenReport(null), '');
  });
});
