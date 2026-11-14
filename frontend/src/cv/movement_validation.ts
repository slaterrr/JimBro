/**
 * Exercise validation: does a completed rep look like the SELECTED exercise?
 *
 *   Camera → pose → reader (angles) → rep counter → movement validation → count + form feedback
 *
 * The counter says "a knee bent and straightened through the full range".
 * This layer looks at the whole rep (start → bottom → finish) and asks whether
 * the body moved like a squat, a lunge, etc., using several independent cues
 * rather than one angle rule:
 *
 *   split        how far apart the feet are front-to-back at the bottom
 *                (÷ leg length). From 3D world landmarks along the body's own
 *                forward axis, so it works from any camera angle; 2D side-view
 *                fallback when 3D is missing.
 *   hipAsymmetry difference between the two hip angles at the bottom (°).
 *                Squat: both hips fold about equally. Lunge: front hip folds,
 *                back hip stays open.
 *   footTravel   how much the front-to-back gap between the feet changed
 *                during the rep (÷ leg length): stepping out or back changes
 *                it, squatting doesn't. Measured foot-to-foot, so hips moving
 *                back in a squat (3D points are hip-centred) can't fake it.
 *
 * Each exercise turns these into a verdict with reasons: match, mismatch
 * (and what it looked like), or uncertain (not enough clean evidence). Only
 * a match is counted. Thresholds are a first explainable baseline, set from
 * movement geometry, and must be calibrated on recorded reps in the
 * validation lab before they're trusted.
 */

import type { ExerciseId } from "../../../shared/types";
import { calculateAngle } from "./angle_calculator";
import { POSE_LANDMARKS as L, vis, type LandmarkLike, type WorldLandmarkLike } from "./pose_detection";

export interface MovementFrame {
  t: number;
  /** Counter phase on this frame. */
  phase: "start" | "toward_peak" | "peak" | "returning";
  /** Counting angle (smoothed), to find the bottom of the rep. */
  angle: number | null;
  lm: readonly LandmarkLike[] | undefined;
  world: readonly WorldLandmarkLike[] | undefined;
  aspectRatio: number;
}

export interface MovementFeatures {
  split: number | null;
  hipAsymmetry: number | null;
  footTravel: number | null;
  /** Where the numbers came from. */
  source: "3d" | "2d" | "none";
  /** Frames in the rep, and frames where both legs could be measured. */
  frames: number;
  bothLegsFrames: number;
}

export type MovementVerdict =
  | { verdict: "match"; reasons: string[]; features: MovementFeatures }
  | { verdict: "mismatch"; looksLike: ExerciseId | "stepping" | "other"; reasons: string[]; features: MovementFeatures }
  | { verdict: "uncertain"; reasons: string[]; features: MovementFeatures };

/** Minimum fraction of the rep's frames where both legs were measurable. */
export const MIN_BOTH_LEGS = 0.5;
/** Legs are judged with a lower visibility bar than counting joints: MediaPipe still places a half-hidden far leg sensibly. */
const LEG_VIS = 0.35;

type V3 = { x: number; y: number; z: number };

function legsVisible(lm: readonly LandmarkLike[] | undefined): boolean {
  if (!lm || lm.length < 33) return false;
  return [L.LEFT_HIP, L.RIGHT_HIP, L.LEFT_KNEE, L.RIGHT_KNEE, L.LEFT_ANKLE, L.RIGHT_ANKLE].every((i) => vis(lm[i]) >= LEG_VIS);
}

/** Body axes from 3D world landmarks: left→right hip axis, and forward = up × hip axis (horizontal). */
function bodyAxes(w: readonly WorldLandmarkLike[]): { forward: V3; legLen: number } | null {
  const lh = w[L.LEFT_HIP]!;
  const rh = w[L.RIGHT_HIP]!;
  const ax = { x: rh.x - lh.x, y: 0, z: rh.z - lh.z };
  const n = Math.hypot(ax.x, ax.z);
  if (n < 1e-6) return null;
  // World y points down in MediaPipe; "forward" is perpendicular to the hip axis in the floor plane.
  const forward = { x: -ax.z / n, y: 0, z: ax.x / n };
  const leg = (h: V3, k: V3, a: V3) => Math.hypot(h.x - k.x, h.y - k.y, h.z - k.z) + Math.hypot(k.x - a.x, k.y - a.y, k.z - a.z);
  const legLen = (leg(lh, w[L.LEFT_KNEE]!, w[L.LEFT_ANKLE]!) + leg(rh, w[L.RIGHT_KNEE]!, w[L.RIGHT_ANKLE]!)) / 2;
  return legLen > 1e-6 ? { forward, legLen } : null;
}

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const angle3 = (a: V3, b: V3, c: V3) => {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const m = Math.sqrt(dot(u, u) * dot(v, v));
  return m < 1e-9 ? null : (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / m))) * 180) / Math.PI;
};

