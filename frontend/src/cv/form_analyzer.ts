/**
 * Per-rep form flags, per-session summary metrics, and a camera-view check.
 * Exercise-agnostic; exercise-specific checks live in exercises/*.ts.
 *
 * What a single camera can and can't tell us
 * ------------------------------------------
 * MEASURED (directly observed, from the camera position each exercise asks for):
 *   - rep count, rep / phase durations (timestamps of threshold crossings)
 *   - the counting joint's angle and whether it reached the full-range line
 *   - progress signals: hip drop (squat), chest drop (push-up), hands above shoulders (press)
 *   - exercise form signals: body line (push-up), elbow drift / body swing (curl),
 *     arm evenness (press), torso lean (lunge, deadlift lockout), step length (lunge)
 * ESTIMATED (inferred; carries a confidence value or is a comparison):
 *   - tempo and range consistency across reps (depend on tracking quality)
 *   - camera view (side / front), a heuristic from landmark geometry
 *   - comparisons against the user's own earlier reps ("uneven tempo", "range
 *     varies", personal-baseline checks such as torso shift) and session trends
 *   - knees caving in (front-view squats only): a 2D knee-to-ankle ratio, a
 *     screening proxy rather than a true 3D valgus angle
 * NOT CLAIMED (not reliably observable here, so never reported):
 *   - spinal position / back rounding, weight distribution, bar path, load,
 *     grip, wrist angle, scapular movement, knee valgus from a side view
 *
 * Evidence rule: a form signal is only judged when it was seen in at least
 * `minEvidence` of the rep's frames (the tracker drops the rest), and personal
 * comparisons wait for `minRepsForConsistency` earlier reps.
 */

import type { FormFlag, Metric, RepEvent, WorkoutSession } from "../../../shared/types";
import type { ExerciseDefinition, FormStats, PersonalCheck } from "./exercises/types";
import { POSE_LANDMARKS, type LandmarkLike } from "./pose_detection";
import type { CompletedRep, RejectedRep } from "./rep_counter";

export interface FormAnalyzerConfig {
  /** Lowering phases faster than this get a FAST_LOWERING flag. */
  fastLoweringMs: number;
  /** Relative deviation from the median duration that counts as uneven tempo. */
  tempoOutlierRatio: number;
  /** Degrees from the median peak angle that counts as inconsistent range. */
  rangeOutlierDeg: number;
  /** Previous reps needed before consistency and personal-baseline flags are raised. */
  minRepsForConsistency: number;
  /** Fraction of a rep's frames a form signal must be seen in to be judged. */
  minEvidence: number;
}

export const DEFAULT_FORM_ANALYZER_CONFIG: Readonly<FormAnalyzerConfig> = Object.freeze({
  fastLoweringMs: 400,
  tempoOutlierRatio: 0.35,
  rangeOutlierDeg: 15,
  minRepsForConsistency: 3,
  minEvidence: 0.7,
});

export interface AnalyzeContext {
  config?: Partial<FormAnalyzerConfig>;
  /** View the rep was measured from. Default "side". */
  view?: "side" | "front";
  /** Form stats of the earlier reps in this session, oldest first (for personal checks). */
  history?: readonly FormStats[];
}

