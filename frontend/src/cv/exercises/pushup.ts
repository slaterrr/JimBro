/**
 * Push-up, side view at floor level. Counted on the elbow angle
 * (shoulder–elbow–wrist) of the arm the camera sees best, plus how far the
 * shoulders drop from the top of the plank. Only counts while the body is
 * roughly horizontal, so bending the arms while standing never counts.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L, distance, pickSide, vis } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading } from "./types";

const SIDES = {
  left: { shoulder: L.LEFT_SHOULDER, elbow: L.LEFT_ELBOW, wrist: L.LEFT_WRIST, hip: L.LEFT_HIP, ankle: L.LEFT_ANKLE },
  right: {
    shoulder: L.RIGHT_SHOULDER,
    elbow: L.RIGHT_ELBOW,
    wrist: L.RIGHT_WRIST,
    hip: L.RIGHT_HIP,
    ankle: L.RIGHT_ANKLE,
  },
} as const;

/** Shoulder→ankle line must be within this many degrees of horizontal. */
const MAX_BODY_TILT_DEG = 40;
/** Body-line angle (shoulder–hip–ankle) below this during a rep is flagged. */
const BODY_LINE_MIN_DEG = 160;

export const pushup: ExerciseDefinition = {
  id: "pushup",
  name: "Push-up",
  primaryJoint: "elbow",
  cameraView: "side",
  rangeNoun: "push-up depth",
  setupInstructions:
    "Put the camera on the floor, side on to you, about two metres away, so your whole body is in view. " +
    "Then get into the top of a push-up.",
  startPrompt: "Get into the top of a push-up, arms straight.",
  readyPrompt: "Ready. Start your push-ups.",
  phaseLabels: { start: "top", toward_peak: "lowering", peak: "bottom", returning: "pushing up" },
  counter: {
    direction: "decreasing",
    startAngle: 150,
    leaveStartAngle: 140,
    // Elbow ≈ 90° or less at the bottom of a full push-up.
    peakAngle: 90,
    hysteresis: 8,
    partialAngle: 120,
    minRepDurationMs: 500,
    maxRepDurationMs: 12_000,
    trackingLossTimeoutMs: 700,
    // Shoulders must drop ≥ 30% of arm length below the top position.
    minProgress: 0.3,
  },
  loweringPhase: "toPeak",
  progress: { label: "Chest lowered", hint: "% of arm length" },
  calibrationGuide: "Half push-up ≈ 110–120° and 15–25%; full ≈ 70–90° and 35%+.",

  read(landmarks, { aspectRatio, minVisibility, preferredSide }) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { bodyLine: null, hipOffset: null },
      side: null,
      highlight: [],
      positionHint: null,
      view: "side",
    };
    if (!landmarks || landmarks.length < 33) return none;
    const side = pickSide(
      landmarks,
      {
        left: [L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST],
        right: [L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST],
      },
      minVisibility,
      preferredSide,
    );
    if (!side) return none;
    const i = SIDES[side];
    const shoulder = landmarks[i.shoulder]!;
    const elbow = landmarks[i.elbow]!;
    const wrist = landmarks[i.wrist]!;
    const hip = landmarks[i.hip];
    const ankle = landmarks[i.ankle];

    // Position gate: body roughly horizontal (needs hip + ankle).
    let bodyLine: number | null = null;
    let hipOffset: number | null = null;
    let horizontal = false;
    if (hip && ankle && vis(hip) >= minVisibility * 0.8 && vis(ankle) >= minVisibility * 0.8) {
      const dx = Math.abs(ankle.x - shoulder.x) * aspectRatio;
      const dy = Math.abs(ankle.y - shoulder.y);
      horizontal = (Math.atan2(dy, dx) * 180) / Math.PI <= MAX_BODY_TILT_DEG;
      bodyLine = calculateAngle(shoulder, hip, ankle, aspectRatio);
      // Positive = hips below the shoulder–ankle line (sagging); negative = above (piking).
      const t = (hip.x - shoulder.x) / (ankle.x - shoulder.x || 1e-6);
      const lineY = shoulder.y + t * (ankle.y - shoulder.y);
      hipOffset = hip.y - lineY;
    }
    if (!horizontal) {
      return {
        ...none,
        side,
        positionHint: "Get into a push-up position, side on to the camera, with your feet in view.",
      };
    }

    const elbowAngle = calculateAngle(shoulder, elbow, wrist, aspectRatio);
    const armLength = distance(shoulder, elbow, aspectRatio) + distance(elbow, wrist, aspectRatio);
    return {
      visible: elbowAngle !== null,
      primaryAngle: elbowAngle,
      progress: armLength > 1e-6 ? { kind: "drop", y: shoulder.y, refLength: armLength } : null,
      // hipOffset is scaled to degrees-ish units only for min/max tracking; sign is what matters.
      form: { bodyLine, hipOffset: hipOffset === null ? null : hipOffset * 1000 },
      side,
      highlight: [i.shoulder, i.elbow, i.wrist, i.hip, i.ankle],
      positionHint: null,
      view: "side",
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "SHALLOW_PUSHUP",
      message: "Not counted: go lower, until your elbows bend to about 90 degrees.",
      spoken: "Not counted. Go lower.",
    },
    PROGRESS_NOT_MET: {
      code: "CHEST_NOT_LOWERED",
      message: "Not counted: your elbows bent but your chest didn't go down. Lower your whole body.",
      spoken: "Not counted. Lower your chest towards the floor.",
    },
  },

  formChecks(_rep, stats) {
    const flags: FormFlag[] = [];
    const line = stats.bodyLine;
    const offset = stats.hipOffset;
    if (line && line.min < BODY_LINE_MIN_DEG && offset) {
      const sag = Math.abs(offset.max) >= Math.abs(offset.min);
      flags.push(
        sag
          ? {
              code: "HIPS_SAGGING",
              message: "Your hips sagged. Keep a straight line from shoulders to ankles.",
              source: "measured",
            }
          : {
              code: "HIPS_PIKED",
              message: "Your hips were too high. Keep a straight line from shoulders to ankles.",
              source: "measured",
            },
      );
    }
    return flags;
  },
  personalChecks: [],

  spoken: {
    FAST_LOWERING: "Lower yourself more slowly.",
    HIPS_SAGGING: "Keep your hips up.",
    HIPS_PIKED: "Bring your hips down into a straight line.",
  },
};
