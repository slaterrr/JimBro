/**
 * Squat repetition counter: an explicit state machine driven by the (smoothed)
 * knee angle.
 *
 *   standing ──knee < descentStartAngle──▶ descending
 *   descending ──knee ≤ depthAngle──▶ bottom
 *   descending ──knee ≥ standingAngle──▶ standing   (no depth: rejected, not counted)
 *   bottom ──knee > depthAngle + hysteresis──▶ ascending
 *   ascending ──knee ≤ depthAngle──▶ bottom         (dipped again, same rep)
 *   ascending ──knee ≥ standingAngle──▶ standing    (rep complete → validated)
 *
 * Duplicate / incomplete reps are prevented by:
 *  - an "armed" gate: nothing counts until the user has been seen standing,
 *    so starting the session mid-squat can't produce a phantom rep;
 *  - a dead band between standingAngle and descentStartAngle, plus hysteresis
 *    at the bottom, so jitter around a threshold can't flip the phase;
 *  - a rep only counting on return to full extension after reaching depth;
 *  - minimum and maximum rep durations;
 *  - aborting an in-progress rep when tracking is lost for too long.
 *
 * Angles are knee interior angles in degrees (180 = straight leg).
 */

import type { SquatPhase } from "../../../shared/types";

export interface RepCounterConfig {
  /** Knee angle at or above which the user counts as standing / locked out. */
  standingAngle: number;
  /** Knee angle below which a descent starts. Must be < standingAngle. */
  descentStartAngle: number;
  /**
   * Knee angle at or below which depth counts as reached. This is a camera
   * threshold on the projected knee angle, not an anatomical "parallel" check.
   */
  depthAngle: number;
  /** Degrees the knee must rise above depthAngle before ascent begins. */
  hysteresis: number;
  /**
   * If a descent turns back without reaching depth but went below this angle,
   * it is reported as a rejected (shallow) rep. Shallower dips are ignored as noise.
   */
  partialMinAngle: number;
  /** Reps faster than this are rejected (catches jitter and bouncing). */
  minRepDurationMs: number;
  /** Reps slower than this are rejected (catches resting mid-rep). */
  maxRepDurationMs: number;
  /** An in-progress rep is aborted if landmarks stay lost for longer than this. */
  trackingLossTimeoutMs: number;
  /**
   * Hips must drop at least this fraction of standing leg length (hip→ankle)
   * for depth to count. Stops a bent knee on its own (e.g. a raised leg on a
   * one-legged stance, or a small dip) from counting. 0 disables the check.
   * Roughly: half squat ≈ 0.25–0.3, knee at 100° ≈ 0.4, parallel ≈ 0.5+.
   */
  minHipDrop: number;
}

export const DEFAULT_REP_COUNTER_CONFIG: Readonly<RepCounterConfig> = Object.freeze({
  standingAngle: 160,
  descentStartAngle: 150,
  depthAngle: 100,
  hysteresis: 8,
  partialMinAngle: 135,
  minRepDurationMs: 600,
  maxRepDurationMs: 12_000,
  trackingLossTimeoutMs: 700,
  minHipDrop: 0.3,
});

/** A rep that passed every validation check. Timings are in the caller's clock. */
export interface CompletedRep {
  repNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  minKneeAngle: number;
  minHipAngle: number | null;
  /** Largest hip drop as a fraction of standing leg length; null if not measured. */
  maxHipDrop: number | null;
  /** From leaving lockout to first reaching depth. */
  descentMs: number;
  /** Time spent at or near depth. */
  bottomMs: number;
  /** From leaving the bottom to lockout. */
  ascentMs: number;
}

export type RejectionReason = "SHALLOW_DEPTH" | "NO_HIP_DROP" | "TOO_FAST" | "TOO_SLOW" | "TRACKING_LOST";

export interface RejectedRep {
  reason: RejectionReason;
  at: number;
  minKneeAngle: number | null;
}

export type RepCounterEvent =
  | { type: "rep"; rep: CompletedRep }
  | { type: "rejected"; rejected: RejectedRep };

interface InProgressRep {
  startedAt: number;
  minKnee: number;
  minHip: number | null;
  maxHipDrop: number | null;
  bottomAt: number | null;
  ascentAt: number | null;
}

export class SquatRepCounter {
  private _config: Readonly<RepCounterConfig>;
  private _phase: SquatPhase = "standing";
  private _armed = false;
  private _repCount = 0;
  private current: InProgressRep | null = null;
  private lastValidAt: number | null = null;
  private lastStandingAt: number | null = null;

