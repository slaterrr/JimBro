/**
 * Landmark-signal cleanup used before any threshold is applied.
 *
 * Three problems with raw pose output, and what this does about each:
 *
 *  1. Jitter vs. lag. A fixed moving average must trade one for the other. The
 *     One Euro filter (Casiez et al., CHI 2012) adapts: heavy smoothing while
 *     the joint is still (no flicker at the top or bottom of a rep), light
 *     smoothing while it moves fast (little lag mid-rep). It's timestamp-based,
 *     so dropped frames and video files don't change its behaviour.
 *  2. Brief occlusions. A joint hidden for a frame or two (a hand passing the
 *     knee, a plate in front of the shin) used to reset smoothing and blank
 *     the reading. Gaps up to `maxGapMs` now hold the last good value; longer
 *     gaps return null, so the counter's tracking-loss rules still apply.
 *  3. False detections. The model occasionally jumps a joint for one frame
 *     (left/right legs swapping is the classic case). A change faster than a
 *     human joint can move (`maxRatePerSec`) is treated as a missing frame
 *     instead of a real reading, so a single glitch can't push a partial rep
 *     past the full-range line.
 */

export interface SignalFilterOptions {
  /** One Euro cutoff (Hz) when the signal is still. Lower = smoother at rest. */
  minCutoffHz: number;
  /** How fast the cutoff rises with speed (per unit/s). 0 = fixed low-pass. */
  beta: number;
  /** Cutoff (Hz) for the speed estimate itself. */
  derivativeCutoffHz: number;
  /** Hold the last value through gaps up to this long (ms). */
  maxGapMs: number;
  /** Readings implying a faster change than this (units/s) are rejected as glitches. */
  maxRatePerSec: number;
  /** Consecutive rejected readings after which the new level is accepted as real. */
  maxConsecutiveRejects: number;
}

/** Tuned for joint angles in degrees at 25–60 fps. */
export const ANGLE_FILTER: Readonly<SignalFilterOptions> = Object.freeze({
  minCutoffHz: 3,
  beta: 0.05,
  derivativeCutoffHz: 1,
  maxGapMs: 150,
  // Fast bodyweight squats peak around 300–400°/s at the knee; curls a little
  // faster. 1000°/s leaves headroom while still catching one-frame jumps.
  maxRatePerSec: 1000,
  maxConsecutiveRejects: 3,
});

/** For position and ratio signals (fractions of a body length): plain adaptive low-pass, no glitch gate. */
export const POSITION_FILTER: Readonly<SignalFilterOptions> = Object.freeze({
  minCutoffHz: 3,
  beta: 0,
  derivativeCutoffHz: 1,
  maxGapMs: 150,
  maxRatePerSec: Infinity,
  maxConsecutiveRejects: 3,
});

export interface FilterStats {
  /** Readings accepted. */
  accepted: number;
  /** Readings rejected as glitches (too fast). */
  rejected: number;
  /** Missing readings bridged by holding the last value. */
  bridged: number;
}

export class SignalFilter {
  readonly options: SignalFilterOptions;
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;
  /** Time of the last accepted reading; gaps are measured from here. */
  private lastGoodT: number | null = null;
  private lastRaw: number | null = null;
  private rejectRun = 0;
  private stats: FilterStats = { accepted: 0, rejected: 0, bridged: 0 };

  constructor(options: Partial<SignalFilterOptions> = {}) {
    this.options = { ...ANGLE_FILTER, ...options };
    if (this.options.minCutoffHz <= 0 || this.options.derivativeCutoffHz <= 0) {
      throw new RangeError("cutoffs must be > 0");
    }
  }

  /**
   * @param raw reading, or null when the joint isn't visible
   * @param tMs timestamp in milliseconds (must not go backwards; call reset() if it does)
   */
  next(raw: number | null, tMs: number): number | null {
    const o = this.options;
    const valid = raw !== null && Number.isFinite(raw);

    if (valid && this.x !== null && this.lastRaw !== null && this.lastGoodT !== null) {
      const dt = Math.max(1, tMs - this.lastGoodT) / 1000;
      if (Math.abs(raw - this.lastRaw) / dt > o.maxRatePerSec && this.rejectRun < o.maxConsecutiveRejects) {
        // Too fast to be real: treat as a missing frame.
        this.rejectRun += 1;
        this.stats.rejected += 1;
        return this.bridge(tMs);
      }
    }

    if (!valid) return this.bridge(tMs);

    this.rejectRun = 0;
    this.stats.accepted += 1;
    if (this.x === null || this.lastT === null) {
      this.x = raw;
      this.dx = 0;
    } else {
      const dt = Math.max(1, tMs - this.lastT) / 1000;
      const rawDx = (raw - this.x) / dt;
      this.dx = lowPass(this.dx, rawDx, smoothingFactor(dt, o.derivativeCutoffHz));
      const cutoff = o.minCutoffHz + o.beta * Math.abs(this.dx);
      this.x = lowPass(this.x, raw, smoothingFactor(dt, cutoff));
    }
    this.lastT = tMs;
    this.lastGoodT = tMs;
    this.lastRaw = raw;
    return this.x;
  }

  /** Clear all state (e.g. after switching exercise or rewinding a video). */
  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
    this.lastGoodT = null;
    this.lastRaw = null;
    this.rejectRun = 0;
  }

  getStats(): Readonly<FilterStats> {
    return this.stats;
  }

  resetStats(): void {
    this.stats = { accepted: 0, rejected: 0, bridged: 0 };
  }

  private bridge(tMs: number): number | null {
    if (this.x !== null && this.lastGoodT !== null && tMs - this.lastGoodT <= this.options.maxGapMs) {
      this.stats.bridged += 1;
      return this.x;
    }
    this.reset();
    return null;
  }
}

function smoothingFactor(dtSec: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

function lowPass(prev: number, next: number, alpha: number): number {
  return alpha * next + (1 - alpha) * prev;
}
