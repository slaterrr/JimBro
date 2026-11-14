/**
 * Generic repetition counter: an explicit state machine driven by one
 * (smoothed) joint angle, plus an optional "progress" check.
 *
 *   start ──leaves start zone──▶ toward_peak
 *   toward_peak ──reaches peak (+ progress ok)──▶ peak
 *   toward_peak ──back to start──▶ start            (not full range: rejected)
 *   peak ──moves back past peak + hysteresis──▶ returning
 *   returning ──reaches peak again──▶ peak          (bounce, same rep)
 *   returning ──back to start──▶ start              (rep complete → validated)
 *
 * `direction` says which way the angle moves from start to peak:
 *  - "decreasing": squat (knee 170° → 80°), push-up / curl (elbow straight → bent)
 *  - "increasing": shoulder press (elbow bent at shoulders → straight overhead)
 * All thresholds are given as real angles in the exercise's own direction.
 *
 * Duplicate / incomplete reps are prevented by:
 *  - an "armed" gate: nothing counts until the start position has been seen;
 *  - a dead band between startAngle and leaveStartAngle, plus hysteresis at
 *    the peak, so jitter around a threshold can't flip the phase;
 *  - a rep only counting on return to the start position after full range;
 *  - an optional progress check (e.g. hips must actually drop for squats);
 *  - minimum and maximum rep durations;
 *  - aborting an in-progress rep when tracking is lost for too long.
 */

import type { RepPhase } from "../../../shared/types";

export type AngleDirection = "decreasing" | "increasing";

export interface RepCounterConfig {
  /** Which way the angle moves from the start position toward the peak. */
  direction: AngleDirection;
  /** At or beyond this angle (away from the peak) the user is in the start position. */
  startAngle: number;
  /** Past this angle (toward the peak) a rep begins. Between startAngle and peakAngle. */
  leaveStartAngle: number;
  /** Reaching this angle counts as full range. */
  peakAngle: number;
  /** Degrees the angle must move back past peakAngle before the return begins. */
  hysteresis: number;
  /**
   * If a rep turns back without reaching the peak but got past this angle, it is
   * reported as a rejected (partial) rep. Smaller movements are ignored as noise.
   */
  partialAngle: number;
  /** Reps faster than this are rejected (catches jitter and bouncing). */
  minRepDurationMs: number;
  /** Reps slower than this are rejected (catches resting mid-rep). */
  maxRepDurationMs: number;
  /** An in-progress rep is aborted if landmarks stay lost for longer than this. */
  trackingLossTimeoutMs: number;
  /**
   * The progress signal must reach at least this for the peak to count
   * (e.g. squat hip drop ≥ 0.4 of leg length). 0 disables the check.
   */
  minProgress: number;
}

/** A rep that passed every validation check. Timings are in the caller's clock. */
export interface CompletedRep {
  repNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Most extreme primary angle reached (toward the peak). */
  peakAngle: number;
  /** Highest progress value reached; null if not measured. */
  maxProgress: number | null;
  /** From leaving the start position to first reaching the peak (eccentric for squats/push-ups). */
  toPeakMs: number;
  /** Time spent at or near the peak. */
  peakHoldMs: number;
  /** From leaving the peak back to the start position. */
  returnMs: number;
}

export type RejectionReason =
  | "PARTIAL_RANGE"
  | "PROGRESS_NOT_MET"
  | "TOO_FAST"
  | "TOO_SLOW"
  | "TRACKING_LOST";

export interface RejectedRep {
  reason: RejectionReason;
  at: number;
  peakAngle: number | null;
  maxProgress: number | null;
}

export type RepCounterEvent =
  | { type: "rep"; rep: CompletedRep }
  | { type: "rejected"; rejected: RejectedRep };

interface InProgressRep {
  startedAt: number;
  /** Most extreme angle so far, in signed form (see s()). */
  peakSigned: number;
  maxProgress: number | null;
  peakAt: number | null;
  returnAt: number | null;
}

export class RepCounter {
  private _config: Readonly<RepCounterConfig>;
  private _phase: RepPhase = "start";
  private _armed = false;
  private _repCount = 0;
  private current: InProgressRep | null = null;
  private lastValidAt: number | null = null;
  private lastStartAt: number | null = null;

  constructor(config: RepCounterConfig) {
    this._config = Object.freeze({ ...config });
    validateConfig(this._config);
  }

  get config(): Readonly<RepCounterConfig> {
    return this._config;
  }

