// Camera performance readout: measured by the pose page on the device it runs on.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPoseMessage } from './poseBridge.js';
import { poseHtml } from './poseHtml.js';
import { perfLabel, PerfTracker } from './cameraPerf.js';

describe('pose page reports its own speed', () => {
  it('times inference and posts a perf message with numbers only', () => {
    const html = poseHtml();
    assert.match(html, /type: 'perf'/);
    assert.match(html, /inferenceMs/);
    assert.match(html, /p95Ms/);
    assert.doesNotMatch(html, /userAgent/); // no device fingerprinting
    assert.equal(isPoseMessage(JSON.stringify({ type: 'perf', fps: 19.5, inferenceMs: 21 })), true);
  });
});

describe('PerfTracker', () => {
  it('keeps the latest window and summarizes a session', () => {
    const p = new PerfTracker({ targetFps: 20 });
    p.add({ fps: 19, inferenceMs: 20, p95Ms: 30, droppedPct: 5 });
    p.add({ fps: 15, inferenceMs: 40, p95Ms: 70, droppedPct: 25 });
    assert.equal(p.latest.fps, 15);
    const s = p.summary();
    assert.equal(s.windows, 2);
    assert.equal(s.meanFps, 17);
    assert.equal(s.worstP95Ms, 70);
    assert.equal(s.measuredOn, 'this device');
  });

  it('label is short and says nothing when there is no measurement', () => {
    assert.equal(perfLabel(null), null);
    assert.equal(perfLabel({ fps: 19.46, inferenceMs: 21.2 }), '19 fps · 21 ms');
  });
});
