/**
 * Deadlift (conventional, from the floor), side view.
 *
 * Counted on the hip angle (shoulder–hip–knee) of the side the camera sees
 * best. A rep starts in the set-up position at the bottom, reaches lockout
 * (hips straight), and is counted when the bar is back on the floor, which is
 * why the counter runs in the "increasing" direction with the start at the
 * bottom. Progress = how far the shoulders rise above the set-up position.
 *
 * Romanian deadlifts (starting standing) aren't supported: the last rep would
 * end at lockout and never be counted.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { facingSign, torsoLean } from "../body_metrics";
import { POSE_LANDMARKS as L, distance, pickSide, vis } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading, FormSeries } from "./types";

/**
 * When each joint finishes extending on the way up: the first time the hip
 * angle and the knee angle each reach 90% of their extension for the pull.
 * Positive `kneeLeadMs` = the knees straightened before the hips (the "hips
 * shoot up" pattern); near zero = hips and knees extended together. Measured,
 * not judged: there's no validated threshold for how much lead is a fault.
 */
export function extensionTiming(series: FormSeries): { kneeLeadMs: number } | null {
  const pull = series.filter((f) => f.phase === "toward_peak" || f.phase === "peak");
  const reach = (key: "hipAngle" | "kneeAngle") => {
    const pts = pull.flatMap((f) => (f.form[key] == null ? [] : [{ t: f.t, v: f.form[key]! }]));
    if (pts.length < 5) return null;
    const lo = Math.min(...pts.map((p) => p.v));
    const hi = Math.max(...pts.map((p) => p.v));
    if (hi - lo < 15) return null; // barely moved: nothing to time
    return pts.find((p) => p.v >= lo + 0.9 * (hi - lo))?.t ?? null;
  };
  const hipT = reach("hipAngle");
  const kneeT = reach("kneeAngle");
  return hipT === null || kneeT === null ? null : { kneeLeadMs: Math.round(hipT - kneeT) };
}

const SIDES = {
  left: { shoulder: L.LEFT_SHOULDER, hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE },
  right: { shoulder: L.RIGHT_SHOULDER, hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE },
} as const;

/** Leaning back further than this past vertical at lockout is flagged. */
export const LOCKOUT_LEAN_BACK_MAX_DEG = 15;

export const deadlift: ExerciseDefinition = {
  id: "deadlift",
  name: "Deadlift",
  primaryJoint: "hip",
  cameraView: "side",
  rangeNoun: "lockout",
  setupInstructions:
    "Stand side on to the camera, about two to three metres back, with your whole body and the bar in view. " +
    "Then set up over the bar to begin.",
  startPrompt: "Set up over the bar to begin.",
  readyPrompt: "Ready. Pull.",
  phaseLabels: { start: "set up", toward_peak: "pulling", peak: "locked out", returning: "lowering" },
  counter: {
    direction: "increasing",
    // Set-up position: hips bent ≈ 60–110° depending on limb proportions.
    startAngle: 115,
    leaveStartAngle: 125,
    // Lockout: hips straight ≈ 165–180°.
    peakAngle: 165,
    hysteresis: 8,
    partialAngle: 145,
    minRepDurationMs: 800,
    maxRepDurationMs: 15_000,
    trackingLossTimeoutMs: 700,
    // Shoulders must rise ≥ 30% of torso length above the set-up position.
    minProgress: 0.3,
  },
  loweringPhase: "return",
  progress: { label: "Shoulders raised", hint: "% of torso length" },
  calibrationGuide: "Set-up ≈ 60–110°; lockout ≈ 165–180° with shoulders raised 40%+.",

  read(landmarks, { aspectRatio, minVisibility, preferredSide }) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { torsoLean: null, hipAngle: null, kneeAngle: null },
      side: null,
      highlight: [],
      positionHint: null,
      view: "side",
    };
    if (!landmarks || landmarks.length < 33) return none;
    const side = pickSide(
      landmarks,
      {
        left: [L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE],
        right: [L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE],
      },
      minVisibility,
      preferredSide,
    );
    if (!side) return none;
    const i = SIDES[side];
    const shoulder = landmarks[i.shoulder]!;
    const hip = landmarks[i.hip]!;
    const knee = landmarks[i.knee]!;
    const ankle = landmarks[i.ankle];
    const hipAngle = calculateAngle(shoulder, hip, knee, aspectRatio);
    const kneeAngle = ankle && vis(ankle) >= minVisibility ? calculateAngle(hip, knee, ankle, aspectRatio) : null;
    const torso = distance(shoulder, hip, aspectRatio);
    const facing = facingSign(landmarks, side, minVisibility);
    return {
      visible: hipAngle !== null,
      primaryAngle: hipAngle,
      // The drop meter measures movement *down* from the start; negate y so a
      // rise of the shoulders reads as positive progress.
      progress: torso > 1e-6 ? { kind: "drop", y: -shoulder.y, refLength: torso } : null,
      // Signed lean needs the facing direction (from the foot); without it, skip.
      form: {
        torsoLean: facing === null ? null : torsoLean(shoulder, hip, aspectRatio, facing),
        hipAngle,
        kneeAngle,
      },
      side,
      highlight: [i.shoulder, i.hip, i.knee, i.ankle],
      positionHint: null,
      view: "side",
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "NO_LOCKOUT",
      message: "Not counted: stand all the way up and lock your hips out at the top.",
      spoken: "Not counted. Lock out at the top.",
    },
    PROGRESS_NOT_MET: {
      code: "BAR_NOT_LIFTED",
      message: "Not counted: your hips moved but your shoulders didn't rise. Lift the bar all the way up.",
      spoken: "Not counted. Stand all the way up.",
    },
  },

  formChecks(_rep, stats) {
    const flags: FormFlag[] = [];
    const top = stats["torsoLean@peak"];
    if (top && top.min < -LOCKOUT_LEAN_BACK_MAX_DEG) {
      flags.push({
        code: "LEANING_BACK",
        message: "You leaned back at the top. Finish standing tall, hips under shoulders.",
        source: "measured",
      });
    }
    return flags;
  },

  personalChecks: [
    {
      signal: "torsoLean@toward_peak",
      stat: "range",
      worse: "higher",
      tolerance: 12,
      code: "TORSO_SHIFT",
      message: (d) =>
        `Your torso angle changed about ${Math.round(d)}° more than usual on the way up. Let hips and shoulders rise together.`,
    },
  ],

  // Measured per rep. No fault labels: no available dataset has validated
  // deadlift error labels we can train or check thresholds against.
  repMetrics(stats, series) {
    const m: Record<string, { value: number; unit: string; source: "measured" }> = {};
    const deg = (v: number) => ({ value: Math.round(v), unit: "deg", source: "measured" as const });
    if (stats.hipAngle) {
      m.hipAngleSetup = deg(stats.hipAngle.min);
      m.hipAngleLockout = deg(stats.hipAngle.max);
    }
    if (stats.kneeAngle) {
      m.kneeAngleSetup = deg(stats.kneeAngle.min);
      m.kneeAngleLockout = deg(stats.kneeAngle.max);
    }
    if (stats.torsoLean) m.torsoAngleChange = deg(stats.torsoLean.max - stats.torsoLean.min);
    const timing = extensionTiming(series);
    if (timing) m.kneeLeadMs = { value: timing.kneeLeadMs, unit: "ms", source: "measured" };
    return m;
  },

  spoken: {
    FAST_LOWERING: "Lower the bar under control.",
    LEANING_BACK: "Don't lean back at the top.",
    TORSO_SHIFT: "Hips and shoulders rise together.",
  },
};
