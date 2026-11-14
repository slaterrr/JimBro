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
const sidesFor = (movement) => movement === 'squat' ? LEG : ARM;
const torsoFor = (movement, side) => movement === 'squat'
  ? (side === 'left' ? 11 : 12) // shoulder, while squat tracks hip/knee/ankle
  : (side === 'left' ? 23 : 24); // hip, while arm exercises track shoulder/elbow/wrist
const quality = (pose, movement, side) => Math.min(
  weakest(pose, sidesFor(movement)[side]), pose[torsoFor(movement, side)]?.visibility ?? 0,
);
const bestSide = (pose, movement) => quality(pose, movement, 'right') > quality(pose, movement, 'left')
  ? 'right' : 'left';

/** Optional side lock prevents an arm swap from completing a rep. */
export function movementAngle(pose, movement, side = null) {
  if (!pose || pose.length < POSE_LANDMARKS) return null;
  const idx = sidesFor(movement)[side ?? bestSide(pose, movement)];
  const angle = jointAngle(pose[idx[0]], pose[idx[1]], pose[idx[2]]);
  return angle === null ? null : { angle, confidence: weakest(pose, idx) };
}

/** Exercise-specific visibility includes the torso, not just three moving joints. */
export function assessTracking(pose, threshold = 0.5, movement = 'curl', side = null) {
  if (!pose || pose.length < POSE_LANDMARKS) return { status: 'lost', confidence: 0, side };
  const selected = side ?? bestSide(pose, movement);
  const confidence = quality(pose, movement, selected);
  return { status: confidence >= threshold ? 'ok' : 'low', confidence, side: selected };
}

/** Shoulder angle between elbow and hip; large deviation suggests arm swing, not a curl. */
export function curlUpperArmSwing(pose, side) {
  const [shoulder, elbow] = sidesFor('curl')[side];
  const hip = torsoFor('curl', side);
  return jointAngle(pose[elbow], pose[shoulder], pose[hip]);
}
