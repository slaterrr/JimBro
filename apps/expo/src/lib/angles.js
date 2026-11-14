// Landmark geometry for MediaPipe's 33-point pose (port of apps/mobile/src/pose).
export const ARM = { left: [11, 13, 15], right: [12, 14, 16] }; // shoulder, elbow, wrist
export const LEG = { left: [23, 25, 27], right: [24, 26, 28] }; // hip, knee, ankle
export const HIP = { left: [11, 23, 25], right: [12, 24, 26] }; // shoulder, hip, knee (hinge)
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
// Joint triple per movement (the angle the counter reads) and an anchor that must also be visible.
// Arm lifts (curl, press, push-up, pull-up) track shoulder/elbow/wrist with the hip as anchor;
// squat tracks hip/knee/ankle with the shoulder; deadlift tracks the hip hinge with the ankle.
// Keep in step with lib/analyzers.js (a test checks they match).
const JOINTS = { squat: LEG, deadlift: HIP };
const ANCHORS = { squat: { left: 11, right: 12 }, deadlift: { left: 27, right: 28 } };
export const jointsFor = (movement) => JOINTS[movement] ?? ARM;
export const anchorFor = (movement) => ANCHORS[movement] ?? { left: 23, right: 24 };
const sidesFor = jointsFor;
const torsoFor = (movement, side) => anchorFor(movement)[side];
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

// Front-facing squats: knees and hips travel toward the lens, so the 2D hip–knee–ankle angle
// stays near 180° and no rep can complete. Hypothesis under test: when the shoulders appear
// wide relative to the torso the user faces the camera; then estimate the knee angle from the
// vertical foreshortening of thigh and shank against their standing (longest seen) lengths.
const FRONTAL_SHOULDER_RATIO = 0.35;
// Standing lengths use the 90th percentile of recent samples (robust to jitter), and ratios
// within 2% of it count as straight; otherwise standing never reads as "back at rest".
// Tuned on simulation sweeps (40 sets × 12 reps, two noise levels); validate on real video.
const STRAIGHT_RATIO = 0.98;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function isFrontal(pose) {
  const sh = Math.abs(pose[11].x - pose[12].x);
  const m1 = mid(pose[11], pose[12]);
  const m2 = mid(pose[23], pose[24]);
  const torso = Math.hypot(m1.x - m2.x, m1.y - m2.y);
  return torso > 0.01 && sh / torso > FRONTAL_SHOULDER_RATIO;
}

/** Knee angle from vertical projections; `cal` keeps recent thigh/shank lengths for this set. */
export function frontalKneeAngle(pose, side, cal) {
  const [h, k, a] = LEG[side];
  const thigh = pose[k].y - pose[h].y;
  const shank = pose[a].y - pose[k].y;
  if (!(thigh > 0) || !(shank > 0)) return null;
  const q90 = (key, v) => {
    const xs = (cal[key] ??= []);
    xs.push(v);
    if (xs.length > 400) xs.shift();
    const sorted = [...xs].sort((p, q) => p - q);
    return sorted[Math.floor(0.9 * (sorted.length - 1))];
  };
  const thighLen = q90('thighs', thigh);
  const shankLen = q90('shanks', shank);
  const tilt = (d, len) => (Math.acos(Math.min(1, d / (len * STRAIGHT_RATIO))) * 180) / Math.PI;
  return 180 - tilt(thigh, thighLen) - tilt(shank, shankLen);
}

/** Which body part to bring into view when tracking is lost (for a specific camera hint). */
export function missingHint(pose, movement) {
  if (!pose || pose.length < POSE_LANDMARKS) return 'body';
  const vis = (i) => pose[i]?.visibility ?? 0;
  const worst = (pairs) => Math.min(...pairs.map(([l, r]) => Math.max(vis(l), vis(r))));
  if (movement === 'squat' || movement === 'deadlift') {
    if (worst([[27, 28]]) < 0.5) return 'feet';
    if (worst([[25, 26]]) < 0.5) return 'knees';
    if (worst([[23, 24]]) < 0.5) return 'hips';
  } else {
    if (worst([[15, 16], [13, 14]]) < 0.5) return 'arm';
    if (worst([[23, 24]]) < 0.5) return 'hips';
  }
  return 'body';
}

// Squat vs lunge from leg symmetry. Hypotheses under test, in torso lengths (the torso barely
// foreshortens in either lift, unlike the thigh, which shrinks at depth and inflated ratios on a
// real rear-view squat): side view, a lunge keeps the feet split front-to-back even when
// standing; facing the camera, the back knee drops well below the front knee.
const LUNGE_STANCE = 0.8;
const LUNGE_KNEE_DROP = 0.35;
const STANDING_KNEE_DEG = 150;

export function lowerBodyShape(pose, kneeAngle = null) {
  const need = [11, 12, 23, 24, 25, 26, 27, 28];
  if (need.some((i) => (pose[i]?.visibility ?? 0) < 0.5)) return null;
  const m1 = mid(pose[11], pose[12]);
  const m2 = mid(pose[23], pose[24]);
  const torso = Math.hypot(m1.x - m2.x, m1.y - m2.y);
  if (!(torso > 0.01)) return null;
  const standing = kneeAngle !== null && kneeAngle >= STANDING_KNEE_DEG;
  const stance = Math.abs(pose[27].x - pose[28].x) / torso;
  const kneeDrop = Math.abs(pose[25].y - pose[26].y) / torso;
  if ((standing && !isFrontal(pose) && stance > LUNGE_STANCE) || kneeDrop > LUNGE_KNEE_DROP) return 'lunge';
  return 'squat';
}

