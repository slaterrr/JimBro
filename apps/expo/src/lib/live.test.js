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
  pose[24] = P(0.5, 0.8, visibility); // ipsilateral hip makes this a torso-visible curl
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
  it('never counts an arm-only hallucinated pose when the torso is missing', () => {
    const session = new LiveSession('curl');
    for (const frame of curlFrames(1)) {
      frame.pose[24].visibility = 0.1;
      session.frame(frame.t, frame.pose);
    }
    assert.equal(session.count, 0);
  });

  it('does not switch to an independently moving arm mid-set', () => {
    const session = new LiveSession('curl');
    session.frame(1, armPose(170)); // lock right arm first
    for (const f of curlFrames(1)) {
      const rightStill = armPose(170, 0.75);
      rightStill[11] = P(0.4, 0.2, 0.99);
      rightStill[13] = P(0.4, 0.5, 0.99);
      rightStill[15] = P(0.4 + f.pose[16].x - 0.5, f.pose[16].y, 0.99);
      rightStill[23] = P(0.4, 0.8, 0.99);
      session.frame(f.t + 1, rightStill);
    }
    assert.equal(session.count, 0);
  });

  it('abandons an unfinished rep immediately when pose tracking is lost', () => {
    const frames = curlFrames(1);
    const session = new LiveSession('curl');
    for (const f of frames.slice(0, 25)) session.frame(f.t, f.pose);
    session.frame(frames[24].t + 1, null);
    for (const f of frames.slice(25)) session.frame(f.t, f.pose);
    assert.equal(session.count, 0);
  });

  it('does not treat a large upper-arm swing as a curl', () => {
    const session = new LiveSession('curl');
    const theta = Math.PI / 3;
    const swing = (deg) => {
      const pose = armPose(deg);
      const wrist = { x: pose[16].x - 0.5, y: pose[16].y - 0.5 };
      const rotate = (p) => ({
        x: p.x * Math.cos(theta) + p.y * Math.sin(theta),
        y: -p.x * Math.sin(theta) + p.y * Math.cos(theta),
      });
      const elbow = rotate({ x: 0, y: 0.3 });
      const rotatedWrist = rotate(wrist);
      pose[14] = P(0.5 + elbow.x, 0.2 + elbow.y);
      pose[16] = P(pose[14].x + rotatedWrist.x, pose[14].y + rotatedWrist.y);
      return pose;
    };
    for (const f of curlFrames(1)) {
      const angle = movementAngle(f.pose, 'curl').angle;
      session.frame(f.t, swing(angle));
    }
    assert.equal(session.count, 0);
  });

  it('uses leg and hip visibility for squat tracking, not arm visibility', () => {
    const pose = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
    pose[23] = P(0.5, 0.4);
    pose[25] = P(0.5, 0.6);
    pose[27] = P(0.5, 0.8);
    pose[11] = P(0.5, 0.2);
    const s = new LiveSession('squat');
    assert.equal(s.frame(33, pose).tracking.status, 'ok');
  });

  it('keeps completed reps when later tracking is lost', () => {
    const s = new LiveSession('curl');
    for (const f of curlFrames(1)) s.frame(f.t, f.pose);
    assert.equal(s.count, 1);
    const out = s.frame(99999, null);
    assert.equal(out.count, 1);
    assert.equal(out.issue, 'tracking');
    assert.equal(s.repsDetail().length, 1);
  });

  describe('blocked movements ("caught it")', () => {
    const swung = (deg) => {
      const pose = armPose(deg);
      pose[14] = P(0.5 + 0.3 * Math.sin(Math.PI / 3), 0.2 + 0.3 * Math.cos(Math.PI / 3)); // elbow swung 60° forward
      pose[16] = P(pose[14].x, pose[14].y + 0.3);
      return pose;
    };

    it('emits blocked when an in-progress rep is aborted by an issue', () => {
      const frames = curlFrames(1);
      const s = new LiveSession('curl');
      for (const f of frames.slice(0, 25)) assert.equal(s.frame(f.t, f.pose).blocked, null);
      assert.notEqual(s.counter.state, 'rest');
      const out = s.frame(frames[24].t + 10, null);
      assert.deepEqual(out.blocked, { reason: 'tracking', t: frames[24].t + 10 });
      assert.deepEqual(s.blocked, [{ reason: 'tracking', t: frames[24].t + 10 }]);
      // Continued trouble on the same aborted rep is not reported again.
      assert.equal(s.frame(frames[24].t + 20, null).blocked, null);
      assert.equal(s.blocked.length, 1);
    });

    it('names the reason, e.g. arm swing mid-rep', () => {
      const frames = curlFrames(1);
      const s = new LiveSession('curl');
      for (const f of frames.slice(0, 25)) s.frame(f.t, f.pose);
      const out = s.frame(frames[25].t, swung(90));
      assert.equal(out.issue, 'arm_swing');
      assert.equal(out.blocked.reason, 'arm_swing');
      assert.equal(s.count, 0);
    });

    it('does not emit for issues during idle rest', () => {
      const s = new LiveSession('curl');
      assert.equal(s.frame(10, null).blocked, null);
      for (let i = 1; i <= 15; i++) s.frame(10 + i * 33, armPose(170));
      assert.equal(s.counter.state, 'rest');
      assert.equal(s.frame(600, null).blocked, null);
      assert.equal(s.frame(700, swung(170)).blocked, null);
      assert.deepEqual(s.blocked, []);
    });

    it('does not emit for clean reps and resets with the set', () => {
      const s = new LiveSession('curl');
      for (const f of curlFrames(2)) assert.equal(s.frame(f.t, f.pose).blocked, null);
      assert.equal(s.count, 2);
      const frames = curlFrames(1);
      const s2 = new LiveSession('curl');
      for (const f of frames.slice(0, 25)) s2.frame(f.t, f.pose);
      s2.frame(frames[24].t + 10, null);
      s2.reset();
      assert.deepEqual(s2.blocked, []);
    });
  });

  it('resets and switches movement', () => {
    const s = new LiveSession('curl');
    for (const f of curlFrames(1)) s.frame(f.t, f.pose);
    s.reset();
    assert.deepEqual([s.count, s.repsDetail().length], [0, 0]);
    assert.throws(() => new LiveSession('bench'), /camera counting/);
  });
});

describe('pose page', () => {
  it('pins MediaPipe and only ever posts landmarks, never images', async () => {
    const { poseHtml, MEDIAPIPE_VERSION } = await import('./poseHtml.js');
    const html = poseHtml();
    assert.match(html, new RegExp(`tasks-vision@${MEDIAPIPE_VERSION}/`));
    assert.doesNotMatch(html, /toDataURL|toBlob|fetch\(|XMLHttpRequest|MediaRecorder/);
    assert.match(html, /type: 'frame', t: Math\.round\(now\), pose/);
  });
});
