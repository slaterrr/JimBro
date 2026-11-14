// Camera pipeline on the phone: landmarks (from the WebView pose model) -> joint angle ->
// RepCounter. Synthetic landmark frames stand in for the camera.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessTracking, jointAngle, movementAngle } from './angles.js';
import { LiveSession } from './live.js';

const P = (x, y, visibility = 0.9) => ({ x, y, visibility });

/** 33-landmark pose with the right arm bent to `deg` at the elbow (left arm hidden). */
function armPose(deg, visibility = 0.9) {
  const pose = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
  const rad = (deg * Math.PI) / 180;
  pose[12] = P(0.5, 0.2, visibility); // shoulder (above elbow)
  pose[14] = P(0.5, 0.5, visibility); // elbow
  pose[16] = P(0.5 + 0.3 * Math.sin(rad), 0.5 - 0.3 * Math.cos(rad), visibility); // wrist
  return pose;
}

describe('angles (port of apps/mobile pose/angles.ts)', () => {
  it('computes joint angles and rejects degenerate input', () => {
    assert.ok(Math.abs(jointAngle(P(1, 0), P(0, 0), P(0, 1)) - 90) < 1e-9);
    assert.equal(jointAngle(P(0, 0), P(0, 0), P(1, 1)), null);
    assert.equal(jointAngle(P(NaN, 0), P(0, 0), P(1, 1)), null);
  });
  it('reads the elbow angle from the better-tracked arm', () => {
    for (const deg of [40, 90, 170]) {
      const m = movementAngle(armPose(deg), 'curl');
      assert.ok(Math.abs(m.angle - deg) < 1e-6, `${deg} -> ${m.angle}`);
      assert.equal(m.confidence, 0.9);
    }
  });
  it('reads the knee for squats', () => {
    const pose = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
    pose[23] = P(0.4, 0.4); pose[25] = P(0.4, 0.6); pose[27] = P(0.4, 0.8);
    assert.ok(Math.abs(movementAngle(pose, 'squat').angle - 180) < 1e-6);
  });
  it('assesses tracking as ok / low / lost', () => {
    assert.equal(assessTracking(armPose(90)).status, 'ok');
    assert.equal(assessTracking(armPose(90, 0.3)).status, 'low');
    assert.equal(assessTracking(null).status, 'lost');
    assert.equal(assessTracking([]).status, 'lost');
  });
});

describe('LiveSession', () => {
  const curlFrames = (n) => {
    const angles = [];
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 12; i++) angles.push(170);
      for (let a = 170; a >= 40; a -= 10) angles.push(a);
      for (let i = 0; i < 6; i++) angles.push(40);
      for (let a = 40; a <= 170; a += 8) angles.push(a);
    }
    for (let i = 0; i < 12; i++) angles.push(170);
    return angles.map((deg, i) => ({ t: (i + 1) * 33, pose: armPose(deg) }));
  };

  it('counts reps from landmark frames and returns reps_detail for the set', () => {
    const s = new LiveSession('curl');
    let reps = 0;
    for (const f of curlFrames(3)) if (s.frame(f.t, f.pose).rep) reps += 1;
    assert.equal(reps, 3);
    assert.equal(s.count, 3);
    const detail = s.repsDetail();
    assert.deepEqual(detail.map((r) => r.index), [1, 2, 3]);
    assert.ok(detail.every((r) => r.concentric_ms > 0 && r.eccentric_ms > 0 && !('tut_ms' in r)));
  });
  it('reports tracking loss without counting', () => {
    const s = new LiveSession('curl');
    const out = s.frame(33, null);
    assert.equal(out.tracking.status, 'lost');
    assert.equal(s.count, 0);
  });
  it('resets and switches movement', () => {
    const s = new LiveSession('curl');
    for (const f of curlFrames(1)) s.frame(f.t, f.pose);
    s.reset();
    assert.deepEqual([s.count, s.repsDetail().length], [0, 0]);
    assert.throws(() => new LiveSession('bench'), /camera counting/);
  });
});
