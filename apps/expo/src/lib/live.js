// One camera set: landmark frames in, live count and per-rep timing out.
// Quality gates prevent missing joints or camera side swaps from completing fake reps.
import { assessTracking, curlUpperArmSwing, movementAngle } from './angles.js';
import { MOVEMENTS, RepCounter } from './reps.js';

const MAX_CURL_SWING_DEG = 50; // conservative initial heuristic; validate on real videos

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
    return {
      rep, tracking, angle, issue, state: this.counter.state,
      count: this.counter.count, partials: this.counter.partials,
    };
  }

  /** Feed one frame ({t ms, pose: 33 landmarks or null}); returns the UI snapshot. */
  frame(t, pose) {
    const tracking = assessTracking(pose, 0.5, this.movement, this.side);
    if (tracking.status !== 'ok') {
      this.counter.interrupt();
      return this.result(null, tracking, null, 'tracking');
    }
    if (this.side === null) this.side = tracking.side;
    const m = movementAngle(pose, this.movement, this.side);
    if (!m) {
      this.counter.interrupt();
      return this.result(null, tracking, null, 'tracking');
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

  /** Changing the physical camera may mirror sides; preserve completed reps. */
  reacquireTracking() {
    this.counter.interrupt();
    this.side = null;
  }

  reset() {
    this.counter.reset();
    this.reps = [];
    this.side = null;
  }

  /** Reps in the shape a logged set stores. */
  repsDetail() {
    return this.reps.map(({ index, concentric_ms, peak_pause_ms, eccentric_ms }) => ({
      index, concentric_ms, peak_pause_ms, eccentric_ms,
    }));
  }
}