/** Flags for one rep: exercise-specific checks plus generic tempo/range checks. */
export function analyzeRep(
  exercise: ExerciseDefinition,
  rep: CompletedRep,
  previous: readonly CompletedRep[],
  stats: FormStats = {},
  ctx: AnalyzeContext = {},
): FormFlag[] {
  const c = { ...DEFAULT_FORM_ANALYZER_CONFIG, ...ctx.config };
  const flags: FormFlag[] = [...exercise.formChecks(rep, stats, ctx.view ?? "side")];
  flags.push(...personalFlags(exercise.personalChecks, stats, ctx.history ?? [], c.minRepsForConsistency));

  const loweringMs = exercise.loweringPhase === "toPeak" ? rep.toPeakMs : rep.returnMs;
  if (loweringMs < c.fastLoweringMs) {
    flags.push({
      code: "FAST_LOWERING",
      message: `The lowering took only ${Math.round(loweringMs)} ms. Slow it down and stay in control.`,
      source: "measured",
    });
  }

  if (previous.length >= c.minRepsForConsistency) {
    const medianDuration = median(previous.map((r) => r.durationMs));
    if (medianDuration > 0 && Math.abs(rep.durationMs - medianDuration) / medianDuration > c.tempoOutlierRatio) {
      flags.push({
        code: "UNEVEN_TEMPO",
        message: `This rep was noticeably ${rep.durationMs < medianDuration ? "faster" : "slower"} than your others.`,
        source: "estimated",
      });
    }

    const medianPeak = median(previous.map((r) => r.peakAngle));
    if (Math.abs(rep.peakAngle - medianPeak) > c.rangeOutlierDeg) {
      // "Less range" = further from the peak line, in the exercise's direction.
      const lessRange = exercise.counter.direction === "decreasing" ? rep.peakAngle > medianPeak : rep.peakAngle < medianPeak;
      flags.push({
        code: "RANGE_VARIES",
        message: lessRange
          ? `Your ${exercise.rangeNoun} decreased compared with your previous reps (less range of motion).`
          : `This rep had more range of motion than your previous reps.`,
        source: "estimated",
      });
    }
  }

  return flags;
}

/** Drop form signals seen in too few of the rep's frames to judge. */
export function withEvidence(stats: FormStats, minEvidence = DEFAULT_FORM_ANALYZER_CONFIG.minEvidence): FormStats {
  const out: FormStats = {};
  for (const [k, v] of Object.entries(stats)) if (v.coverage >= minEvidence) out[k] = v;
  return out;
}

function statValue(s: FormStats[string] | undefined, stat: PersonalCheck["stat"]): number | null {
  if (!s) return null;
  return stat === "min" ? s.min : stat === "max" ? s.max : s.max - s.min;
}

/**
 * Compare this rep with the user's own earlier reps instead of a fixed angle.
 * Needs `minReps` earlier reps where the signal was seen. Estimated, because
 * it's a comparison that assumes the earlier reps were representative.
 */
export function personalFlags(
  checks: readonly PersonalCheck[],
  stats: FormStats,
  history: readonly FormStats[],
  minReps = DEFAULT_FORM_ANALYZER_CONFIG.minRepsForConsistency,
): FormFlag[] {
  const flags: FormFlag[] = [];
  for (const check of checks) {
    const current = statValue(stats[check.signal], check.stat);
    if (current === null) continue;
    const past = history.map((h) => statValue(h[check.signal], check.stat)).filter((v): v is number => v !== null);
    if (past.length < minReps) continue;
    const base = median(past);
    const delta = check.worse === "higher" ? current - base : base - current;
    if (delta > check.tolerance) flags.push({ code: check.code, message: check.message(delta), source: "estimated" });
  }
  return flags;
}

/** Convert a validated rep into the shared RepEvent shape. */
export function toRepEvent(
  exercise: ExerciseDefinition,
  rep: CompletedRep,
  formFlags: FormFlag[],
  view: "side" | "front" = "side",
): RepEvent {
  return {
    view,
    exercise: exercise.id,
    repNumber: rep.repNumber,
    startedAt: rep.startedAt,
    endedAt: rep.endedAt,
    durationMs: rep.durationMs,
    primaryJoint: exercise.primaryJoint,
    peakAngle: { value: round1(rep.peakAngle), unit: "deg", source: "measured" },
    fullRange: true,
    formFlags,
  };
}

const GENERIC_REJECTIONS = {
  PARTIAL_RANGE: {
    code: "PARTIAL_RANGE",
    message: "Not counted: that wasn't a full range of motion.",
    spoken: "Not counted. Use the full range.",
  },
  PROGRESS_NOT_MET: {
    code: "PARTIAL_RANGE",
    message: "Not counted: that wasn't a full range of motion.",
    spoken: "Not counted. Use the full range.",
  },
  TOO_FAST: {
    code: "REP_TOO_FAST",
    message: "Not counted: that rep was too quick to be a full rep.",
    spoken: "Not counted. Too quick.",
  },
  TOO_SLOW: {
    code: "REP_TOO_SLOW",
    message: "Not counted: that rep took too long. Did you pause mid-rep?",
    spoken: "Not counted. That took too long.",
  },
  TRACKING_LOST: {
    code: "TRACKING_LOST",
    message: "Not counted: I lost sight of you. Keep the joints I'm tracking in frame.",
    spoken: "Not counted. I lost sight of you.",
  },
} as const;

