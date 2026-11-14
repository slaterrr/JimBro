/**
 * Squat.
 *
 * Side view (recommended): counted on the knee angle (hip–knee–ankle) of the
 * leg the camera sees best, plus hip drop below standing height. Torso lean is
 * compared with the user's own earlier reps, not a universal angle, because how
 * far the torso leans depends on limb proportions and squat style.
 *
 * Front view (supported for knee tracking): the knee angle comes from the
 * model's 3D estimate (less precise than a side view), and the knee-to-ankle
 * ratio checks whether the knees move inward on the way up.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle, calculateAngle3D } from "../angle_calculator";
import { facingSign, kneeAnkleRatio, torsoLean } from "../body_metrics";
import { POSE_LANDMARKS as L, pickSide, distance, vis, type LandmarkLike, type WorldLandmarkLike } from "../pose_detection";
import squatModelJson from "../ml/models/squat_uiprmd.json";
import { QualityModel, type QualityModelJson } from "../ml/quality_model";
import type { ExerciseDefinition, ExerciseReading } from "./types";

/** Trained on UI-PRMD deep squats (public domain); see ml/uiprmd/REPORT.md. */
export const squatQualityModel = new QualityModel(squatModelJson as QualityModelJson);

const LEGS = {
  left: { shoulder: L.LEFT_SHOULDER, hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE },
  right: { shoulder: L.RIGHT_SHOULDER, hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE },
} as const;

/** Knee-to-ankle ratio below this while standing up is flagged as knees caving in. */
export const KNEE_CAVE_RATIO = 0.75;

export const squat: ExerciseDefinition = {
  id: "squat",
  name: "Squat",
  primaryJoint: "knee",
  cameraView: "side",
  otherViews: ["front"],
  rangeNoun: "squat depth",
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

  read(landmarks, { aspectRatio, minVisibility, preferredSide, world, view }) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { torsoLean: null, kneeRatio: null, hipAngle: null },
      side: null,
      highlight: [],
      positionHint: null,
      view: view === "front" ? "front" : "side",
    };
    if (!landmarks || landmarks.length < 33) return none;
    return view === "front" && world && world.length >= 33
      ? readFront(landmarks, world, aspectRatio, minVisibility, none)
      : readSide(landmarks, aspectRatio, minVisibility, preferredSide, none);
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

  formChecks(_rep, stats, view) {
    const flags: FormFlag[] = [];
    const ratio = stats["kneeRatio@returning"];
    if (view === "front" && ratio && ratio.min < KNEE_CAVE_RATIO) {
      flags.push({
        code: "KNEES_CAVING",
        message: "Your knees moved inward on the way up. Push them out over your toes.",
        // A 2D proxy for valgus, so estimated.
        source: "estimated",
      });
    }
    return flags;
  },

  personalChecks: [
    {
      signal: "torsoLean",
      stat: "range",
      worse: "higher",
      tolerance: 12,
      code: "TORSO_SHIFT",
      message: (d) => `Your torso angle changed about ${Math.round(d)}° more than on your usual reps. Keep your chest up.`,
    },
  ],

  spoken: {
    FAST_LOWERING: "Slow down on the way down.",
    KNEES_CAVING: "Push your knees out.",
    TORSO_SHIFT: "Keep your chest up.",
  },

  // Learned check, side view only (it was trained on side-view projections).
  // Score only, no flag: UI-PRMD's "correct" squats are very deep overhead
  // squats, so ordinary parallel gym squats score as "incorrect" (a parallel
  // squat at the counter's minimum depth scores ~87%). It needs calibrating on
  // labelled gym recordings before it can give feedback. See ml/uiprmd/REPORT.md.
  quality: {
    raiseFlag: false,
    model: squatQualityModel,
    views: ["side"],
    code: "MOVEMENT_PATTERN",
    message:
      "This rep's movement pattern looked more like the incorrect squats in our reference data than the correct ones. " +
      "Check your depth, and that your hips and chest move together.",
  },
};

