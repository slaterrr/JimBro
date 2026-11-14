/**
 * Lunge (forward, reverse or split squat), side view. Counted on the knee angle
 * of the leg the camera sees best (both knees bend to about 90° at the bottom),
 * plus hip drop below standing height. Also checks the step is long enough to
 * be a lunge and that the torso stays upright.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { torsoLean } from "../body_metrics";
import { POSE_LANDMARKS as L, distance, pickSide, vis } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading } from "./types";

const LEGS = {
  left: { shoulder: L.LEFT_SHOULDER, hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE },
  right: { shoulder: L.RIGHT_SHOULDER, hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE },
} as const;

/** Feet closer than this (fraction of leg length) at the bottom = more of a squat than a lunge. */
export const MIN_STEP_RATIO = 0.45;
/** Torso tilting more than this from vertical during a lunge is flagged. */
export const LUNGE_TORSO_MAX_DEG = 25;

export const lunge: ExerciseDefinition = {
  id: "lunge",
  name: "Lunge",
  primaryJoint: "knee",
  cameraView: "side",
  rangeNoun: "lunge depth",
  setupInstructions:
    "Stand side on to the camera, about two to three metres back, with your whole body in view and room to step. " +
    "Then stand up tall to begin.",
  startPrompt: "Stand up tall to begin.",
  readyPrompt: "Ready. Start lunging.",
  phaseLabels: { start: "standing", toward_peak: "lowering", peak: "bottom", returning: "rising" },
  counter: {
    direction: "decreasing",
    startAngle: 155,
    leaveStartAngle: 145,
    // Bottom of a lunge: front knee ≈ 80–100°.
    peakAngle: 105,
    hysteresis: 8,
    partialAngle: 135,
    minRepDurationMs: 600,
    maxRepDurationMs: 12_000,
    trackingLossTimeoutMs: 700,
    // Hips must drop ≥ 25% of standing leg length (full lunge ≈ 35–45%).
    minProgress: 0.25,
  },
  loweringPhase: "toPeak",
  progress: { label: "Hips dropped", hint: "% of leg length" },
  calibrationGuide: "Half lunge ≈ 120–130° and 15%; full lunge ≈ 80–100° and 35%+.",

  read(landmarks, { aspectRatio, minVisibility, preferredSide }) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { torsoLean: null, stepRatio: null },
      side: null,
      highlight: [],
      positionHint: null,
      view: "side",
    };
    if (!landmarks || landmarks.length < 33) return none;
    const side = pickSide(
      landmarks,
      { left: [L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE], right: [L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE] },
      minVisibility,
      preferredSide,
    );
    if (!side) return none;
    const i = LEGS[side];
    const hip = landmarks[i.hip]!;
    const knee = landmarks[i.knee]!;
    const ankle = landmarks[i.ankle]!;
    const shoulder = landmarks[i.shoulder];
    const kneeAngle = calculateAngle(hip, knee, ankle, aspectRatio);
    const legLength = distance(hip, ankle, aspectRatio);
    const otherHip = landmarks[side === "left" ? L.RIGHT_HIP : L.LEFT_HIP];
    const hipY = otherHip ? (hip.y + otherHip.y) / 2 : hip.y;

    // Step length: horizontal gap between the ankles (the far one may be
    // partly hidden, so accept a lower visibility for it).
    const otherAnkle = landmarks[side === "left" ? L.RIGHT_ANKLE : L.LEFT_ANKLE];
    const stepRatio =
      otherAnkle && vis(otherAnkle) >= minVisibility * 0.7 && legLength > 1e-6
        ? (Math.abs(ankle.x - otherAnkle.x) * aspectRatio) / legLength
        : null;
    // Unsigned: in a lunge any lean, forward or back, is off upright.
    const lean = shoulder && vis(shoulder) >= minVisibility ? Math.abs(torsoLean(shoulder, hip, aspectRatio)) : null;

    return {
      visible: kneeAngle !== null,
      primaryAngle: kneeAngle,
      progress: legLength > 1e-6 ? { kind: "drop", y: hipY, refLength: legLength } : null,
      form: { torsoLean: lean, stepRatio },
      side,
      highlight: [i.hip, i.knee, i.ankle],
      positionHint: null,
      view: "side",
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "SHALLOW_LUNGE",
      message: "Not counted: lower until your front knee bends to about 90 degrees.",
      spoken: "Not counted. Go lower.",
    },
    PROGRESS_NOT_MET: {
      code: "NO_HIP_DROP",
      message: "Not counted: your knee bent but your hips didn't go down. Drop your back knee toward the floor.",
      spoken: "Not counted. Drop your back knee toward the floor.",
    },
  },

  formChecks(_rep, stats) {
    const flags: FormFlag[] = [];
    const step = stats["stepRatio@peak"];
    if (step && step.max < MIN_STEP_RATIO) {
      flags.push({
        code: "SHORT_STEP",
        message: "Your step was short, so that was closer to a squat. Take a longer stride.",
        source: "measured",
      });
    }
    const lean = stats.torsoLean;
    if (lean && lean.max > LUNGE_TORSO_MAX_DEG) {
      flags.push({
        code: "TORSO_LEAN",
        message: `Your torso tilted ${Math.round(lean.max)}° from upright. Keep your chest up.`,
        source: "measured",
      });
    }
    return flags;
  },

  personalChecks: [],

  spoken: {
    FAST_LOWERING: "Lower yourself more slowly.",
    SHORT_STEP: "Take a longer step.",
    TORSO_LEAN: "Keep your chest up.",
  },
};