  /**
   * Change thresholds mid-session (e.g. a calibration slider). The rep count is
   * kept. Throws RangeError and leaves the old config if the result is invalid.
   */
  configure(patch: Partial<RepCounterConfig>): void {
    const next = Object.freeze({ ...this._config, ...patch });
    validateConfig(next);
    this._config = next;
  }

  get phase(): RepPhase {
    return this._phase;
  }

  /** False until the start position has been seen; no reps count before that. */
  get armed(): boolean {
    return this._armed;
  }

  get repCount(): number {
    return this._repCount;
  }

  /**
   * Take back the last counted rep (it failed a later check, e.g. movement
   * validation), so the next rep gets its number. The state machine is already
   * back at the start position, so nothing carries into the next rep.
   */
  revokeLastRep(): void {
    if (this._repCount > 0) this._repCount -= 1;
  }

  /** True when `angle` is in the start zone (used e.g. to learn standing baselines). */
  atStart(angle: number | null): boolean {
    return angle !== null && this.s(angle) >= this.s(this._config.startAngle);
  }

  /**
   * Feed one frame. `angle` is null when landmarks are below the confidence
   * threshold; state transitions pause rather than guess.
   */
  update(timestamp: number, angle: number | null, progress: number | null = null): RepCounterEvent | null {
    const c = this._config;

    if (angle === null) {
      if (this.current && this.lastValidAt !== null && timestamp - this.lastValidAt > c.trackingLossTimeoutMs) {
        const rep = this.current;
        this.abort();
        return this.reject("TRACKING_LOST", timestamp, rep);
      }
      return null;
    }
    this.lastValidAt = timestamp;

    // Work in "signed" space where the angle always decreases toward the peak.
    const a = this.s(angle);
    const start = this.s(c.startAngle);
    const leave = this.s(c.leaveStartAngle);
    const peak = this.s(c.peakAngle);

    if (!this._armed) {
      if (a >= start) {
        this._armed = true;
        this._phase = "start";
        this.lastStartAt = timestamp;
      }
      return null;
    }

    const rep = this.current;
    if (rep) {
      if (a < rep.peakSigned) rep.peakSigned = a;
      if (progress !== null && (rep.maxProgress === null || progress > rep.maxProgress)) rep.maxProgress = progress;
    }

    switch (this._phase) {
      case "start": {
        if (a < leave) {
          this._phase = "toward_peak";
          this.current = {
            startedAt: this.lastStartAt ?? timestamp,
            peakSigned: a,
            maxProgress: progress,
            peakAt: null,
            returnAt: null,
          };
        } else {
          this.lastStartAt = timestamp;
        }
        return null;
      }

      case "toward_peak": {
        if (!rep) return this.desync();
        if (a <= peak && this.progressOk(rep)) {
          this._phase = "peak";
          rep.peakAt = timestamp;
        } else if (a >= start) {
          this.toStart(timestamp);
          return this.rejectIncomplete(timestamp, rep);
        }
        return null;
      }

      case "peak": {
        if (!rep) return this.desync();
        if (a > peak + c.hysteresis) {
          this._phase = "returning";
          rep.returnAt = timestamp;
        }
        return null;
      }

      case "returning": {
        if (!rep) return this.desync();
        if (a <= peak) {
          this._phase = "peak";
          return null;
        }
        if (a >= start) return this.complete(rep, timestamp);
        return null;
      }
    }
  }

  /** Drop any half-finished rep and require a fresh start position, keeping the count. */
  cancelCurrentRep(): void {
    this.abort();
    this.lastValidAt = null;
  }

  /** Clear everything, including the rep count. */
  reset(): void {
    this._phase = "start";
    this._armed = false;
    this._repCount = 0;
    this.current = null;
    this.lastValidAt = null;
    this.lastStartAt = null;
  }

  // ---- internals -------------------------------------------------------

  /** Map an angle into signed space, where moving toward the peak always decreases it. */
  private s(angle: number): number {
    return this._config.direction === "decreasing" ? angle : -angle;
  }

  private unsign(signed: number): number {
    return this._config.direction === "decreasing" ? signed : -signed;
  }

  private progressOk(rep: InProgressRep): boolean {
    const min = this._config.minProgress;
    if (min <= 0 || rep.maxProgress === null) return true;
    return rep.maxProgress >= min;
  }