function readSide(
  landmarks: readonly LandmarkLike[],
  aspectRatio: number,
  minVisibility: number,
  preferredSide: "left" | "right" | null,
  none: ExerciseReading,
): ExerciseReading {
  const side = pickSide(
    landmarks,
    { left: [L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE], right: [L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE] },
    minVisibility,
    preferredSide,
  );
  if (!side) return { ...none, view: "side" };

  const i = LEGS[side];
  const shoulder = landmarks[i.shoulder];
  const hip = landmarks[i.hip]!;
  const knee = landmarks[i.knee]!;
  const ankle = landmarks[i.ankle]!;
  const kneeAngle = calculateAngle(hip, knee, ankle, aspectRatio);
  const shoulderOk = shoulder && vis(shoulder) >= minVisibility;
  const lean = shoulderOk ? torsoLean(shoulder, hip, aspectRatio, facingSign(landmarks, side, minVisibility)) : null;
  const hipAngle = shoulderOk ? calculateAngle(shoulder, hip, knee, aspectRatio) : null;
  // Average both hips' height so it doesn't jump when the counting leg switches.
  const otherHip = landmarks[side === "left" ? L.RIGHT_HIP : L.LEFT_HIP];
  const hipY = otherHip ? (hip.y + otherHip.y) / 2 : hip.y;
  const legLength = distance(hip, ankle, aspectRatio);

  return {
    visible: kneeAngle !== null,
    primaryAngle: kneeAngle,
    progress: legLength > 1e-6 ? { kind: "drop", y: hipY, refLength: legLength } : null,
    form: { torsoLean: lean, kneeRatio: null, hipAngle },
    side,
    highlight: [i.shoulder, i.hip, i.knee, i.ankle],
    positionHint: null,
    view: "side",
  };
}

function readFront(
  landmarks: readonly LandmarkLike[],
  world: readonly WorldLandmarkLike[],
  aspectRatio: number,
  minVisibility: number,
  none: ExerciseReading,
): ExerciseReading {
  const legIdx = [L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE, L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE];
  if (legIdx.some((k) => vis(landmarks[k]) < minVisibility)) {
    return { ...none, view: "front", positionHint: "Step back so both legs, down to your feet, are in view." };
  }
  // Facing the camera, a 2D knee angle shrinks only a little as the thigh points
  // at the lens, so use the 3D estimate, averaged over both legs.
  const angle3d = (h: number, k: number, a: number) => calculateAngle3D(world[h]!, world[k]!, world[a]!);
  const left = angle3d(L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE);
  const right = angle3d(L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE);
  if (left === null || right === null) return { ...none, view: "front" };

  const lh = landmarks[L.LEFT_HIP]!;
  const rh = landmarks[L.RIGHT_HIP]!;
  const la = landmarks[L.LEFT_ANKLE]!;
  const ra = landmarks[L.RIGHT_ANKLE]!;
  const hipY = (lh.y + rh.y) / 2;
  // Standing leg length (image), learned at the start position by the drop meter.
  const legLength = (distance(lh, la, aspectRatio) + distance(rh, ra, aspectRatio)) / 2;
  const ls = landmarks[L.LEFT_SHOULDER];
  const rs = landmarks[L.RIGHT_SHOULDER];
  // Front on, "lean" is a sideways shift of the torso.
  const lean =
    ls && rs && vis(ls) >= minVisibility && vis(rs) >= minVisibility
      ? torsoLean({ x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, { x: (lh.x + rh.x) / 2, y: hipY }, aspectRatio)
      : null;

  return {
    visible: true,
    primaryAngle: (left + right) / 2,
    progress: legLength > 1e-6 ? { kind: "drop", y: hipY, refLength: legLength } : null,
    form: { torsoLean: lean, kneeRatio: kneeAnkleRatio(landmarks, minVisibility), hipAngle: null },
    side: "both",
    highlight: legIdx,
    positionHint: null,
    view: "front",
  };
}
