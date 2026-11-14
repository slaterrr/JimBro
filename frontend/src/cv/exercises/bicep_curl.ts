/**
 * Bicep curl.
 *
 * Side view: counted on the elbow angle (shoulder–elbow–wrist) of the arm
 * nearest the camera; the far arm is hidden behind the body.
 *
 * Front view (needed for alternating curls): both arms are tracked with the
 * model's 3D estimate (a curling forearm points at the camera, so a 2D angle
 * from the front is unreliable). The more-bent arm drives the counter, so each
 * arm's curl counts in alternating sets and a simultaneous curl counts once.
 * Each rep records how far each arm moved, which is how alternating,
 * simultaneous and single-arm sets are told apart.
 */

import type { FormFlag, RepEvent } from "../../../../shared/types";
import { calculateAngle, calculateAngle3D } from "../angle_calculator";
import { POSE_LANDMARKS as L, pickSide, vis, type LandmarkLike, type WorldLandmarkLike } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading, ReadOptions } from "./types";

const SIDES = {
  left: { shoulder: L.LEFT_SHOULDER, elbow: L.LEFT_ELBOW, wrist: L.LEFT_WRIST, hip: L.LEFT_HIP },
  right: { shoulder: L.RIGHT_SHOULDER, elbow: L.RIGHT_ELBOW, wrist: L.RIGHT_WRIST, hip: L.RIGHT_HIP },
} as const;

/** Upper arm moving further than this from the torso during a rep is flagged. */
const ELBOW_DRIFT_MAX_DEG = 35;
/** Torso lean changing by more than this during a rep is flagged as swinging. */
const BODY_SWING_MAX_DEG = 15;
/** An arm whose elbow angle changed at least this much in a rep did the curl. */
export const ARM_ACTIVE_DEG = 50;
/** An arm that changed less than this was still. */
export const ARM_STILL_DEG = 25;

const NONE_FORM = { elbowDrift: null, torsoLean: null, leftElbow: null, rightElbow: null };

function readSide(landmarks: readonly LandmarkLike[], o: ReadOptions, none: ExerciseReading): ExerciseReading {
  const side = pickSide(
    landmarks,
    { left: [L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST], right: [L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST] },
    o.minVisibility,
    o.preferredSide,
  );
  if (!side) return none;
  const i = SIDES[side];
  const shoulder = landmarks[i.shoulder]!;
  const elbow = landmarks[i.elbow]!;
  const wrist = landmarks[i.wrist]!;
  const hip = landmarks[i.hip];
  const elbowAngle = calculateAngle(shoulder, elbow, wrist, o.aspectRatio);
  let elbowDrift: number | null = null;
  let torsoLean: number | null = null;
  if (hip && vis(hip) >= o.minVisibility) {
    // Angle between upper arm and torso, at the shoulder.
    elbowDrift = calculateAngle(hip, shoulder, elbow, o.aspectRatio);
    // Torso lean from vertical, signed (only the change matters).
    torsoLean = (Math.atan2((shoulder.x - hip.x) * o.aspectRatio, hip.y - shoulder.y) * 180) / Math.PI;
  }
  return {
    ...none,
    visible: elbowAngle !== null,
    primaryAngle: elbowAngle,
    form: { ...NONE_FORM, elbowDrift, torsoLean, [side === "left" ? "leftElbow" : "rightElbow"]: elbowAngle },
    side,
    highlight: [i.shoulder, i.elbow, i.wrist],
  };
}

function readFront(
  landmarks: readonly LandmarkLike[],
  world: readonly WorldLandmarkLike[],
  o: ReadOptions,
  none: ExerciseReading,
): ExerciseReading {
  const arm = (side: "left" | "right") => {
    const i = SIDES[side];
    if ([i.shoulder, i.elbow, i.wrist].some((k) => vis(landmarks[k]) < o.minVisibility)) return null;
    const elbow = calculateAngle3D(world[i.shoulder]!, world[i.elbow]!, world[i.wrist]!);
    const drift = calculateAngle3D(world[i.hip]!, world[i.shoulder]!, world[i.elbow]!);
    return elbow === null ? null : { elbow, drift };
  };
  const left = arm("left");
  const right = arm("right");
  if (!left && !right) return { ...none, view: "front", positionHint: "Keep your arms in view, from shoulders to hands." };
  const angles = [left?.elbow, right?.elbow].filter((v): v is number => v != null);
  const drifts = [left?.drift, right?.drift].filter((v): v is number => v != null);
  return {
    ...none,
    view: "front",
    visible: true,
    // The more-bent arm drives the count: alternating reps each count.
    primaryAngle: Math.min(...angles),
    form: {
      ...NONE_FORM,
      elbowDrift: drifts.length ? Math.max(...drifts) : null,
      leftElbow: left?.elbow ?? null,
      rightElbow: right?.elbow ?? null,
    },
    side: left && right ? "both" : left ? "left" : "right",
    highlight: [
      ...(left ? [L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST] : []),
      ...(right ? [L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST] : []),
    ],
  };
}

