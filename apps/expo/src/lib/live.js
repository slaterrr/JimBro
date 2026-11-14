// One camera set: landmark frames in, live count and per-rep timing out.
// Quality gates prevent missing joints or camera side swaps from completing fake reps.
import { ARM, armShape, assessTracking, curlUpperArmSwing, LEG, movementAngle, frontalKneeAngle, isFrontal, lowerBodyShape, missingHint } from './angles.js';
import { analyzeRep } from './form.js';
import { MOVEMENTS, RepCounter } from './reps.js';

const MAX_CURL_SWING_DEG = 50; // conservative initial heuristic; validate on real videos
// Hypothesis under test: real joints move < ~3 torso lengths/s even on fast reps; a landmark
// that jumps faster than this was re-placed by the model, not moved by the body.
const MAX_JOINT_SPEED_TORSO_PER_S = 6;
const MAX_SPEED_GAP_MS = 300;
// Exercise-change detection: sustained other-exercise shape pauses counting (~0.3 s at 20 fps),
// and enough of it suggests switching (~1 s).
const CHANGE_FRAMES = 6;
const SUGGEST_FRAMES = 20;
// Once a rep looks like a lunge, the rest of that rep stays blocked until the user stands up.
const STANDING_DEG = 150;
// Arm lifts: a press lockout is brief (~0.3 s), so fewer consecutive frames latch it.
const ARM_CHANGE_FRAMES = 3;
const ARM_OTHER = {
  curl: { shape: 'press', suggested: 'shoulder_press', rest: ['down'] },
  shoulder_press: { shape: 'curl', suggested: 'curl', rest: ['down', 'rack'] },
};
// Hypothesis under test: MediaPipe extrapolates hips that are off-screen with passing
// visibility (waist-up framing). Torso anchors must lie inside the frame, with a margin.
const FRAME_MARGIN = 0.05;
// Form-review clips: landmarks only (never video), bounded memory.
const CLIP_PRE_MS = 500; // frames before the counter's rep start (motion begins before it triggers)
const CLIP_POST_MS = 400; // frames after rep end, so the lowering reaches the bottom
const CLIP_MAX_FRAMES = 60;
const MAX_FAULT_CLIPS = 10;
const BUFFER_MS = 15000;

