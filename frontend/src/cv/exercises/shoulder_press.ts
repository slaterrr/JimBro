/**
 * Shoulder press, front view. Counted on the elbow angle of BOTH arms (the
 * lagging arm decides, so both must lock out), plus how far the hands rise
 * above the shoulders. The elbow angle opens as you press, so the counter runs
 * in the "increasing" direction.
 */

import type { FormFlag } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L, distance, vis } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading } from "./types";

/** Arms differing by more than this at any point in a rep are flagged. */
const UNEVEN_MAX_DEG = 25;

export const shoulderPress: ExerciseDefinition = {
  id: "shoulder_press",
  name: "Shoulder press",
  primaryJoint: "elbow",
  cameraView: "front",
  rangeNoun: "lockout",
  setupInstructions:
    "Face the camera, about two metres back, with your head, arms and hips in view. " +
    "Then bring the weights up to your shoulders to begin.",
  startPrompt: "Bring the weights up to your shoulders to begin.",
  readyPrompt: "Ready. Start pressing.",
  phaseLabels: { start: "at shoulders", toward_peak: "pressing", peak: "locked out", returning: "lowering" },
  counter: {
    direction: "increasing",
    // Rack position: elbows bent ≈ 70–100°.
    startAngle: 100,
    leaveStartAngle: 115,
    // Arms straight overhead ≈ 160–175°.
    peakAngle: 155,
    hysteresis: 8,
    partialAngle: 135,
    minRepDurationMs: 600,
    maxRepDurationMs: 12_000,
    trackingLossTimeoutMs: 700,
    // Hands must rise ≥ 70% of arm length above the shoulders (overhead ≈ 90%+).
    minProgress: 0.7,
  },
  loweringPhase: "return",
  progress: { label: "Hands above shoulders", hint: "% of arm length" },
  calibrationGuide: "At shoulders ≈ 80–100° and 30–50%; locked out ≈ 160–175° and 85%+.",

  read(landmarks, { aspectRatio, minVisibility }) {
    const none: ExerciseReading = {
      visible: false,
      primaryAngle: null,
      progress: null,
      form: { armDiff: null, leftElbow: null, rightElbow: null, handsUp: null },
      side: null,
      highlight: [],
      positionHint: null,
      view: "front",
    };
    if (!landmarks || landmarks.length < 33) return none;
    const idx = [L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST, L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST];
    if (idx.some((i) => vis(landmarks[i]) < minVisibility)) {
      return { ...none, positionHint: "Face the camera so both arms are in view." };
    }
    const ls = landmarks[L.LEFT_SHOULDER]!;
    const le = landmarks[L.LEFT_ELBOW]!;
    const lw = landmarks[L.LEFT_WRIST]!;
    const rs = landmarks[L.RIGHT_SHOULDER]!;
    const re = landmarks[L.RIGHT_ELBOW]!;
    const rw = landmarks[L.RIGHT_WRIST]!;
    const left = calculateAngle(ls, le, lw, aspectRatio);
    const right = calculateAngle(rs, re, rw, aspectRatio);
    if (left === null || right === null) return none;

    const armLen = (a: typeof ls, b: typeof ls, c: typeof ls) => distance(a, b, aspectRatio) + distance(b, c, aspectRatio);
    const lLen = armLen(ls, le, lw);
    const rLen = armLen(rs, re, rw);
    // Height of hands above shoulders (image y grows downward); the lower hand decides.
    const lUp = lLen > 1e-6 ? (ls.y - lw.y) / lLen : 0;
    const rUp = rLen > 1e-6 ? (rs.y - rw.y) / rLen : 0;

    return {
      visible: true,
      // The lagging arm decides: both must lock out for the rep to count.
      primaryAngle: Math.min(left, right),
      progress: { kind: "absolute", value: Math.min(lUp, rUp) },
      form: { armDiff: Math.abs(left - right), leftElbow: left, rightElbow: right, handsUp: Math.min(lUp, rUp) },
      side: "both",
      highlight: idx,
      positionHint: null,
      view: "front",
    };
  },

  rejections: {
    PARTIAL_RANGE: {
      code: "INCOMPLETE_PRESS",
      message: "Not counted: press until both arms are straight overhead.",
      spoken: "Not counted. Lock your arms out overhead.",
    },
    PROGRESS_NOT_MET: {
      code: "NOT_OVERHEAD",
      message: "Not counted: your arms straightened but your hands weren't above your head.",
      spoken: "Not counted. Press up, above your head.",
    },
  },

  formChecks(_rep, stats) {
    const flags: FormFlag[] = [];
    if (stats.armDiff && stats.armDiff.max > UNEVEN_MAX_DEG) {
      flags.push({
        code: "UNEVEN_ARMS",
        message: "One arm moved ahead of the other. Press both arms together.",
        source: "measured",
      });
    }
    return flags;
  },
  personalChecks: [],

  // Measured per rep: each arm's lockout, their difference, and overhead reach.
  repMetrics(stats) {
    const m: Record<string, { value: number; unit: string; source: "measured" }> = {};
    if (stats.leftElbow) m.lockoutLeft = { value: Math.round(stats.leftElbow.max), unit: "deg", source: "measured" };
    if (stats.rightElbow) m.lockoutRight = { value: Math.round(stats.rightElbow.max), unit: "deg", source: "measured" };
    if (stats.leftElbow && stats.rightElbow) {
      m.lockoutDiff = { value: Math.round(Math.abs(stats.leftElbow.max - stats.rightElbow.max)), unit: "deg", source: "measured" };
    }
    if (stats.armDiff) m.armDiffMax = { value: Math.round(stats.armDiff.max), unit: "deg", source: "measured" };
    if (stats.handsUp) m.overheadReach = { value: Math.round(stats.handsUp.max * 100), unit: "% arm", source: "measured" };
    return m;
  },

  spoken: {
    FAST_LOWERING: "Lower the weights slowly.",
    UNEVEN_ARMS: "Press both arms evenly.",
  },
};
