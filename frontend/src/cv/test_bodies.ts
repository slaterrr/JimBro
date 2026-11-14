/**
 * Synthetic 3D bodies for movement tests (not shipped). A body is posed in 3D
 * (metres; x = person's left, y = up, z = forward), legs solved as two-link
 * chains with knees bending forward, then "filmed": rotated by the camera yaw,
 * projected orthographically to normalised image landmarks (with
 * visibility lower for the far side), and also returned as MediaPipe-style
 * hip-centred world landmarks.
 *
 * yaw 0 = camera in front of the person, 90 = camera at the person's right
 * side (side view), 45 = diagonal.
 */

import { POSE_LANDMARKS as L, type LandmarkLike, type WorldLandmarkLike } from "./pose_detection";
import type { Recording } from "./validation/format";
import { RECORDING_SCHEMA } from "./validation/format";

export interface Build {
  /** Standing hip height (≈ leg length), m. */
  legLength: number;
  /** Hip to shoulder, m. */
  torso: number;
  /** Half the distance between the feet side to side, m. */
  stanceHalfWidth: number;
}

export const AVERAGE: Build = { legLength: 0.9, torso: 0.5, stanceHalfWidth: 0.15 };
export const SHORT_LEGS: Build = { legLength: 0.78, torso: 0.56, stanceHalfWidth: 0.13 };
export const LONG_LEGS: Build = { legLength: 1.02, torso: 0.46, stanceHalfWidth: 0.17 };

export interface BodyPose {
  /** Hip height as a fraction of standing leg length (1 = standing). */
  hipHeight: number;
  /** Hip centre forward offset, m. */
  hipZ: number;
  /** Torso pitch forward from vertical, degrees. */
  torsoPitch: number;
  /** Foot positions on the floor (x side, z forward), m. */
  leftFoot: { x: number; z: number };
  rightFoot: { x: number; z: number };
}

type P3 = { x: number; y: number; z: number };
const ANKLE_H = 0.08;

function leg(hip: P3, ankle: P3, thigh: number, shin: number): P3 {
  const d = { x: ankle.x - hip.x, y: ankle.y - hip.y, z: ankle.z - hip.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const mid = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2, z: (hip.z + ankle.z) / 2 };
  if (len >= thigh + shin - 1e-6) return mid;
  const h = Math.sqrt(Math.max(0, thigh ** 2 - (len / 2) ** 2));
  // Bend direction: forward (+z), made perpendicular to the hip→ankle line.
  const u = { x: d.x / len, y: d.y / len, z: d.z / len };
  const f = { x: 0, y: 0, z: 1 };
  const k = f.x * u.x + f.y * u.y + f.z * u.z;
  const b = { x: f.x - k * u.x, y: f.y - k * u.y, z: f.z - k * u.z };
  const bl = Math.hypot(b.x, b.y, b.z) || 1;
  return { x: mid.x + (b.x / bl) * h, y: mid.y + (b.y / bl) * h, z: mid.z + (b.z / bl) * h };
}

