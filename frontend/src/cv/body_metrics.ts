/**
 * Body measurements shared by several exercises. All work on normalised image
 * landmarks (x, y in 0–1) and correct for the video's aspect ratio.
 */

import { POSE_LANDMARKS as L, vis, type BodySide, type LandmarkLike } from "./pose_detection";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Which way the user faces in a side view: +1 toward larger x (image right),
 * -1 toward smaller x, from heel → toe of the given foot. null if the foot
 * isn't visible.
 */
export function facingSign(landmarks: readonly LandmarkLike[], side: BodySide, minVisibility: number): 1 | -1 | null {
  const heel = landmarks[side === "left" ? L.LEFT_HEEL : L.RIGHT_HEEL];
  const toe = landmarks[side === "left" ? L.LEFT_FOOT_INDEX : L.RIGHT_FOOT_INDEX];
  if (!heel || !toe || vis(heel) < minVisibility || vis(toe) < minVisibility) return null;
  const dx = toe.x - heel.x;
  if (Math.abs(dx) < 0.005) return null;
  return dx > 0 ? 1 : -1;
}

/**
 * Torso angle from vertical, degrees, from hip to shoulder. With `facing`
 * (side view) the sign is meaningful: positive = leaning forward (toward the
 * toes), negative = leaning back. Without it, positive = shoulders toward
 * image right.
 */
export function torsoLean(
  shoulder: LandmarkLike,
  hip: LandmarkLike,
  aspectRatio: number,
  facing: 1 | -1 | null = null,
): number {
  const lean = Math.atan2((shoulder.x - hip.x) * aspectRatio, hip.y - shoulder.y) * RAD_TO_DEG;
  return facing === null ? lean : lean * facing;
}

/**
 * Knee-to-ankle separation ratio (front view): horizontal distance between the
 * knees ÷ distance between the ankles. About 1 or more when the knees track
 * over the feet; well below 1 when the knees move inward (dynamic knee valgus).
 * A 2D screening proxy, not a true 3D valgus angle. null when the legs aren't
 * all visible or the feet are too close together to judge.
 */
export function kneeAnkleRatio(landmarks: readonly LandmarkLike[], minVisibility: number): number | null {
  const lk = landmarks[L.LEFT_KNEE];
  const rk = landmarks[L.RIGHT_KNEE];
  const la = landmarks[L.LEFT_ANKLE];
  const ra = landmarks[L.RIGHT_ANKLE];
  if (!lk || !rk || !la || !ra) return null;
  if ([lk, rk, la, ra].some((p) => vis(p) < minVisibility)) return null;
  const ankles = Math.abs(la.x - ra.x);
  if (ankles < 0.03) return null; // feet together: ratio meaningless
  return Math.abs(lk.x - rk.x) / ankles;
}

/**
 * Joint angle in the body's sagittal plane, from 3D world landmarks: the
 * plane through the body perpendicular to the hip-to-hip axis. Unlike a 2D
 * image angle, it doesn't change when the camera isn't exactly side on, so it
 * is a candidate correction for perspective distortion. MediaPipe's depth (z)
 * is the least accurate coordinate, so whether this beats the 2D angle must be
 * measured on annotated recordings (the validation lab reports both).
 */
export function sagittalAngle(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  leftHip: { x: number; y: number; z: number },
  rightHip: { x: number; y: number; z: number },
): number | null {
  const sub = (p: typeof a, q: typeof a) => [p.x - q.x, p.y - q.y, p.z - q.z];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const axis = sub(rightHip, leftHip);
  const len = Math.sqrt(dot(axis, axis));
  if (len < 1e-6) return null;
  const n = axis.map((x) => x / len);
  const flatten = (v: number[]) => {
    const k = dot(v, n);
    return v.map((x, i) => x - k * n[i]!);
  };
  const v1 = flatten(sub(a, b));
  const v2 = flatten(sub(c, b));
  const m = Math.sqrt(dot(v1, v1) * dot(v2, v2));
  if (m < 1e-9) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot(v1, v2) / m))) * 180) / Math.PI;
}