interface FrameMeasure {
  split: number;
  hipAsym: number | null;
  /** Ankle positions along the measuring axis (÷ leg length). */
  feet: [number, number];
}

function measure(f: MovementFrame): { m: FrameMeasure; source: "3d" | "2d" } | null {
  if (!legsVisible(f.lm)) return null;
  const w = f.world;
  if (w && w.length >= 33) {
    const axes = bodyAxes(w);
    if (axes) {
      const la = w[L.LEFT_ANKLE]!;
      const ra = w[L.RIGHT_ANKLE]!;
      const lf = dot(la, axes.forward) / axes.legLen;
      const rf = dot(ra, axes.forward) / axes.legLen;
      const lHip = angle3(w[L.LEFT_SHOULDER]!, w[L.LEFT_HIP]!, w[L.LEFT_KNEE]!);
      const rHip = angle3(w[L.RIGHT_SHOULDER]!, w[L.RIGHT_HIP]!, w[L.RIGHT_KNEE]!);
      return {
        m: { split: Math.abs(lf - rf), hipAsym: lHip !== null && rHip !== null ? Math.abs(lHip - rHip) : null, feet: [lf, rf] },
        source: "3d",
      };
    }
  }
  // 2D fallback: meaningful from a side view only (front-to-back = image x).
  const lm = f.lm!;
  const ar = f.aspectRatio;
  const legLen2 = (h: number, k: number, a: number) =>
    Math.hypot((lm[h]!.x - lm[k]!.x) * ar, lm[h]!.y - lm[k]!.y) + Math.hypot((lm[k]!.x - lm[a]!.x) * ar, lm[k]!.y - lm[a]!.y);
  const legLen = (legLen2(L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE) + legLen2(L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE)) / 2;
  if (legLen < 1e-6) return null;
  const lf = (lm[L.LEFT_ANKLE]!.x * ar) / legLen;
  const rf = (lm[L.RIGHT_ANKLE]!.x * ar) / legLen;
  const shoulderOk = vis(lm[L.LEFT_SHOULDER]) >= LEG_VIS && vis(lm[L.RIGHT_SHOULDER]) >= LEG_VIS;
  const lHip = shoulderOk ? calculateAngle(lm[L.LEFT_SHOULDER]!, lm[L.LEFT_HIP]!, lm[L.LEFT_KNEE]!, ar) : null;
  const rHip = shoulderOk ? calculateAngle(lm[L.RIGHT_SHOULDER]!, lm[L.RIGHT_HIP]!, lm[L.RIGHT_KNEE]!, ar) : null;
  return { m: { split: Math.abs(lf - rf), hipAsym: lHip !== null && rHip !== null ? Math.abs(lHip - rHip) : null, feet: [lf, rf] }, source: "2d" };
}

function rollingMedian(xs: readonly number[], window: number): number[] {
  const h = Math.floor(window / 2);
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - h), i + h + 1).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)]!;
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : null;
};

/**
 * Features over a whole rep. "Bottom" = the frames within 10° of the rep's
 * most extreme counting angle (or the peak phase), using medians so one bad
 * frame can't decide the verdict.
 */
export function movementFeatures(frames: readonly MovementFrame[], direction: "decreasing" | "increasing" = "decreasing"): MovementFeatures {
  const measured = frames.map((f) => ({ f, r: measure(f) }));
  const ok = measured.filter((x) => x.r !== null) as Array<{ f: MovementFrame; r: { m: FrameMeasure; source: "3d" | "2d" } }>;
  const base: MovementFeatures = { split: null, hipAsymmetry: null, footTravel: null, source: "none", frames: frames.length, bothLegsFrames: ok.length };
  if (ok.length === 0) return base;
  const source = ok.filter((x) => x.r.source === "3d").length >= ok.length / 2 ? "3d" : "2d";
  const usable = ok.filter((x) => x.r.source === source);

  const angles = usable.map((x) => x.f.angle).filter((a): a is number => a !== null);
  const extreme = angles.length ? (direction === "decreasing" ? Math.min(...angles) : Math.max(...angles)) : null;
  let bottom = usable.filter((x) => x.f.angle !== null && extreme !== null && Math.abs(x.f.angle - extreme) <= 10);
  if (bottom.length === 0) bottom = usable.filter((x) => x.f.phase === "peak");
  if (bottom.length === 0) bottom = usable;

  // Foot travel: change in the signed front-to-back gap between the feet
  // (foot-to-foot, independent of where the hips are), on a rolling median of
  // 7 frames so landmark jitter, especially in 3D depth, can't look like a step.
  const gaps = rollingMedian(
    usable.map((x) => x.r.m.feet[0] - x.r.m.feet[1]),
    7,
  );
  const startGap = gaps[Math.min(3, gaps.length - 1)]!;
  let travel = 0;
  for (const g of gaps) travel = Math.max(travel, Math.abs(g - startGap));

  return {
    split: median(bottom.map((x) => x.r.m.split)),
    hipAsymmetry: median(bottom.map((x) => x.r.m.hipAsym).filter((v): v is number => v !== null)),
    footTravel: travel,
    source,
    frames: frames.length,
    bothLegsFrames: ok.length,
  };
}

