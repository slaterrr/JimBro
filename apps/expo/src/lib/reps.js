// Rep counting and movement-phase timing from joint angles: a line-for-line port of
// backend/jimbro/reps.py (same thresholds, same tests). Movements are normalised to
// depth, how far the joint has travelled from rest toward peak, so one hysteresis
// machine handles flexion (curl, squat) and extension (shoulder press).

export function movementConfig({
  name, rest_deg, peak_deg, hysteresis_deg = 12, smoothing = 0.5, min_confidence = 0.5,
  min_rep_ms = 500, cooldown_ms = 250, max_gap_ms = 1000,
}) {
  const span = Math.abs(rest_deg - peak_deg);
  if (span <= 0) throw new Error('rest and peak angles must differ');
  if (hysteresis_deg < 0 || 4 * hysteresis_deg >= span) {
    throw new Error('hysteresis must be non-negative and below a quarter of the span');
  }
  if (!(smoothing > 0 && smoothing <= 1)) throw new Error('smoothing must be in (0, 1]');
  if (!(min_confidence >= 0 && min_confidence <= 1)) throw new Error('min_confidence must be in [0, 1]');
  const direction = peak_deg < rest_deg ? 1 : -1;
  return Object.freeze({
    name, rest_deg, peak_deg, hysteresis_deg, smoothing, min_confidence, min_rep_ms, cooldown_ms, max_gap_ms,
    span, depth: (angle) => direction * (rest_deg - angle),
  });
}

export const CURL = movementConfig({ name: 'curl', rest_deg: 165, peak_deg: 50 });
export const SQUAT = movementConfig({ name: 'squat', rest_deg: 165, peak_deg: 95, hysteresis_deg: 10 });
export const SHOULDER_PRESS = movementConfig({ name: 'shoulder_press', rest_deg: 85, peak_deg: 160 });
// Push-up: elbow angle, arms straight at the top (rest) to ~90° at the bottom (peak).
export const PUSH_UP = movementConfig({ name: 'push_up', rest_deg: 165, peak_deg: 95, hysteresis_deg: 10 });
// EXPERIMENTAL (simulation-tested only; see lib/analyzers.js). Pull-up: elbow angle facing the
// camera, hanging with straight arms (rest) to chin over the bar (~80°).
export const PULL_UP = movementConfig({ name: 'pull_up', rest_deg: 160, peak_deg: 80 });
// Deadlift: hip angle (shoulder–hip–knee) from the side. The bottom (bar near the floor) is rest
// so a set that starts from the floor arms immediately; lockout (~165°) is the peak.
export const DEADLIFT = movementConfig({ name: 'deadlift', rest_deg: 110, peak_deg: 165, hysteresis_deg: 10 });
export const MOVEMENTS = { curl: CURL, squat: SQUAT, shoulder_press: SHOULDER_PRESS, push_up: PUSH_UP, pull_up: PULL_UP, deadlift: DEADLIFT };

export class RepCounter {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.partials = 0;
    this._lastT = null;
    this._lastGoodT = null;
    this._cooldownUntil = 0;
    this._abort();
  }

  _abort() {
    this.state = 'rest';
    this._armed = false;
    this._smoothed = null;
    this._marks = {};
    this._reachedPeak = false;
  }

  /** Abort an uncertain in-progress rep without erasing previously counted reps. */
  interrupt() {
    this._abort();
    this._lastGoodT = null;
  }

  /** Feed one {t_ms, angle_deg, confidence}; returns a rep summary when a rep completes. */
  update({ t_ms, angle_deg, confidence }) {
    if (!Number.isFinite(angle_deg) || !Number.isFinite(confidence)) return null;
    if (this._lastT !== null && t_ms <= this._lastT) return null;
    this._lastT = t_ms;
    if (confidence < this.config.min_confidence) return null;
    if (this._lastGoodT !== null && t_ms - this._lastGoodT > this.config.max_gap_ms) this._abort();
    this._lastGoodT = t_ms;
    const raw = this.config.depth(angle_deg);
    const a = this.config.smoothing;
    this._smoothed = this._smoothed === null ? raw : a * raw + (1 - a) * this._smoothed;
    return this._step(this._smoothed, t_ms);
  }

  _step(depth, t) {
    const h = this.config.hysteresis_deg;
    const span = this.config.span;
    const restEnter = h;
    const restExit = 2 * h;
    const peakExit = span - 2 * h;
    const peakEnter = span - h;

    if (!this._armed) {
      if (depth <= restEnter) this._armed = true;
      return null;
    }
    if (this.state === 'rest') {
      if (depth > restExit && t >= this._cooldownUntil) {
        this.state = 'concentric';
        this._marks = { start: t };
        this._reachedPeak = false;
      }
    } else if (this.state === 'concentric') {
      if (depth >= peakEnter) {
        this.state = 'peak';
        this._marks.peak = t;
        this._reachedPeak = true;
      } else if (depth <= restEnter) {
        return this._finish(t);
      }
    } else if (this.state === 'peak') {
      if (depth < peakExit) {
        this.state = 'eccentric';
        this._marks.leavePeak = t;
      }
    } else if (depth >= peakEnter) {
      this.state = 'peak';
    } else if (depth <= restEnter) {
      return this._finish(t);
    }
    return null;
  }

  _finish(t) {
    const m = this._marks;
    this.state = 'rest';
    this._cooldownUntil = t + this.config.cooldown_ms;
    this._marks = {};
    if (!this._reachedPeak || t - m.start < this.config.min_rep_ms) {
      this.partials += 1;
      return null;
    }
    this.count += 1;
    const concentric_ms = m.peak - m.start;
    const peak_pause_ms = m.leavePeak - m.peak;
    const eccentric_ms = t - m.leavePeak;
    return {
      index: this.count, start_ms: m.start, end_ms: t,
      concentric_ms, peak_pause_ms, eccentric_ms,
      tut_ms: concentric_ms + peak_pause_ms + eccentric_ms,
    };
  }
}