/** User-facing explanation for a rep that was not counted. Always measured. */
export function describeRejection(exercise: ExerciseDefinition, rejected: RejectedRep): FormFlag {
  const t = exercise.rejections[rejected.reason] ?? GENERIC_REJECTIONS[rejected.reason];
  return { code: t.code, message: t.message, source: "measured" };
}

/** Spoken text for any flag code this exercise can produce (rejections and form flags). */
export function spokenFor(exercise: ExerciseDefinition, code: string): string | null {
  for (const t of [...Object.values(exercise.rejections), ...Object.values(GENERIC_REJECTIONS)]) {
    if (t && t.code === code) return t.spoken;
  }
  return exercise.spoken[code] ?? null;
}

/**
 * Session summary.
 * @param trackingQuality fraction (0–1) of frames where the counting joints
 *   were visible; it scales the confidence of the estimated metrics.
 */
export function summarizeSession(
  reps: readonly CompletedRep[],
  trackingQuality: number,
  exercise?: ExerciseDefinition,
): WorkoutSession["summary"] {
  if (reps.length === 0) return null;

  const durations = reps.map((r) => r.durationMs);
  const peaks = reps.map((r) => r.peakAngle);
  const avgDuration = mean(durations);
  // Consistency needs several reps to mean anything; confidence reflects that.
  const sampleConfidence = Math.min(1, (reps.length - 1) / 4);
  const confidence = round2(clamp01(trackingQuality) * sampleConfidence);

  return {
    totalReps: reps.length,
    avgRepDurationMs: { value: Math.round(avgDuration), unit: "ms", source: "measured" },
    // Coefficient of variation of rep duration, %. Lower = more consistent.
    tempoConsistency: estimated(avgDuration > 0 ? (stdDev(durations) / avgDuration) * 100 : 0, "%", confidence),
    // Standard deviation of the peak angle, degrees. Lower = more consistent.
    rangeConsistency: estimated(stdDev(peaks), "deg", confidence),
    insights: exercise ? sessionInsights(exercise, reps) : [],
  };
}

export interface InsightConfig {
  /** Reps needed before "inconsistent" is judged. */
  minRepsForInconsistency: number;
  /** Peak-angle standard deviation (°) above which range counts as inconsistent. */
  inconsistentRangeDeg: number;
  /** Reps needed to compare the start and end of a set. */
  minRepsForTrend: number;
  /** Range lost (°) between the first and last three reps to call it a decline. */
  rangeDeclineDeg: number;
  /** Ratio of last-three to first-three median duration to call it slowing. */
  slowdownRatio: number;
}

export const DEFAULT_INSIGHT_CONFIG: Readonly<InsightConfig> = Object.freeze({
  minRepsForInconsistency: 4,
  inconsistentRangeDeg: 8,
  minRepsForTrend: 6,
  rangeDeclineDeg: 10,
  slowdownRatio: 1.4,
});

/** Set-level observations. Estimated: they assume the tracking was steady across the set. */
export function sessionInsights(
  exercise: ExerciseDefinition,
  reps: readonly CompletedRep[],
  config: Partial<InsightConfig> = {},
): FormFlag[] {
  const c = { ...DEFAULT_INSIGHT_CONFIG, ...config };
  const out: FormFlag[] = [];
  const peaks = reps.map((r) => r.peakAngle);
  if (reps.length >= c.minRepsForInconsistency) {
    const sd = stdDev(peaks);
    if (sd > c.inconsistentRangeDeg) {
      out.push({
        code: "RANGE_INCONSISTENT",
        message: `Your ${exercise.rangeNoun} was inconsistent across the set (varied by about ±${Math.round(sd)}°).`,
        source: "estimated",
      });
    }
  }
  if (reps.length >= c.minRepsForTrend) {
    const first = reps.slice(0, 3);
    const last = reps.slice(-3);
    const firstPeak = median(first.map((r) => r.peakAngle));
    const lastPeak = median(last.map((r) => r.peakAngle));
    // "Lost range" = the peak moved back toward the start position.
    const lost = exercise.counter.direction === "decreasing" ? lastPeak - firstPeak : firstPeak - lastPeak;
    if (lost > c.rangeDeclineDeg) {
      out.push({
        code: "RANGE_DECLINED",
        message: `Your range of motion dropped over the set: your last reps were about ${Math.round(lost)}° shorter than your first.`,
        source: "estimated",
      });
    }
    const firstDur = median(first.map((r) => r.durationMs));
    const lastDur = median(last.map((r) => r.durationMs));
    if (firstDur > 0 && lastDur / firstDur > c.slowdownRatio) {
      out.push({
        code: "TEMPO_SLOWED",
        message: "Your reps slowed down noticeably towards the end of the set, a sign of fatigue.",
        source: "estimated",
      });
    }
  }
  return out;
}

