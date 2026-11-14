// One camera set: landmark frames in, live count and per-rep timing out.
import { assessTracking, movementAngle } from './angles.js';
import { MOVEMENTS, RepCounter } from './reps.js';

export class LiveSession {
  constructor(movement) {
    if (!MOVEMENTS[movement]) throw new Error(`no camera counting for ${movement}`);
    this.movement = movement;
    this.counter = new RepCounter(MOVEMENTS[movement]);
    this.reps = [];
  }

  get count() {
    return this.counter.count;
  }

  /** Feed one frame ({t ms, pose: 33 landmarks or null}); returns what the UI shows. */
  frame(t, pose) {
    const tracking = assessTracking(pose);
    const m = movementAngle(pose, this.movement);
    const rep = m ? this.counter.update({ t_ms: t, angle_deg: m.angle, confidence: m.confidence }) : null;
    if (rep) this.reps.push(rep);
    return { rep, tracking, angle: m?.angle ?? null, state: this.counter.state, count: this.counter.count, partials: this.counter.partials };
  }

  reset() {
    this.counter.reset();
    this.reps = [];
  }

  /** Reps in the shape a logged set stores. */
  repsDetail() {
    return this.reps.map(({ index, concentric_ms, peak_pause_ms, eccentric_ms }) => ({ index, concentric_ms, peak_pause_ms, eccentric_ms }));
  }
}
