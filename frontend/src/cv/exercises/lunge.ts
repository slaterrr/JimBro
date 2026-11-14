/**
 * Lunge, side view. Supported variations: forward lunge, reverse lunge,
 * alternating lunges, static split squat and walking lunge, all filmed side on.
 * Side (lateral) lunges and front-on filming aren't supported.
 *
 * Both legs are tracked, and their roles come from LegRoleTracker (see
 * leg_roles.ts): the front leg is the one whose foot is further in the
 * direction the user faces, locked for the whole rep and re-decided when the
 * feet come together, so alternating reps are handled. Counting uses the
 * FRONT knee angle; the back knee is measured separately. If the roles can't be
 * determined (a leg out of view, facing unclear) the reading is uncertain: no
 * angle, a position hint, and no feedback.
 */

import type { FormFlag } from "../../../../shared/types";
import { torsoLean } from "../body_metrics";
import { LegRoleTracker, type LegRoles } from "../leg_roles";
import { POSE_LANDMARKS as L, vis, type LandmarkLike } from "../pose_detection";
import type { ExerciseDefinition, ExerciseReading, ReadOptions } from "./types";

/** Feet closer than this (fraction of leg length) at the bottom = more of a squat than a lunge. */
export const MIN_STEP_RATIO = 0.45;
/** Torso tilting more than this from vertical during a lunge is flagged. */
export const LUNGE_TORSO_MAX_DEG = 25;

function readWith(tracker: LegRoleTracker, landmarks: readonly LandmarkLike[] | undefined, o: ReadOptions): ExerciseReading {
  const none: ExerciseReading = {
    visible: false,
    primaryAngle: null,
    progress: null,
    form: { torsoLean: null, stepRatio: null, frontKnee: null, backKnee: null },
    side: null,
    highlight: [],
    positionHint: null,
    view: "side",
  };
  if (o.view === "front") {
    return { ...none, positionHint: "Turn side on so I can tell your front leg from your back leg." };
  }
  const roles: LegRoles = tracker.update(landmarks, { minVisibility: o.minVisibility, aspectRatio: o.aspectRatio });
  if (roles.status === "uncertain" || !landmarks) {
    return { ...none, positionHint: roles.status === "uncertain" ? roles.reason : null };
  }

  const ar = o.aspectRatio;
  const legs = roles.status === "split" ? (roles.back ? [roles.front, roles.back] : [roles.front]) : roles.legs;
  const hipY = legs.reduce((a, l) => a + l.hip.y, 0) / legs.length;
  const legLength = legs.reduce((a, l) => a + Math.hypot((l.hip.x - l.ankle.x) * ar, l.hip.y - l.ankle.y), 0) / legs.length;
  const ls = landmarks[L.LEFT_SHOULDER];
  const rs = landmarks[L.RIGHT_SHOULDER];
  const shoulder = ls && rs ? (vis(ls) >= vis(rs) ? ls : rs) : null;
  const midHip = { x: legs.reduce((a, l) => a + l.hip.x, 0) / legs.length, y: hipY };
  const lean = shoulder && vis(shoulder) >= o.minVisibility ? Math.abs(torsoLean(shoulder, midHip, ar)) : null;
  const progress = legLength > 1e-6 ? ({ kind: "drop", y: hipY, refLength: legLength } as const) : null;

  if (roles.status === "together") {
    // Standing or mid-step: no front/back yet. Both knees should be straight
    // here, so the straighter one stands in for the counting angle at the top.
    return {
      ...none,
      visible: true,
      primaryAngle: Math.max(roles.legs[0].kneeAngle, roles.legs[1].kneeAngle),
      progress,
      form: { torsoLean: lean, stepRatio: roles.split, frontKnee: null, backKnee: null },
      side: "both",
      highlight: [...roles.legs[0].indices, ...roles.legs[1].indices],
    };
  }

  return {
    ...none,
    visible: true,
    primaryAngle: roles.front.kneeAngle,
    progress,
    form: {
      torsoLean: lean,
      // Step length and back knee need both legs; skip them while one is hidden.
      stepRatio: roles.back ? roles.split : null,
      frontKnee: roles.front.kneeAngle,
      backKnee: roles.back?.kneeAngle ?? null,
    },
    // Which MediaPipe leg is in front, for display.
    side: roles.front.label,
    highlight: roles.front.indices,
  };
}

export const lunge: ExerciseDefinition = {
  id: "lunge",
  name: "Lunge",
  primaryJoint: "knee",
  cameraView: "side",
  rangeNoun: "lunge depth",
  setupInstructions:
    "Stand side on to the camera, about two to three metres back, with your whole body, both feet included, in view " +
    "and room to step. Forward, reverse, alternating or split-squat lunges all work. Then stand up tall to begin.",
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
  calibrationGuide: "Front knee: half lunge ≈ 120–130° and 15%; full lunge ≈ 80–100° and 35%+.",

  read(landmarks, options) {
    // Stateless, single-frame use: roles from this frame alone.
    return readWith(new LegRoleTracker(), landmarks, options);
  },
  createReader() {
    const tracker = new LegRoleTracker();
    return (landmarks, options) => readWith(tracker, landmarks, options);
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

  // Measured per rep, not judged: there's no validated label set for what a
  // "wrong" back-knee depth is, so these are reported, never flagged.
  repMetrics(stats) {
    const out: Record<string, { value: number; unit: string; source: "measured" }> = {};
    if (stats.frontKnee) out.frontKneeMin = { value: Math.round(stats.frontKnee.min), unit: "deg", source: "measured" };
    if (stats.backKnee) out.backKneeMin = { value: Math.round(stats.backKnee.min), unit: "deg", source: "measured" };
    if (stats["stepRatio@peak"]) {
      out.stepLength = { value: Math.round(stats["stepRatio@peak"].max * 100), unit: "% leg", source: "measured" };
    }
    return out;
  },

  personalChecks: [],

  spoken: {
    FAST_LOWERING: "Lower yourself more slowly.",
    SHORT_STEP: "Take a longer step.",
    TORSO_LEAN: "Keep your chest up.",
  },
};