/** Evenly pick at most n items, keeping the first and last. */
export function downsample(items, n) {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

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
    this.blocked = []; // in-progress reps aborted by a quality gate: {reason, t}
    this.side = null;
    this._buf = [];
    this._pending = [];
    this._clips = [];
  }

  /** Per-rep clips for form review: flagged reps plus the best clean rep, in rep order. */
  get clips() {
    this._flushClips(Infinity);
    return this._clips;
  }

  _flushClips(now) {
    while (this._pending.length && (now === Infinity || now >= this._pending[0].end_ms + CLIP_POST_MS)) {
      const rep = this._pending.shift();
      const raw = this._buf.filter((f) => f.t >= rep.start_ms - CLIP_PRE_MS && f.t <= rep.end_ms + CLIP_POST_MS);
      const analysis = analyzeRep(this.movement, raw);
      if (analysis.uncertain) continue;
      const clip = { index: rep.index, frames: downsample(raw, CLIP_MAX_FRAMES), analysis };
      if (analysis.ok) {
        const rom = raw.length ? Math.max(...raw.map((f) => f.angle)) - Math.min(...raw.map((f) => f.angle)) : 0;
        const best = this._clips.find((c) => c.analysis.ok);
        if (best && best.rom >= rom) continue;
        this._clips = this._clips.filter((c) => !c.analysis.ok);
        Object.defineProperty(clip, 'rom', { value: rom, enumerable: false });
      } else if (this._clips.filter((c) => !c.analysis.ok).length >= MAX_FAULT_CLIPS) continue;
      this._clips.push(clip);
      this._clips.sort((a, b) => a.index - b.index);
    }
    if (now !== Infinity) {
      const keepFrom = Math.min(now - BUFFER_MS, ...this._pending.map((r) => r.start_ms - CLIP_PRE_MS));
      if (this._buf.length && this._buf[0].t < keepFrom) this._buf = this._buf.filter((f) => f.t >= keepFrom);
    }
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
    let blocked = null;
    if (issue && this._frame?.moving) {
      blocked = { reason: issue, t: this._frame.t };
      this.blocked.push(blocked);
    }
    return {
      rep, tracking, angle, issue, blocked, state: this.counter.state,
      count: this.counter.count, partials: this.counter.partials,
    };
  }

  /** Feed one frame ({t ms, pose: 33 landmarks or null}); returns the UI snapshot. */
  frame(t, pose) {
    // The user had moved meaningfully: an issue now aborts a rep rather than idle noise.
    this._frame = { t, moving: this.counter.state !== 'rest' };
    const tracking = assessTracking(pose, 0.5, this.movement, this.side);
    if (tracking.status !== 'ok') {
      this._prev = null;
      this.counter.interrupt();
      return { ...this.result(null, tracking, null, 'tracking'), hint: missingHint(pose, this.movement) };
    }
    if (this.side === null) this.side = tracking.side;
    let m = movementAngle(pose, this.movement, this.side);
    this.view = this.movement === 'squat' && m && isFrontal(pose) ? 'front' : 'side';
    if (this.view === 'front') {
      const knee = frontalKneeAngle(pose, this.side, (this._cal ??= {}));
      m = knee === null ? null : { ...m, angle: knee };
    }
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
    if (this.movement === 'squat') {
      const shape = lowerBodyShape(pose, m.angle);
      this._other = shape === 'lunge' ? (this._other ?? 0) + 1 : 0;
      if (shape === 'lunge') this._otherTotal = (this._otherTotal ?? 0) + 1;
      if (this._otherTotal >= SUGGEST_FRAMES) this.suggested = 'lunge';
      if (shape === 'lunge' && (this._other >= CHANGE_FRAMES || this.counter.state !== 'rest')) this._latched = true;
      if (this._latched && m.angle >= STANDING_DEG && shape !== 'lunge') this._latched = false;
      if (this._latched) {
        this.counter.interrupt();
        return { ...this.result(null, tracking, m.angle, 'exercise_change'), hint: 'lunge', suggested: this.suggested ?? null };
      }
    }
    const armOther = ARM_OTHER[this.movement];
    if (armOther) {
      // Same pattern as lunges: other-lift shape latches the whole rep until the arms are back
      // at this lift's rest (arms hanging for curl mode; hanging or racked for press mode).
      const shape = armShape(pose, this.side);
      const other = shape === armOther.shape;
      this._other = other ? (this._other ?? 0) + 1 : 0;
      if (other) this._otherTotal = (this._otherTotal ?? 0) + 1;
      if (this._otherTotal >= SUGGEST_FRAMES) this.suggested = armOther.suggested;
      if (other && (this._other >= ARM_CHANGE_FRAMES || this.counter.state !== 'rest')) this._latched = true;
      if (this._latched && armOther.rest.includes(shape)) this._latched = false;
      if (this._latched) {
        this.counter.interrupt();
        return { ...this.result(null, tracking, m.angle, 'exercise_change'), hint: armOther.suggested, suggested: this.suggested ?? null };
      }
    }
    if (this.movement === 'curl') {
      const swing = curlUpperArmSwing(pose, this.side);
      if (!Number.isFinite(swing) || swing > MAX_CURL_SWING_DEG) {
        this.counter.interrupt();
        return this.result(null, tracking, m.angle, 'arm_swing');
      }
    }
    this._buf.push({ t, pose: pose.map(({ x, y, visibility }) => ({ x, y, visibility })), angle: m.angle });
    const rep = this.counter.update({ t_ms: t, angle_deg: m.angle, confidence: m.confidence });
    if (rep) {
      this.reps.push(rep);
      this._pending.push(rep);
    }
    this._flushClips(t);
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
    this._cal = null;
    this._prev = null;
    this.side = null;
  }

  reset() {
    this.counter.reset();
    this.reps = [];
    this.side = null;
    this._q = null;
    this.blocked = [];
    this._prev = null;
    this._buf = [];
    this._pending = [];
    this._clips = [];
  }

  /** Reps in the shape a logged set stores. */
  repsDetail() {
    return this.reps.map(({ index, concentric_ms, peak_pause_ms, eccentric_ms }) => ({
      index, concentric_ms, peak_pause_ms, eccentric_ms,
    }));
  }
}
