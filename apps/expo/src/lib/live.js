// One camera set: landmark frames in, live count and per-rep timing out.
// Quality gates prevent missing joints or camera side swaps from completing fake reps.
import { ARM, assessTracking, curlUpperArmSwing, LEG, movementAngle } from './angles.js';
import { MOVEMENTS, RepCounter } from './reps.js';

const MAX_CURL_SWING_DEG = 50; // conservative initial heuristic; validate on real videos
// Hypothesis under test: real joints move < ~3 torso lengths/s even on fast reps; a landmark
// that jumps faster than this was re-placed by the model, not moved by the body.
const MAX_JOINT_SPEED_TORSO_PER_S = 6;
const MAX_SPEED_GAP_MS = 300;
// Hypothesis under test: MediaPipe extrapolates hips that are off-screen with passing
// visibility (waist-up framing). Torso anchors must lie inside the frame, with a margin.
const FRAME_MARGIN = 0.05;

/** True when the locked side's shoulder and hip are inside the image (normalized coords). */
export function torsoInFrame(pose, side) {
  return [side === 'left' ? 11 : 12, side === 'left' ? 23 : 24].every((i) => {
    const p = pose[i];
    return p.x >= FRAME_MARGIN && p.x <= 1 - FRAME_MARGIN && p.y >= FRAME_MARGIN && p.y <= 1 - FRAME_MARGIN;
  });
}

/** Fastest tracked joint between two frames, in torso lengths per second. */
export function jointSpeed(prev, pose, t, movement, side) {
  if (!prev || t - prev.t <= 0 || t - prev.t > MAX_SPEED_GAP_MS) return 0;
  const idx = (movement === 'squat' ? LEG : ARM)[side];
  const sh = pose[side === 'left' ? 11 : 12];
  const hip = pose[side === 'left' ? 23 : 24];
  const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if (!(torso > 0.01)) return Infinity;
  const dist = Math.max(...idx.map((i) => Math.hypot(pose[i].x - prev.pose[i].x, pose[i].y - prev.pose[i].y)));
  return dist / torso / ((t - prev.t) / 1000);
}

export class LiveSession {
  constructor(movement) {
    if (!MOVEMENTS[movement]) throw new Error(`no camera counting for ${movement}`);
    this.movement = movement;
    this.counter = new RepCounter(MOVEMENTS[movement]);
    this.reps = [];
    this.side = null;
  }

  get count() {
    return this.counter.count;
  }

  result(rep, tracking, angle = null, issue = null) {
    const q = (this._q ??= { frames: 0, okFrames: 0, issues: {}, last: null });
    q.frames += 1;
    if (!issue) q.okFrames += 1;
    if (issue && issue !== q.last) q.issues[issue] = (q.issues[issue] ?? 0) + 1;
    q.last = issue;
    return {
      rep, tracking, angle, issue, state: this.counter.state,
      count: this.counter.count, partials: this.counter.partials,
    };
  }

  /** Feed one frame ({t ms, pose: 33 landmarks or null}); returns the UI snapshot. */
  frame(t, pose) {
    const tracking = assessTracking(pose, 0.5, this.movement, this.side);
    if (tracking.status !== 'ok') {
      this._prev = null;
      this.counter.interrupt();
      return this.result(null, tracking, null, 'tracking');
    }
    if (this.side === null) this.side = tracking.side;
    const m = movementAngle(pose, this.movement, this.side);
    if (!m) {
      this.counter.interrupt();
      return this.result(null, tracking, null, 'tracking');
    }
    if (!torsoInFrame(pose, this.side)) {
      this._prev = null;
      this.counter.interrupt();
      return this.result(null, tracking, m.angle, 'framing');
    }
    const speed = jointSpeed(this._prev, pose, t, this.movement, this.side);
    this._prev = { t, pose };
    if (speed > MAX_JOINT_SPEED_TORSO_PER_S) {
      this.counter.interrupt();
      return this.result(null, tracking, m.angle, 'implausible_motion');
    }
    if (this.movement === 'curl') {
      const swing = curlUpperArmSwing(pose, this.side);
      if (!Number.isFinite(swing) || swing > MAX_CURL_SWING_DEG) {
        this.counter.interrupt();
        return this.result(null, tracking, m.angle, 'arm_swing');
      }
    }
    const rep = this.counter.update({ t_ms: t, angle_deg: m.angle, confidence: m.confidence });
    if (rep) this.reps.push(rep);
    return this.result(rep, tracking, m.angle);
  }

  /** Set-level evidence for the report: frames, usable frames, issue episodes, partial reps. */
  quality() {
    const q = this._q ?? { frames: 0, okFrames: 0, issues: {} };
    return { frames: q.frames, okFrames: q.okFrames, issues: { ...q.issues }, partials: this.counter.partials };
  }

  /** Changing the physical camera may mirror sides; preserve completed reps. */
  reacquireTracking() {
    this.counter.interrupt();
    this._prev = null;
    this.side = null;
  }

  reset() {
    this.counter.reset();
    this.reps = [];
    this.side = null;
    this._q = null;
    this._prev = null;
  }

  /** Reps in the shape a logged set stores. */
  repsDetail() {
    return this.reps.map(({ index, concentric_ms, peak_pause_ms, eccentric_ms }) => ({
      index, concentric_ms, peak_pause_ms, eccentric_ms,
    }));
  }
}