  constructor(config: Partial<RepCounterConfig> = {}) {
    this._config = Object.freeze({ ...DEFAULT_REP_COUNTER_CONFIG, ...config });
    validateConfig(this._config);
  }

  get config(): Readonly<RepCounterConfig> {
    return this._config;
  }

  /**
   * Change thresholds mid-session (e.g. a depth calibration slider). The rep
   * count is kept; a rep in progress finishes against the new thresholds.
   * Throws RangeError and leaves the old config in place if the result is invalid.
   */
  configure(patch: Partial<RepCounterConfig>): void {
    const next = Object.freeze({ ...this._config, ...patch });
    validateConfig(next);
    this._config = next;
  }

  get phase(): SquatPhase {
    return this._phase;
  }

  /** False until the user has been seen standing; no reps count before that. */
  get armed(): boolean {
    return this._armed;
  }

  get repCount(): number {
    return this._repCount;
  }

  /**
   * Feed one frame. `kneeAngle` / `hipAngle` are null when landmarks are below
   * the confidence threshold; state transitions pause rather than guess.
   */
  update(
    timestamp: number,
    kneeAngle: number | null,
    hipAngle: number | null = null,
    /** Hip drop as a fraction of standing leg length (see HipDropMeter). null = unknown. */
    hipDrop: number | null = null,
  ): RepCounterEvent | null {
    const c = this.config;

    if (kneeAngle === null) {
      if (
        this.current &&
        this.lastValidAt !== null &&
        timestamp - this.lastValidAt > c.trackingLossTimeoutMs
      ) {
        const minKneeAngle = this.current.minKnee;
        this.abort();
        return this.reject("TRACKING_LOST", timestamp, minKneeAngle);
      }
      return null;
    }
    this.lastValidAt = timestamp;

    if (!this._armed) {
      if (kneeAngle >= c.standingAngle) {
        this._armed = true;
        this._phase = "standing";
        this.lastStandingAt = timestamp;
      }
      return null;
    }

    const rep = this.current;
    if (rep) {
      if (kneeAngle < rep.minKnee) rep.minKnee = kneeAngle;
      if (hipAngle !== null && (rep.minHip === null || hipAngle < rep.minHip)) rep.minHip = hipAngle;
      if (hipDrop !== null && (rep.maxHipDrop === null || hipDrop > rep.maxHipDrop)) rep.maxHipDrop = hipDrop;
    }

    switch (this._phase) {
      case "standing": {
        if (kneeAngle < c.descentStartAngle) {
          this._phase = "descending";
          this.current = {
            startedAt: this.lastStandingAt ?? timestamp,
            minKnee: kneeAngle,
            minHip: hipAngle,
            maxHipDrop: hipDrop,
            bottomAt: null,
            ascentAt: null,
          };
        } else {
          this.lastStandingAt = timestamp;
        }
        return null;
      }

      case "descending": {
        if (!rep) return this.desync();
        if (kneeAngle <= c.depthAngle && this.hipsLowEnough(rep)) {
          this._phase = "bottom";
          rep.bottomAt = timestamp;
        } else if (kneeAngle >= c.standingAngle) {
          const minKnee = rep.minKnee;
          this.toStanding(timestamp);
          // Knee bent far enough but the hips stayed up: e.g. a raised leg, not a squat.
          if (minKnee <= c.depthAngle) return this.reject("NO_HIP_DROP", timestamp, minKnee);
          if (minKnee < c.partialMinAngle) return this.reject("SHALLOW_DEPTH", timestamp, minKnee);
        }
        return null;
      }

      case "bottom": {
        if (!rep) return this.desync();
        if (kneeAngle > c.depthAngle + c.hysteresis) {
          this._phase = "ascending";
          rep.ascentAt = timestamp;
        }
        return null;
      }

      case "ascending": {
        if (!rep) return this.desync();
        if (kneeAngle <= c.depthAngle) {
          this._phase = "bottom";
          return null;
        }
        if (kneeAngle >= c.standingAngle) {
          return this.complete(rep, timestamp);
        }
        return null;
      }
    }
  }

  /**
   * Drop any half-finished rep and require a fresh standing pose, keeping the
   * count. Use when pausing so a rep can't complete across the pause.
   */
  cancelCurrentRep(): void {
    this.abort();
    this.lastValidAt = null;
  }