// Curl vs shoulder press from where the arms are, in torso lengths below (+) or above (−) the
// shoulder (the torso barely foreshortens; upper arm and forearm do). Hypotheses under test:
// a press locks out with BOTH wrists well overhead and both elbows above the shoulders (a wave
// is one arm, and a raised waving forearm stays lower); a curl lifts the wrist toward the
// shoulder while the elbow hangs beside the torso.
const PRESS_WRIST_RISE = 0.9;
const PRESS_ELBOW_RISE = 0.3;
const HANG_ELBOW_DROP = 0.45;
const CURL_WRIST_DROP = 0.6;
const DOWN_WRIST_DROP = 0.9;
const RACK_ELBOW_DROP = 0.2;

/** 'press' (lockout), 'curl' (flexed, elbow hanging), 'down' (arm hanging), 'rack', or null. */
export function armShape(pose, side) {
  if (!pose || pose.length < POSE_LANDMARKS) return null;
  if ([11, 12, 23, 24].some((i) => (pose[i]?.visibility ?? 0) < 0.3)) return null;
  const m1 = mid(pose[11], pose[12]);
  const m2 = mid(pose[23], pose[24]);
  const torso = Math.hypot(m1.x - m2.x, m1.y - m2.y);
  if (!(torso > 0.01)) return null;
  const arm = (s) => {
    const [sh, el, wr] = ARM[s];
    if ([el, wr].some((i) => (pose[i]?.visibility ?? 0) < 0.3)) return null;
    return { elbow: (pose[el].y - pose[sh].y) / torso, wrist: (pose[wr].y - pose[sh].y) / torso };
  };
  const both = [arm('left'), arm('right')];
  if (both.every((a) => a && a.wrist < -PRESS_WRIST_RISE && a.elbow < -PRESS_ELBOW_RISE)) return 'press';
  const a = arm(side);
  if (!a) return null;
  if (a.elbow > HANG_ELBOW_DROP) {
    if (a.wrist < CURL_WRIST_DROP) return 'curl';
    if (a.wrist > DOWN_WRIST_DROP) return 'down';
  }
  if (a.elbow < RACK_ELBOW_DROP && a.wrist < 0) return 'rack';
  return null;
}

// Push-ups from body-line geometry (side view), in torso lengths. Hypotheses under test, from
// simulation only: the torso is within ~50° of horizontal through a push-up (knee push-ups are
// the steepest, ~40° at the top); a bent knee (hip–knee–ankle < 160°) or an ankle raised above
// the knee means the knees are the floor contact; hands well above the feet means an incline.
const PUSHUP_MAX_TORSO_DEG = 55;
const UPRIGHT_MIN_TORSO_DEG = 65;
const KNEE_BENT_DEG = 160;
const ANKLE_ABOVE_KNEE = 0.15;
const INCLINE_HANDS_ABOVE_FEET = 0.4;
const FLOOR_HANDS_FEET = 0.6; // hands and knees/feet near the same floor height

/**
 * { shape: 'pushup'|'upright'|null, variant: 'standard'|'knee'|'incline'|null, floor, torsoDeg }.
 * floor: hands at floor level with the knees/feet (used to spot push-ups in another lift's mode).
 */
export function pushupShape(pose, side) {
  const none = { shape: null, variant: null, floor: false, torsoDeg: null };
  if (!pose || pose.length < POSE_LANDMARKS) return none;
  const [s, , w] = ARM[side];
  const [h, k, a] = LEG[side];
  if ([s, h].some((i) => (pose[i]?.visibility ?? 0) < 0.5)) return none;
  const torso = Math.hypot(pose[s].x - pose[h].x, pose[s].y - pose[h].y);
  if (!(torso > 0.01)) return none;
  const torsoDeg = (Math.atan2(Math.abs(pose[s].y - pose[h].y), Math.abs(pose[s].x - pose[h].x)) * 180) / Math.PI;
  if (torsoDeg >= UPRIGHT_MIN_TORSO_DEG) return { ...none, shape: 'upright', torsoDeg };
  if (torsoDeg > PUSHUP_MAX_TORSO_DEG) return { ...none, torsoDeg };
  const handsOk = (pose[w]?.visibility ?? 0) >= 0.5 && pose[w].y > pose[s].y;
  if (![k, a].every((i) => (pose[i]?.visibility ?? 0) >= 0.5)) return { ...none, shape: 'pushup', torsoDeg };
  const knee = jointAngle(pose[h], pose[k], pose[a]);
  const ankleAboveKnee = (pose[k].y - pose[a].y) / torso;
  let variant = 'standard';
  if ((knee !== null && knee < KNEE_BENT_DEG) || ankleAboveKnee > ANKLE_ABOVE_KNEE) variant = 'knee';
  else if (handsOk && (pose[a].y - pose[w].y) / torso > INCLINE_HANDS_ABOVE_FEET) variant = 'incline';
  const lowest = Math.max(pose[k].y, pose[a].y);
  const floor = handsOk && Math.abs(lowest - pose[w].y) / torso < FLOOR_HANDS_FEET;
  return { shape: 'pushup', variant, floor, torsoDeg };
}
