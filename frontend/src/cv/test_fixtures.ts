/** Synthetic side-view poses for tests. Not shipped. */

import { POSE_LANDMARKS as L, type BodySide, type LandmarkLike } from "./pose_detection";

export interface PoseSpec {
  /** +1 = facing image right, -1 = facing image left. */
  facing: 1 | -1;
  /** Which MediaPipe leg is in front. */
  frontLabel: BodySide;
  /** 0 = standing, 1.2 = bottom of a full lunge. */
  depth: number;
  /** 0 = feet together, 1 = full split. */
  split: number;
  /** Visibility of the near (camera-side) leg and far leg. */
  nearLabel?: BodySide;
  farVis?: number;
}

const THIGH = 0.2;
const SHIN = 0.2;

/** Two-link leg: knee placed between hip and ankle, bending toward `facing`. */
export function knee(hip: [number, number], ankle: [number, number], facing: 1 | -1): [number, number] {
  const dx = ankle[0] - hip[0];
  const dy = ankle[1] - hip[1];
  const d = Math.hypot(dx, dy);
  const mid: [number, number] = [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2];
  if (d >= THIGH + SHIN) return mid;
  const h = Math.sqrt(THIGH ** 2 - (d / 2) ** 2);
  // Unit perpendicular; pick the one pointing the way the user faces.
  let px = -dy / d;
  let py = dx / d;
  if (px * facing < 0) {
    px = -px;
    py = -py;
  }
  return [mid[0] + px * h, mid[1] + py * h];
}

export function pose(p: PoseSpec): LandmarkLike[] {
  const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i: number, x: number, y: number, v = 0.95) => (lm[i] = { x, y, visibility: v });
  const f = p.facing;
  const hip: [number, number] = [0.5, 0.45 + 0.2 * p.depth];
  const frontAnkle: [number, number] = [0.5 + f * 0.25 * p.split, 0.85];
  const backAnkle: [number, number] = [0.5 - f * 0.3 * p.split, 0.85];
  const near = p.nearLabel ?? "left";
  const farVis = p.farVis ?? 0.7;
  const backLabel: BodySide = p.frontLabel === "left" ? "right" : "left";
  for (const [label, ankle] of [
    [p.frontLabel, frontAnkle],
    [backLabel, backAnkle],
  ] as const) {
    const v = label === near ? 0.95 : farVis;
    const i =
      label === "left"
        ? { hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE, heel: L.LEFT_HEEL, toe: L.LEFT_FOOT_INDEX }
        : { hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE, heel: L.RIGHT_HEEL, toe: L.RIGHT_FOOT_INDEX };
    const k = knee(hip, ankle, f);
    set(i.hip, hip[0], hip[1], v);
    set(i.knee, k[0], k[1], v);
    set(i.ankle, ankle[0], ankle[1], v);
    set(i.heel, ankle[0] - f * 0.02, ankle[1] + 0.02, v);
    set(i.toe, ankle[0] + f * 0.05, ankle[1] + 0.03, v);
  }
  const sy = 0.2 + 0.2 * p.depth;
  set(L.LEFT_SHOULDER, 0.5, sy);
  set(L.RIGHT_SHOULDER, 0.5, sy, 0.7);
  set(L.NOSE, 0.5 + f * 0.05, sy - 0.08);
  return lm;
}


/** Standing → step out → down → up → step back → standing. */
export function lungeRep(facing: 1 | -1, frontLabel: BodySide, extra: Partial<PoseSpec> = {}): PoseSpec[] {
  const out: PoseSpec[] = [];
  const add = (n: number, f: (k: number) => Partial<PoseSpec>) => {
    for (let k = 0; k <= n; k++) out.push({ facing, frontLabel, depth: 0, split: 0, ...extra, ...f(k / n) });
  };
  add(8, () => ({}));
  add(8, (k) => ({ split: k }));
  add(20, (k) => ({ split: 1, depth: 1.2 * k }));
  add(20, (k) => ({ split: 1, depth: 1.2 * (1 - k) }));
  add(8, (k) => ({ split: 1 - k }));
  add(8, () => ({}));
  return out;
}

