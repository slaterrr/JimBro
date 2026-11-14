import { ARM_LANDMARKS, armConfidence, bestSide, type Landmark } from "./tracking";

export type Movement = "curl" | "squat" | "shoulder_press";

/** Angle a-joint-c in degrees; mirrors backend/jimbro/motion.py, null instead of raising. */
export function jointAngle(a: Landmark, joint: Landmark, c: Landmark): number | null {
  const ax = a.x - joint.x, ay = a.y - joint.y;
  const cx = c.x - joint.x, cy = c.y - joint.y;
  const la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy);
  if (!Number.isFinite(la) || !Number.isFinite(lc) || la === 0 || lc === 0) return null;
  const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (la * lc)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const LEG = { left: { hip: 23, knee: 25, ankle: 27 }, right: { hip: 24, knee: 26, ankle: 28 } } as const;

export function movementAngle(
  pose: readonly Landmark[] | null,
  movement: Movement,
): { angle: number; confidence: number } | null {
  if (!pose || pose.length < 33) return null;
  let idx: [number, number, number];
  let confidence: number;
  if (movement === "squat") {
    const vis = (s: "left" | "right") =>
      Math.min(...Object.values(LEG[s]).map((i) => pose[i]?.visibility ?? 0));
    const side = vis("right") > vis("left") ? "right" : "left";
    idx = [LEG[side].hip, LEG[side].knee, LEG[side].ankle];
    confidence = vis(side);
  } else {
    const side = bestSide(pose);
    const arm = ARM_LANDMARKS[side];
    idx = [arm.shoulder, arm.elbow, arm.wrist];
    confidence = armConfidence(pose, side);
  }
  const angle = jointAngle(pose[idx[0]], pose[idx[1]], pose[idx[2]]);
  return angle === null ? null : { angle, confidence };
}