  /** Clear everything, including the rep count. */
  reset(): void {
    this._phase = "standing";
    this._armed = false;
    this._repCount = 0;
    this.current = null;
    this.lastValidAt = null;
    this.lastStandingAt = null;
  }

  /** True when hip drop is disabled, unmeasured, or deep enough. */
  private hipsLowEnough(rep: InProgressRep): boolean {
    const min = this.config.minHipDrop;
    if (min <= 0 || rep.maxHipDrop === null) return true;
    return rep.maxHipDrop >= min;
  }

  private complete(rep: InProgressRep, endedAt: number): RepCounterEvent {
    const c = this.config;
    const durationMs = endedAt - rep.startedAt;
    this.toStanding(endedAt);
    if (durationMs < c.minRepDurationMs) return this.reject("TOO_FAST", endedAt, rep.minKnee);
    if (durationMs > c.maxRepDurationMs) return this.reject("TOO_SLOW", endedAt, rep.minKnee);

    const bottomAt = rep.bottomAt ?? rep.startedAt;
    const ascentAt = rep.ascentAt ?? bottomAt;
    this._repCount += 1;
    return {
      type: "rep",
      rep: {
        repNumber: this._repCount,
        startedAt: rep.startedAt,
        endedAt,
        durationMs,
        minKneeAngle: rep.minKnee,
        minHipAngle: rep.minHip,
        maxHipDrop: rep.maxHipDrop,
        descentMs: bottomAt - rep.startedAt,
        bottomMs: ascentAt - bottomAt,
        ascentMs: endedAt - ascentAt,
      },
    };
  }

  private toStanding(timestamp: number): void {
    this._phase = "standing";
    this.current = null;
    this.lastStandingAt = timestamp;
  }

  /** Tracking lost mid-rep: drop the rep and require a fresh standing pose. */
  private abort(): void {
    this._phase = "standing";
    this._armed = false;
    this.current = null;
    this.lastStandingAt = null;
  }

  private desync(): null {
    this.abort();
    return null;
  }

  private reject(reason: RejectionReason, at: number, minKneeAngle: number | null): RepCounterEvent {
    return { type: "rejected", rejected: { reason, at, minKneeAngle } };
  }
}

function validateConfig(c: RepCounterConfig): void {
  if (!(c.standingAngle > c.descentStartAngle)) {
    throw new RangeError("standingAngle must be greater than descentStartAngle");
  }
  if (!(c.descentStartAngle > c.depthAngle + c.hysteresis)) {
    throw new RangeError("descentStartAngle must be greater than depthAngle + hysteresis");
  }
  if (!(c.partialMinAngle > c.depthAngle && c.partialMinAngle < c.descentStartAngle)) {
    throw new RangeError("partialMinAngle must be between depthAngle and descentStartAngle");
  }
  if (!(c.minRepDurationMs >= 0 && c.maxRepDurationMs > c.minRepDurationMs)) {
    throw new RangeError("maxRepDurationMs must be greater than minRepDurationMs");
  }
  if (!(c.minHipDrop >= 0 && c.minHipDrop < 1)) {
    throw new RangeError("minHipDrop must be in [0, 1)");
  }
}

/**
 * Measures how far the hips have dropped below their standing height, as a
 * fraction of standing leg length (hip→ankle). The baseline is learned only
 * while the user stands with straight legs, so it adapts if they step closer
 * to or further from the camera between reps.
 *
 * Image y grows downward, so a positive value means the hips went down.
 */
export class HipDropMeter {
  private baseHipY: number | null = null;
  private baseLeg: number | null = null;

  /** @param alpha EMA factor for the standing baseline (0–1). */
  constructor(private readonly alpha = 0.2) {}

  /**
   * @param standing true only when the user is upright with straight legs
   *   (e.g. counter phase is "standing" and knee ≥ standingAngle).
   */
  update(hipY: number | null, legLength: number | null, standing: boolean): number | null {
    if (hipY === null) return null;
    if (standing && legLength !== null && legLength > 0) {
      this.baseHipY = this.baseHipY === null ? hipY : this.alpha * hipY + (1 - this.alpha) * this.baseHipY;
      this.baseLeg = this.baseLeg === null ? legLength : this.alpha * legLength + (1 - this.alpha) * this.baseLeg;
    }
    if (this.baseHipY === null || !this.baseLeg) return null;
    return (hipY - this.baseHipY) / this.baseLeg;
  }

  reset(): void {
    this.baseHipY = null;
    this.baseLeg = null;
  }
}