/** Thresholds for the baseline validators (fractions of leg length, degrees). Calibrate with recorded reps. */
export const VALIDATION_THRESHOLDS = {
  /** Feet this far apart front-to-back at the bottom is a split stance. */
  splitStance: 0.45,
  /** Hips differing this much at the bottom is lunge-like. */
  hipAsymmetry: 35,
  /** A foot moving this much during the rep means the user stepped. */
  footStep: 0.35,
  /** Below these, the stance is clearly squat-like (both feet level, hips symmetric). */
  squatSplitMax: 0.25,
  squatHipAsymMax: 20,
} as const;

function enoughEvidence(f: MovementFeatures, reasons: string[]): boolean {
  if (f.frames === 0 || f.bothLegsFrames / f.frames < MIN_BOTH_LEGS) {
    reasons.push(`both legs were measurable in only ${Math.round((f.bothLegsFrames / Math.max(1, f.frames)) * 100)}% of the rep`);
    return false;
  }
  if (f.split === null && f.hipAsymmetry === null) {
    reasons.push("no stance measurements");
    return false;
  }
  return true;
}

/**
 * Squat: counted only if the stance doesn't look like a lunge or a step.
 * Two lunge cues together (split stance + asymmetric hips, or + a step), or a
 * clear step on its own, = mismatch. One cue alone (e.g. a staggered stance)
 * is not enough to reject.
 */
export function validateSquat(f: MovementFeatures): MovementVerdict {
  const T = VALIDATION_THRESHOLDS;
  const reasons: string[] = [];
  if (!enoughEvidence(f, reasons)) return { verdict: "uncertain", reasons, features: f };
  const cues: string[] = [];
  if (f.split !== null && f.split >= T.splitStance) cues.push(`feet ${Math.round(f.split * 100)}% of leg length apart front-to-back`);
  if (f.hipAsymmetry !== null && f.hipAsymmetry >= T.hipAsymmetry) cues.push(`hips differed by ${Math.round(f.hipAsymmetry)}°`);
  const stepped = f.footTravel !== null && f.footTravel >= T.footStep;
  if (stepped) cues.push(`the feet moved ${Math.round(f.footTravel! * 100)}% of leg length apart or together (a step)`);

  if (stepped && f.footTravel! >= T.footStep * 2 && cues.length === 1) {
    return { verdict: "mismatch", looksLike: "stepping", reasons: cues, features: f };
  }
  if (cues.length >= 2) return { verdict: "mismatch", looksLike: "lunge", reasons: cues, features: f };
  return { verdict: "match", reasons: cues.length ? [`only one lunge-like cue (${cues[0]})`] : ["feet level and hips symmetric"], features: f };
}

/**
 * Lunge: counted only with a split stance or clearly asymmetric hips at the
 * bottom. Feet together with symmetric hips = it was a squat.
 */
export function validateLunge(f: MovementFeatures): MovementVerdict {
  const T = VALIDATION_THRESHOLDS;
  const reasons: string[] = [];
  if (!enoughEvidence(f, reasons)) return { verdict: "uncertain", reasons, features: f };
  const split = f.split !== null && f.split >= T.splitStance;
  const asym = f.hipAsymmetry !== null && f.hipAsymmetry >= T.hipAsymmetry;
  if (split || asym) {
    return { verdict: "match", reasons: [split ? "split stance" : "", asym ? "asymmetric hips" : ""].filter(Boolean), features: f };
  }
  const squatLike =
    (f.split === null || f.split <= T.squatSplitMax) && (f.hipAsymmetry === null || f.hipAsymmetry <= T.squatHipAsymMax);
  if (squatLike) return { verdict: "mismatch", looksLike: "squat", reasons: ["feet level and hips symmetric at the bottom"], features: f };
  return { verdict: "uncertain", reasons: ["stance between a squat and a lunge"], features: f };
}
