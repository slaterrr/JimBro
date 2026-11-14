/**
 * Bicep curl, side view. Counted on the elbow angle (shoulder–elbow–wrist) of
 * the arm nearest the camera. From the side the far arm is hidden behind the
 * body, so only the near arm is counted; turn around to count the other arm.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L, pickSide, vis } from "../pose_detection";
import type { ExerciseDefinition } from "./types";

const SIDES = {
  left: { shoulder: L.LEFT_SHOULDER, elbow: L.LEFT_ELBOW, wrist: L.LEFT_WRIST, hip: L.LEFT_HIP },
  right: { shoulder: L.RIGHT_SHOULDER, elbow: L.RIGHT_ELBOW, wrist: L.RIGHT_WRIST, hip: L.RIGHT_HIP },
} as const;

/** Upper arm moving further than this from the torso during a rep is flagged. */
const ELBOW_DRIFT_MAX_DEG = 35;
/** Torso lean changing by more than this during a rep is flagged as swinging. */
const BODY_SWING_MAX_DEG = 15;

export const bicepCurl: ExerciseDefinition = {
  id: "bicep_curl",
  name: "Bicep curl",
  primaryJoint: "elbow",
  cameraView: "side",
  setupInstructions:
    "Stand side on to the camera, with the arm you're curling nearest to it, and your upper body in view. " +
    "Then let that arm hang straight to begin.",
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

  read(landmarks, { aspectRatio, minVisibility, preferredSide }) {
    const none = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { elbowDrift: null, torsoLean: null },
      side: null,
      highlight: [],
      positionHint: null,
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

    const elbowAngle = calculateAngle(shoulder, elbow, wrist, aspectRatio);
    let elbowDrift: number | null = null;
    let torsoLean: number | null = null;
    if (hip && vis(hip) >= minVisibility) {
      // Angle between upper arm and torso, at the shoulder.
      elbowDrift = calculateAngle(hip, shoulder, elbow, aspectRatio);
      // Torso lean from vertical, signed (forward/back depends on facing, only the change matters).
      torsoLean = (Math.atan2((shoulder.x - hip.x) * aspectRatio, hip.y - shoulder.y) * 180) / Math.PI;
    }
    return {
      visible: elbowAngle !== null,
      primaryAngle: elbowAngle,
      progress: null,
      form: { elbowDrift, torsoLean },
      side,
      highlight: [i.shoulder, i.elbow, i.wrist],
      positionHint: null,
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "INCOMPLETE_CURL",
      message: "Not counted: curl all the way up, and lower all the way down.",
      spoken: "Not counted. Curl all the way up.",
    },
  },

  formChecks(_rep, stats) {
    const flags: FormFlag[] = [];
    if (stats.elbowDrift && stats.elbowDrift.max > ELBOW_DRIFT_MAX_DEG) {
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
  spoken: {
    FAST_LOWERING: "Lower the weight slowly.",
    ELBOW_DRIFT: "Keep your elbow by your side.",
    BODY_SWING: "Don't swing. Keep your body still.",
  },
};
