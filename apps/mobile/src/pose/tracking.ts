/** Landmark-confidence assessment for MediaPipe pose output (33 landmarks). */

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type TrackingStatus = "ok" | "low" | "lost";

export interface TrackingAssessment {
  status: TrackingStatus;
  confidence: number;
}

export const ARM_LANDMARKS = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
} as const;

export type Side = keyof typeof ARM_LANDMARKS;

const POSE_LANDMARK_COUNT = 33;

/** Weakest visibility across one arm; missing visibility counts as untrusted (0). */
export function armConfidence(pose: readonly Landmark[], side: Side): number {
  const arm = ARM_LANDMARKS[side];
  return Math.min(...[arm.shoulder, arm.elbow, arm.wrist].map((i) => pose[i]?.visibility ?? 0));
}

/** Pick the better-tracked arm so either camera side works. */
export function bestSide(pose: readonly Landmark[]): Side {
  return armConfidence(pose, "right") > armConfidence(pose, "left") ? "right" : "left";
}

export function assessTracking(
  pose: readonly Landmark[] | null | undefined,
  threshold = 0.5,
): TrackingAssessment {
  if (!pose || pose.length < POSE_LANDMARK_COUNT) return { status: "lost", confidence: 0 };
  const confidence = armConfidence(pose, bestSide(pose));
  return { status: confidence >= threshold ? "ok" : "low", confidence };
}
