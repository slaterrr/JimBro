/**
 * Per-rep form flags, per-session summary metrics, and a camera-view check.
 *
 * What a single camera can and can't tell us
 * ------------------------------------------
 * MEASURED (directly observed, from a side-on view):
 *   - rep count, rep / phase durations (timestamps of threshold crossings)
 *   - minimum knee angle and whether it crossed the depth threshold
 * ESTIMATED (inferred; carries a confidence value):
 *   - tempo and depth consistency across reps (depend on tracking quality)
 *   - whether the camera is side-on (heuristic from landmark geometry)
 * NOT CLAIMED (not reliably observable here, so never reported):
 *   - knee valgus / knees caving in (needs a front view, and is unreliable in 2D)
 *   - spinal neutrality / back rounding, weight distribution, bar path, load
 */

import type { FormFlag, Metric, RepEvent, WorkoutSession } from "../../../shared/types";
import type { CompletedRep, RejectedRep } from "./rep_counter";
import { POSE_LANDMARKS, type LandmarkLike } from "./pose_detection";

export interface FormAnalyzerConfig {
  /** Descents faster than this get a FAST_DESCENT flag. */
  fastDescentMs: number;
  /** Relative deviation from the median duration that counts as uneven tempo. */
  tempoOutlierRatio: number;
  /** Degrees from the median bottom angle that counts as inconsistent depth. */
  depthOutlierDeg: number;
  /** Previous reps needed before consistency flags are raised. */
  minRepsForConsistency: number;
}

export const DEFAULT_FORM_ANALYZER_CONFIG: Readonly<FormAnalyzerConfig> = Object.freeze({
  fastDescentMs: 400,
  tempoOutlierRatio: 0.35,
  depthOutlierDeg: 15,
  minRepsForConsistency: 3,
});

/** Flags for one rep, compared against the reps before it. */
export function analyzeRep(
  rep: CompletedRep,
  previous: readonly CompletedRep[],
  config: Partial<FormAnalyzerConfig> = {},
): FormFlag[] {
  const c = { ...DEFAULT_FORM_ANALYZER_CONFIG, ...config };
  const flags: FormFlag[] = [];

  if (rep.descentMs < c.fastDescentMs) {
    flags.push({
      code: "FAST_DESCENT",
      message: `You dropped in ${Math.round(rep.descentMs)} ms. Try a slower, controlled descent.`,
      source: "measured",
    });
  }

  if (previous.length >= c.minRepsForConsistency) {
    const medianDuration = median(previous.map((r) => r.durationMs));
    if (medianDuration > 0 && Math.abs(rep.durationMs - medianDuration) / medianDuration > c.tempoOutlierRatio) {
      const faster = rep.durationMs < medianDuration;
      flags.push({
        code: "UNEVEN_TEMPO",
        message: `This rep was noticeably ${faster ? "faster" : "slower"} than your others.`,
        source: "estimated",
      });
    }

    const medianDepth = median(previous.map((r) => r.minKneeAngle));
    if (Math.abs(rep.minKneeAngle - medianDepth) > c.depthOutlierDeg) {
      const shallower = rep.minKneeAngle > medianDepth;
      flags.push({
        code: "DEPTH_VARIES",
        message: `This rep was ${shallower ? "shallower" : "deeper"} than your others.`,
        source: "estimated",
      });
    }
  }

  return flags;
}

/** Convert a validated rep into the shared RepEvent shape. */
export function toRepEvent(rep: CompletedRep, formFlags: FormFlag[]): RepEvent {
  return {
    repNumber: rep.repNumber,
    startedAt: rep.startedAt,
    endedAt: rep.endedAt,
    durationMs: rep.durationMs,
    minKneeAngle: { value: round1(rep.minKneeAngle), unit: "deg", source: "measured" },
    depthReached: true,
    formFlags,
  };
}