  private rejectIncomplete(at: number, rep: InProgressRep): RepCounterEvent | null {
    const c = this._config;
    // A very long "attempt" is a rest (e.g. arms down between press sets), not a rep: stay quiet.
    if (at - rep.startedAt > c.maxRepDurationMs) return null;
    // Angle reached the peak but the progress check failed (e.g. hips stayed up).
    if (rep.peakSigned <= this.s(c.peakAngle)) return this.reject("PROGRESS_NOT_MET", at, rep);
    if (rep.peakSigned < this.s(c.partialAngle)) return this.reject("PARTIAL_RANGE", at, rep);
    return null;
  }

  private complete(rep: InProgressRep, endedAt: number): RepCounterEvent {
    const c = this._config;
    const durationMs = endedAt - rep.startedAt;
    this.toStart(endedAt);
    if (durationMs < c.minRepDurationMs) return this.reject("TOO_FAST", endedAt, rep);
    if (durationMs > c.maxRepDurationMs) return this.reject("TOO_SLOW", endedAt, rep);

    const peakAt = rep.peakAt ?? rep.startedAt;
    const returnAt = rep.returnAt ?? peakAt;
    this._repCount += 1;
    return {
      type: "rep",
      rep: {
        repNumber: this._repCount,
        startedAt: rep.startedAt,
        endedAt,
        durationMs,
        peakAngle: this.unsign(rep.peakSigned),
        maxProgress: rep.maxProgress,
        toPeakMs: peakAt - rep.startedAt,
        peakHoldMs: returnAt - peakAt,
        returnMs: endedAt - returnAt,
      },
    };
  }

  private toStart(timestamp: number): void {
    this._phase = "start";
    this.current = null;
    this.lastStartAt = timestamp;
  }

  /** Tracking lost mid-rep: drop the rep and require a fresh start position. */
  private abort(): void {
    this._phase = "start";
    this._armed = false;
    this.current = null;
    this.lastStartAt = null;
  }

  private desync(): null {
    this.abort();
    return null;
  }

  private reject(reason: RejectionReason, at: number, rep: InProgressRep): RepCounterEvent {
    return {
      type: "rejected",
      rejected: { reason, at, peakAngle: this.unsign(rep.peakSigned), maxProgress: rep.maxProgress },
    };
  }
}

function validateConfig(c: RepCounterConfig): void {
  const s = (x: number) => (c.direction === "decreasing" ? x : -x);
  if (!(s(c.startAngle) > s(c.leaveStartAngle))) {
    throw new RangeError("leaveStartAngle must be between startAngle and peakAngle");
  }
  if (!(s(c.leaveStartAngle) > s(c.peakAngle) + c.hysteresis)) {
    throw new RangeError("leaveStartAngle must be further from the peak than peakAngle + hysteresis");
  }
  if (!(s(c.partialAngle) > s(c.peakAngle) && s(c.partialAngle) < s(c.leaveStartAngle))) {
    throw new RangeError("partialAngle must be between peakAngle and leaveStartAngle");
  }
  if (!(c.minRepDurationMs >= 0 && c.maxRepDurationMs > c.minRepDurationMs)) {
    throw new RangeError("maxRepDurationMs must be greater than minRepDurationMs");
  }
  if (!(c.minProgress >= 0 && c.minProgress < 2)) {
    throw new RangeError("minProgress must be in [0, 2)");
  }
}

/**
 * Measures how far a body point has moved down (image y grows downward) from
 * its height in the start position, as a fraction of a reference length.
 * Squat: hips vs standing height, scaled by leg length.
 * Push-up: shoulders vs top-of-plank height, scaled by arm length.
 * The baseline is learned only while in the start position, so it adapts if
 * the user moves closer to or further from the camera between reps.
 */
export class BaselineDropMeter {
  private baseY: number | null = null;
  private baseLen: number | null = null;

  /** @param alpha EMA factor for the baseline (0–1). */
  constructor(private readonly alpha = 0.2) {}

  update(y: number | null, refLength: number | null, atStart: boolean): number | null {
    if (y === null) return null;
    if (atStart && refLength !== null && refLength > 0) {
      this.baseY = this.baseY === null ? y : this.alpha * y + (1 - this.alpha) * this.baseY;
      this.baseLen = this.baseLen === null ? refLength : this.alpha * refLength + (1 - this.alpha) * this.baseLen;
    }
    if (this.baseY === null || !this.baseLen) return null;
    return (y - this.baseY) / this.baseLen;
  }

  reset(): void {
    this.baseY = null;
    this.baseLen = null;
  }
}