/** 33 body points in the person's frame. */
export function body(build: Build, p: BodyPose): P3[] {
  const pts: P3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 1, z: 0 }));
  const seg = (build.legLength - ANKLE_H) / 2;
  const hipY = ANKLE_H + (build.legLength - ANKLE_H) * p.hipHeight;
  const hw = 0.1;
  const lh = { x: hw, y: hipY, z: p.hipZ };
  const rh = { x: -hw, y: hipY, z: p.hipZ };
  const la = { x: p.leftFoot.x, y: ANKLE_H, z: p.leftFoot.z };
  const ra = { x: p.rightFoot.x, y: ANKLE_H, z: p.rightFoot.z };
  const pitch = (p.torsoPitch * Math.PI) / 180;
  const up = { x: 0, y: Math.cos(pitch), z: Math.sin(pitch) };
  const sh = (side: 1 | -1) => ({ x: side * 0.18, y: hipY + build.torso * up.y, z: p.hipZ + build.torso * up.z });
  const ls = sh(1);
  const rs = sh(-1);
  const set = (i: number, q: P3) => (pts[i] = q);
  set(L.LEFT_HIP, lh);
  set(L.RIGHT_HIP, rh);
  set(L.LEFT_ANKLE, la);
  set(L.RIGHT_ANKLE, ra);
  set(L.LEFT_KNEE, leg(lh, la, seg, seg));
  set(L.RIGHT_KNEE, leg(rh, ra, seg, seg));
  set(L.LEFT_HEEL, { x: la.x, y: 0.03, z: la.z - 0.06 });
  set(L.RIGHT_HEEL, { x: ra.x, y: 0.03, z: ra.z - 0.06 });
  set(L.LEFT_FOOT_INDEX, { x: la.x, y: 0.02, z: la.z + 0.16 });
  set(L.RIGHT_FOOT_INDEX, { x: ra.x, y: 0.02, z: ra.z + 0.16 });
  set(L.LEFT_SHOULDER, ls);
  set(L.RIGHT_SHOULDER, rs);
  // Arms hang from the shoulders.
  set(L.LEFT_ELBOW, { x: ls.x + 0.02, y: ls.y - 0.28, z: ls.z });
  set(L.RIGHT_ELBOW, { x: rs.x - 0.02, y: rs.y - 0.28, z: rs.z });
  set(L.LEFT_WRIST, { x: ls.x + 0.02, y: ls.y - 0.53, z: ls.z + 0.03 });
  set(L.RIGHT_WRIST, { x: rs.x - 0.02, y: rs.y - 0.53, z: rs.z + 0.03 });
  set(L.NOSE, { x: 0, y: ls.y + 0.2 * up.y, z: ls.z + 0.2 * up.z + 0.1 });
  return pts;
}

export interface Shot {
  lm: LandmarkLike[];
  world: WorldLandmarkLike[];
}

/** Film a body from `yawDeg` (see file comment). Image aspect 16:9. */
/** Seeded random numbers, so noisy tests are reproducible. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, gauss: () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next()) };
}

export function film(
  pts: readonly P3[],
  yawDeg: number,
  hidden: ReadonlySet<number> = new Set(),
  noise: { sd: number; rng: ReturnType<typeof seeded> } | null = null,
): Shot {
  const a = (yawDeg * Math.PI) / 180;
  // Camera frame: X right in image, Y up, D = depth away from the camera.
  const cam = pts.map((p) => ({
    X: -p.x * Math.cos(a) + p.z * Math.sin(a),
    Y: p.y,
    D: -p.z * Math.cos(a) - p.x * Math.sin(a),
  }));
  const hipD = (cam[L.LEFT_HIP]!.D + cam[L.RIGHT_HIP]!.D) / 2;
  const scale = 0.42; // ≈ 0.75 of the frame height for a 1.8 m person
  const ar = 16 / 9;
  const jitter = () => (noise ? noise.rng.gauss() * noise.sd : 0);
  const lm = cam.map((c, i) => ({
    x: 0.5 + (c.X * scale) / ar + jitter() / ar,
    y: 0.92 - c.Y * scale + jitter(),
    z: 0,
    // Far-side points are less confident, as with MediaPipe.
    visibility: hidden.has(i) ? 0.05 : 0.95 - 0.4 * Math.min(1, Math.max(0, (c.D - hipD) / 0.2)),
  }));
  const mid = { X: (cam[L.LEFT_HIP]!.X + cam[L.RIGHT_HIP]!.X) / 2, Y: (cam[L.LEFT_HIP]!.Y + cam[L.RIGHT_HIP]!.Y) / 2, D: hipD };
  // MediaPipe world: metres, hip-centred, y down, z away from the camera.
  // World depth from a single camera is the noisiest coordinate: 3× the image noise.
  const world = cam.map((c) => ({
    x: c.X - mid.X + jitter() / scale,
    y: -(c.Y - mid.Y) + jitter() / scale,
    z: c.D - mid.D + (3 * jitter()) / scale,
  }));
  return { lm, world };
}

// ---- movements (each returns a pose for phase k in 0..1) ----------------------

const smooth = (k: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;
const bump = (k: number) => (1 - Math.cos(2 * Math.PI * Math.min(1, Math.max(0, k)))) / 2;

export type Movement = (k: number, b: Build) => BodyPose;

const standing = (b: Build): BodyPose => ({
  hipHeight: 1,
  hipZ: 0,
  torsoPitch: 3,
  leftFoot: { x: b.stanceHalfWidth, z: 0 },
  rightFoot: { x: -b.stanceHalfWidth, z: 0 },
});

export const stand: Movement = (_k, b) => standing(b);

/**
 * Squat to `depth` (1 ≈ thighs parallel or a little below). `stagger` puts the
 * left foot this fraction of leg length ahead (a natural, slightly staggered
 * stance); `lean` scales the forward torso lean.
 */