/** User-facing explanation for a rep that was not counted. Always measured. */
export function describeRejection(rejected: RejectedRep): FormFlag {
  switch (rejected.reason) {
    case "SHALLOW_DEPTH":
      return {
        code: "SHALLOW_DEPTH",
        message: "Not counted: you didn't reach the depth line. Go a little lower.",
        source: "measured",
      };
    case "NO_HIP_DROP":
      return {
        code: "NO_HIP_DROP",
        message: "Not counted: your knee bent but your hips didn't go down. Keep both feet down and sit your hips back.",
        source: "measured",
      };
    case "TOO_FAST":
      return {
        code: "REP_TOO_FAST",
        message: "Not counted: that rep was too quick to be a full squat.",
        source: "measured",
      };
    case "TOO_SLOW":
      return {
        code: "REP_TOO_SLOW",
        message: "Not counted: that rep took too long. Did you pause mid-rep?",
        source: "measured",
      };
    case "TRACKING_LOST":
      return {
        code: "TRACKING_LOST",
        message: "Not counted: I lost sight of your legs. Keep hips, knees and ankles in frame.",
        source: "measured",
      };
  }
}

/**
 * Session summary.
 * @param trackingQuality fraction (0–1) of frames where the legs were visible;
 *   it scales the confidence of the estimated metrics.
 */
export function summarizeSession(
  reps: readonly CompletedRep[],
  trackingQuality: number,
): WorkoutSession["summary"] {
  if (reps.length === 0) return null;

  const durations = reps.map((r) => r.durationMs);
  const depths = reps.map((r) => r.minKneeAngle);
  const avgDuration = mean(durations);
  // Consistency needs several reps to mean anything; confidence reflects that.
  const sampleConfidence = Math.min(1, (reps.length - 1) / 4);
  const confidence = round2(clamp01(trackingQuality) * sampleConfidence);

  return {
    totalReps: reps.length,
    avgRepDurationMs: { value: Math.round(avgDuration), unit: "ms", source: "measured" },
    // Coefficient of variation of rep duration, %. Lower = more consistent.
    tempoConsistency: estimated(avgDuration > 0 ? (stdDev(durations) / avgDuration) * 100 : 0, "%", confidence),
    // Standard deviation of the bottom knee angle, degrees. Lower = more consistent.
    depthConsistency: estimated(stdDev(depths), "deg", confidence),
  };
}

export type CameraView = "side" | "front" | "unknown";

export interface CameraViewAssessment {
  view: CameraView;
  /** 0–1. This is always a heuristic (estimated). */
  confidence: number;
  /** Shoulder width ÷ torso length; small when side-on. null if not visible. */
  ratio: number | null;
}

/**
 * Heuristic: side-on, the shoulders overlap so their horizontal spread is small
 * relative to torso length. Knee and hip angles are only trustworthy side-on.
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
  if (!ls || !rs || !lh || !rh) return { view: "unknown", confidence: 0, ratio: null };

  const vis = Math.min(ls.visibility ?? 0, rs.visibility ?? 0, lh.visibility ?? 0, rh.visibility ?? 0);
  // Side-on, the far shoulder/hip is often occluded, so use the better pair.
  const bestVis = Math.max(Math.min(ls.visibility ?? 0, lh.visibility ?? 0), Math.min(rs.visibility ?? 0, rh.visibility ?? 0));
  if (bestVis < minVisibility) return { view: "unknown", confidence: 0, ratio: null };

  const shoulderWidth = Math.abs(ls.x - rs.x) * aspectRatio;
  const midShoulder = { x: ((ls.x + rs.x) / 2) * aspectRatio, y: (ls.y + rs.y) / 2 };
  const midHip = { x: ((lh.x + rh.x) / 2) * aspectRatio, y: (lh.y + rh.y) / 2 };
  const torso = Math.hypot(midShoulder.x - midHip.x, midShoulder.y - midHip.y);
  if (torso < 1e-6) return { view: "unknown", confidence: 0, ratio: null };

  const ratio = shoulderWidth / torso;
  const base = round2(clamp01(Math.max(vis, bestVis * 0.8)));
  if (ratio < 0.35) return { view: "side", confidence: base, ratio };
  if (ratio > 0.6) return { view: "front", confidence: base, ratio };
  return { view: "unknown", confidence: round2(base * 0.5), ratio };
}

export function cameraViewFlag(assessment: CameraViewAssessment): FormFlag | null {
  if (assessment.view !== "front" || assessment.confidence < 0.5) return null;
  return {
    code: "CAMERA_NOT_SIDE_ON",
    message: "Turn side-on to the camera so knee and hip angles can be read accurately.",
    source: "estimated",
  };
}

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