export type CameraView = "side" | "front" | "unknown";

export interface CameraViewAssessment {
  view: CameraView;
  /** 0–1. This is always a heuristic (estimated). */
  confidence: number;
  /** Shoulder width ÷ torso length; small when side-on. null if not visible. */
  ratio: number | null;
}

/** Ratio thresholds shared by the per-frame check and the tracker's smoothed one. */
export function classifyViewRatio(ratio: number): CameraView {
  return ratio < 0.35 ? "side" : ratio > 0.6 ? "front" : "unknown";
}

/**
 * Heuristic: side-on, the shoulders overlap so their horizontal spread is small
 * relative to torso length; facing the camera, it's large. Only works upright
 * (for push-ups the torso is horizontal and this returns "unknown").
 */
export function assessCameraView(
  landmarks: readonly LandmarkLike[],
  aspectRatio = 1,
  minVisibility = 0.5,
): CameraViewAssessment {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP];
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP];
  const unknown: CameraViewAssessment = { view: "unknown", confidence: 0, ratio: null };
  if (!ls || !rs || !lh || !rh) return unknown;

  const v = (p: LandmarkLike) => p.visibility ?? 0;
  const all = Math.min(v(ls), v(rs), v(lh), v(rh));
  // Side-on, the far shoulder/hip is often occluded, so use the better pair.
  const bestPair = Math.max(Math.min(v(ls), v(lh)), Math.min(v(rs), v(rh)));
  if (bestPair < minVisibility) return unknown;

  const midShoulder = { x: ((ls.x + rs.x) / 2) * aspectRatio, y: (ls.y + rs.y) / 2 };
  const midHip = { x: ((lh.x + rh.x) / 2) * aspectRatio, y: (lh.y + rh.y) / 2 };
  // Upright check: torso must be closer to vertical than horizontal.
  if (Math.abs(midShoulder.y - midHip.y) < Math.abs(midShoulder.x - midHip.x)) return unknown;
  const torso = Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y);
  if (torso < 1e-6) return unknown;

  const ratio = (Math.abs(ls.x - rs.x) * aspectRatio) / torso;
  const base = round2(clamp01(Math.max(all, bestPair * 0.8)));
  const view = classifyViewRatio(ratio);
  return { view, confidence: view === "unknown" ? round2(base * 0.5) : base, ratio };
}

const VIEW_WARNINGS: Record<"side" | "front", FormFlag> = {
  side: {
    code: "CAMERA_NOT_SIDE_ON",
    message: "Turn side on to the camera so your joint angles can be read accurately.",
    source: "estimated",
  },
  front: {
    code: "CAMERA_NOT_FRONT_ON",
    message: "Face the camera so both arms can be tracked.",
    source: "estimated",
  },
};

/** Warning when the camera view doesn't match what the exercise needs. */
export function cameraViewFlag(
  assessment: CameraViewAssessment,
  wanted: "side" | "front",
  alsoOk: readonly ("side" | "front")[] = [],
): FormFlag | null {
  if (assessment.confidence < 0.5 || assessment.view === "unknown") return null;
  if (assessment.view === wanted || alsoOk.includes(assessment.view)) return null;
  return VIEW_WARNINGS[wanted];
}

export const VIEW_SPOKEN: Record<string, string> = {
  CAMERA_NOT_SIDE_ON: "Turn side on to the camera.",
  CAMERA_NOT_FRONT_ON: "Face the camera.",
};

// ---- small stats helpers -------------------------------------------------

function estimated(value: number, unit: string, confidence: number): Metric {
  return { value: round1(value), unit, source: "estimated", confidence };
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