export const squatMove = (depth = 1, stagger = 0, lean = 1): Movement => (k, b) => {
  const d = bump(k) * depth;
  const p = standing(b);
  p.leftFoot.z = stagger * b.legLength;
  return { ...p, hipHeight: 1 - 0.5 * d, hipZ: -0.16 * d * b.legLength + (stagger * b.legLength) / 2, torsoPitch: 3 + 35 * d * lean };
};

/**
 * Lunge: step out with `lead` foot (forward or back), lower, rise, step back.
 * Phases: 0–0.25 step, 0.25–0.75 down and up, 0.75–1 step back.
 */
export const lungeMove = (lead: "left" | "right", dir: "forward" | "reverse" = "forward", depth = 1): Movement => (k, b) => {
  const step = k < 0.25 ? smooth(k / 0.25) : k > 0.75 ? 1 - smooth((k - 0.75) / 0.25) : 1;
  const d = k >= 0.25 && k <= 0.75 ? bump((k - 0.25) / 0.5) * depth : 0;
  const len = 0.85 * b.legLength * step;
  const moving = dir === "forward" ? len : -len;
  const p = standing(b);
  const foot = lead === "left" ? "leftFoot" : "rightFoot";
  p[foot] = { x: p[foot].x * 0.6, z: moving };
  return { ...p, hipZ: moving / 2, hipHeight: 1 - 0.47 * d - 0.04 * step, torsoPitch: 4 };
};

/** A few walking steps on the spot direction (forward), knees bending a little. */
export const walkMove: Movement = (k, b) => {
  const cycle = (k * 2) % 1;
  const swingLeft = k < 0.5;
  const s = 0.45 * b.legLength;
  const base = Math.floor(k * 2) * s;
  const p = standing(b);
  p.leftFoot.z = swingLeft ? base + s * smooth(cycle) : base + s;
  p.rightFoot.z = swingLeft ? base : base + s * smooth(cycle) + (k >= 0.5 ? 0 : 0);
  return { ...p, hipZ: (p.leftFoot.z + p.rightFoot.z) / 2, hipHeight: 0.97 - 0.05 * bump(cycle) };
};

/** Bend forward at the hips with nearly straight legs (toe touch / good morning). */
export const bendMove: Movement = (k, b) => {
  const d = bump(k);
  return { ...standing(b), hipHeight: 1 - 0.04 * d, hipZ: -0.2 * d * b.legLength, torsoPitch: 3 + 95 * d };
};

export interface Segment {
  move: Movement;
  ms: number;
  /** Landmark indices hidden during this segment. */
  hidden?: ReadonlySet<number>;
}

/** Film a sequence of movements into a Recording at ~30 fps. */
export function recordMovements(
  segments: readonly Segment[],
  yawDeg: number,
  build: Build = AVERAGE,
  /** Landmark noise as a fraction of frame height (e.g. 0.006), seeded. */
  noise: { sd: number; seed: number } | null = null,
): Recording {
  const rng = noise ? seeded(noise.seed) : null;
  const frames: Recording["frames"] = [];
  let t = 0;
  for (const seg of segments) {
    const n = Math.max(1, Math.round(seg.ms / 33));
    for (let i = 0; i < n; i++) {
      const shot = film(body(build, seg.move(i / (n - 1 || 1), build)), yawDeg, seg.hidden, rng && noise ? { sd: noise.sd, rng } : null);
      frames.push({
        t,
        lm: shot.lm.map((p) => [p.x, p.y, p.z ?? 0, p.visibility ?? 0]),
        world: shot.world.map((p) => [p.x, p.y, p.z]),
        detectMs: 0,
      });
      t += 33;
    }
  }
  return {
    schema: RECORDING_SCHEMA,
    id: "synthetic",
    createdAt: "",
    subjectId: "synthetic",
    source: { fileName: "synthetic", sha256: "x", bytes: 0, durationSec: t / 1000, width: 1600, height: 900, mirrored: false },
    extraction: { model: "synthetic", mediapipe: "n/a", sampleMs: 33, extractedAt: "" },
    frames,
    annotations: [],
  };
}

export const LEFT_LEG = new Set<number>([L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE, L.LEFT_HEEL, L.LEFT_FOOT_INDEX]);
