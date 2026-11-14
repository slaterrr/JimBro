/**
 * Squat, side view. Counted on the knee angle (hip–knee–ankle) of the leg the
 * camera sees best, plus hip drop below standing height.
 */

import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L, pickSide, distance, vis } from "../pose_detection";
import type { ExerciseDefinition } from "./types";

const LEGS = {
  left: { shoulder: L.LEFT_SHOULDER, hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE },
  right: { shoulder: L.RIGHT_SHOULDER, hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE },
} as const;

export const squat: ExerciseDefinition = {
  id: "squat",
  name: "Squat",
  primaryJoint: "knee",
  cameraView: "side",
  setupInstructions:
    "Stand side on to the camera, about two to three metres back, with your whole body in view. " +
    "Then stand up tall to begin.",
  startPrompt: "Stand up tall to begin.",
  readyPrompt: "Ready. Start squatting.",
  phaseLabels: { start: "standing", toward_peak: "descending", peak: "bottom", returning: "ascending" },
  counter: {
    direction: "decreasing",
    startAngle: 160,
    leaveStartAngle: 150,
    // Side-on: half squat ≈ 100–110°, parallel ≈ 60–75°. 85° ≈ close to parallel.
    peakAngle: 85,
    hysteresis: 8,
    partialAngle: 135,
    minRepDurationMs: 600,
    maxRepDurationMs: 12_000,
    trackingLossTimeoutMs: 700,
    // Hips must drop ≥ 40% of standing leg length (half squat ≈ 20–30%, parallel ≈ 55%+).
    minProgress: 0.4,
  },
  loweringPhase: "toPeak",
  progress: { label: "Hips dropped", hint: "% of leg length" },
  calibrationGuide: "Half squat ≈ 100–110° and 20–30%; parallel ≈ 60–75° and 55%+.",

  read(landmarks, { aspectRatio, minVisibility, preferredSide }) {
    const none = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { hipAngle: null },
      side: null,
      highlight: [],
      positionHint: null,
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
    const shoulder = landmarks[i.shoulder];
    const hip = landmarks[i.hip]!;
    const knee = landmarks[i.knee]!;
    const ankle = landmarks[i.ankle]!;
    const kneeAngle = calculateAngle(hip, knee, ankle, aspectRatio);
    const hipAngle = shoulder && vis(shoulder) >= minVisibility ? calculateAngle(shoulder, hip, knee, aspectRatio) : null;
    // Average both hips' height so it doesn't jump when the counting leg switches.
    const otherHip = landmarks[side === "left" ? L.RIGHT_HIP : L.LEFT_HIP];
    const hipY = otherHip ? (hip.y + otherHip.y) / 2 : hip.y;
    const legLength = distance(hip, ankle, aspectRatio);

    return {
      visible: kneeAngle !== null,
      primaryAngle: kneeAngle,
      progress: legLength > 1e-6 ? { kind: "drop", y: hipY, refLength: legLength } : null,
      form: { hipAngle },
      side,
      highlight: [i.shoulder, i.hip, i.knee, i.ankle],
      positionHint: null,
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "SHALLOW_DEPTH",
      message: "Not counted: you didn't reach the depth line. Go a little lower.",
      spoken: "Not counted. Go a little lower.",
    },
    PROGRESS_NOT_MET: {
      code: "NO_HIP_DROP",
      message: "Not counted: your knee bent but your hips didn't go down. Keep both feet down and sit your hips back.",
      spoken: "Not counted. Keep both feet down and lower your hips.",
    },
  },
  formChecks: () => [],
  spoken: { FAST_LOWERING: "Slow down on the way down." },
};
