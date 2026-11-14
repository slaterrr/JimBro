// Landmark geometry for MediaPipe's 33-point pose (port of apps/mobile/src/pose).
export const ARM = { left: [11, 13, 15], right: [12, 14, 16] }; // shoulder, elbow, wrist
export const LEG = { left: [23, 25, 27], right: [24, 26, 28] }; // hip, knee, ankle
const POSE_LANDMARKS = 33;

/** Angle a-joint-c in degrees, or null for overlapping / non-finite points. */
export function jointAngle(a, joint, c) {
  const ax = a.x - joint.x;
  const ay = a.y - joint.y;
  const cx = c.x - joint.x;
  const cy = c.y - joint.y;
  const la = Math.hypot(ax, ay);
  const lc = Math.hypot(cx, cy);
  if (!Number.isFinite(la) || !Number.isFinite(lc) || la === 0 || lc === 0) return null;
  const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (la * lc)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const weakest = (pose, idx) => Math.min(...idx.map((i) => pose[i]?.visibility ?? 0));
const better = (pose, sides) => (weakest(pose, sides.right) > weakest(pose, sides.left) ? sides.right : sides.left);

export function movementAngle(pose, movement) {
  if (!pose || pose.length < POSE_LANDMARKS) return null;
  const idx = better(pose, movement === 'squat' ? LEG : ARM);
  const angle = jointAngle(pose[idx[0]], pose[idx[1]], pose[idx[2]]);
  return angle === null ? null : { angle, confidence: weakest(pose, idx) };
}

export function assessTracking(pose, threshold = 0.5) {
  if (!pose || pose.length < POSE_LANDMARKS) return { status: 'lost', confidence: 0 };
  const confidence = weakest(pose, better(pose, ARM));
  return { status: confidence >= threshold ? 'ok' : 'low', confidence };
}