/** Which arm(s) did a rep, from its per-arm range metrics. */
export function armsUsed(rep: RepEvent): "left" | "right" | "both" | null {
  const l = rep.metrics.leftArmRange?.value;
  const r = rep.metrics.rightArmRange?.value;
  if (l === undefined || r === undefined) return null;
  if (l >= ARM_ACTIVE_DEG && r >= ARM_ACTIVE_DEG) return "both";
  if (l >= ARM_ACTIVE_DEG && r < ARM_STILL_DEG) return "left";
  if (r >= ARM_ACTIVE_DEG && l < ARM_STILL_DEG) return "right";
  return null;
}

/** Set style from the reps: alternating, simultaneous or single-arm. Needs 4+ classifiable reps. */
export function curlStyle(reps: readonly RepEvent[]): "alternating" | "simultaneous" | "single-arm" | null {
  const used = reps.map(armsUsed).filter((u): u is NonNullable<typeof u> => u !== null);
  if (used.length < 4) return null;
  const both = used.filter((u) => u === "both").length;
  if (both / used.length >= 0.75) return "simultaneous";
  const single = used.filter((u) => u !== "both");
  if (single.length / used.length < 0.75) return null;
  if (new Set(single).size === 1) return "single-arm";
  let switches = 0;
  for (let i = 1; i < single.length; i++) if (single[i] !== single[i - 1]) switches += 1;
  return switches / (single.length - 1) >= 0.75 ? "alternating" : null;
}

export const bicepCurl: ExerciseDefinition = {
  id: "bicep_curl",
  name: "Bicep curl",
  primaryJoint: "elbow",
  cameraView: "side",
  otherViews: ["front"],
  rangeNoun: "curl range",
  setupInstructions:
    "Stand side on to the camera, with the arm you're curling nearest to it, and your upper body in view. " +
    "For alternating curls, face the camera instead. Then let your arms hang straight to begin.",
  startPrompt: "Let your arm hang straight to begin.",
  readyPrompt: "Ready. Start curling.",
  phaseLabels: { start: "arm down", toward_peak: "curling up", peak: "top", returning: "lowering" },
  counter: {
    direction: "decreasing",
    startAngle: 145,
    leaveStartAngle: 135,
    // Fully curled ≈ 40–60°.
    peakAngle: 65,
    hysteresis: 10,
    partialAngle: 100,
    minRepDurationMs: 600,
    maxRepDurationMs: 12_000,
    trackingLossTimeoutMs: 700,
    minProgress: 0,
  },
  loweringPhase: "return",
  progress: null,
  calibrationGuide: "Half curl ≈ 90–100°; full curl ≈ 40–60°.",

  read(landmarks, o) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { ...NONE_FORM },
      side: null,
      highlight: [],
      positionHint: null,
      view: "side",
    };
    if (!landmarks || landmarks.length < 33) return none;
    return o.view === "front" && o.world && o.world.length >= 33
      ? readFront(landmarks, o.world, o, none)
      : readSide(landmarks, o, none);
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "INCOMPLETE_CURL",
      message: "Not counted: curl all the way up, and lower all the way down.",
      spoken: "Not counted. Curl all the way up.",
    },
  },

  formChecks(_rep, stats, view) {
    const flags: FormFlag[] = [];
    // The drift threshold was set for a side view (2D); front-on it's a 3D
    // estimate, so it's only measured there, not flagged.
    if (view !== "front" && stats.elbowDrift && stats.elbowDrift.max > ELBOW_DRIFT_MAX_DEG) {
      flags.push({
        code: "ELBOW_DRIFT",
        message: "Your elbow moved forward. Keep it pinned to your side.",
        source: "measured",
      });
    }
    if (stats.torsoLean && stats.torsoLean.max - stats.torsoLean.min > BODY_SWING_MAX_DEG) {
      flags.push({
        code: "BODY_SWING",
        message: "You swung your body. Keep your torso still and let your arm do the work.",
        source: "measured",
      });
    }
    return flags;
  },

  repMetrics(stats) {
    const m: Record<string, { value: number; unit: string; source: "measured" }> = {};
    const deg = (v: number) => ({ value: Math.round(v), unit: "deg", source: "measured" as const });
    if (stats.elbowDrift) m.upperArmMovement = deg(stats.elbowDrift.max - stats.elbowDrift.min);
    if (stats.leftElbow) m.leftArmRange = deg(stats.leftElbow.max - stats.leftElbow.min);
    if (stats.rightElbow) m.rightArmRange = deg(stats.rightElbow.max - stats.rightElbow.min);
    return m;
  },

  sessionInsights(reps) {
    const style = curlStyle(reps);
    if (!style) return [];
    const perArm = (a: "left" | "right") => reps.filter((r) => armsUsed(r) === a).length;
    const text = {
      alternating: `Alternating curls: ${perArm("left")} left, ${perArm("right")} right.`,
      simultaneous: "Both arms curled together.",
      "single-arm": "Single-arm curls.",
    }[style];
    return [{ code: `CURL_STYLE_${style.toUpperCase().replace("-", "_")}`, message: text, source: "measured" }];
  },

  personalChecks: [
    {
      signal: "elbowDrift",
      stat: "max",
      worse: "higher",
      tolerance: 12,
      code: "ELBOW_DRIFT_VS_USUAL",
      message: (d) => `Your elbow moved about ${Math.round(d)}° further forward than on your usual reps.`,
    },
  ],

  spoken: {
    FAST_LOWERING: "Lower the weight slowly.",
    ELBOW_DRIFT: "Keep your elbow by your side.",
    BODY_SWING: "Don't swing. Keep your body still.",
  },
};
