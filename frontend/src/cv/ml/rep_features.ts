/**
 * Rep → feature vector, shared by training (ml/uiprmd) and the app.
 *
 * The same function turns a reference-dataset rep (motion capture, projected
 * to a side view) and a live rep (MediaPipe, side view) into identical
 * numbers, so the model sees the same thing in training and in use.
 *
 * Inputs are per-frame body measurements the app already computes:
 *   knee  – knee angle, hip–knee–ankle (°)
 *   hip   – hip angle, shoulder–hip–knee (°)
 *   lean  – torso angle from vertical, unsigned (°)
 *   drop  – hip drop below standing height ÷ standing leg length (fraction)
 *
 * The rep is cropped the same way for both sources: from the first to the last
 * frame where the knee is bent more than CROP_DEG below its straightest value,
 * then resampled to a fixed number of steps so speed doesn't matter.
 */

export interface RepFrame {
  t: number;
  knee: number | null;
  hip: number | null;
  lean: number | null;
  drop: number | null;
}

export const CHANNELS = ["knee", "hip", "lean", "drop"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Time steps each channel is resampled to. */
export const STEPS = 16;
/** Frames with the knee within this many degrees of its straightest are trimmed as standing. */
export const CROP_DEG = 15;
/** Fewer usable frames than this (after cropping) = not enough evidence. */
export const MIN_FRAMES = 8;
/** Fraction of cropped frames each channel must be present in. */
export const MIN_CHANNEL_COVERAGE = 0.7;

/** Scale each channel to roughly 0–1 before the model's own standardisation. */
const SCALE: Record<Channel, number> = { knee: 180, hip: 180, lean: 90, drop: 1 };

export const FEATURE_NAMES: readonly string[] = [
  ...CHANNELS.flatMap((c) => Array.from({ length: STEPS }, (_, i) => `${c}_${i}`)),
  "knee_min",
  "hip_min",
  "lean_max",
  "drop_max",
  "knee_hip_corr",
];

/**
 * Features for one rep, or null if there isn't enough clean data to judge it.
 * `frames` should include a little standing before and after the rep.
 */
export function repFeatures(frames: readonly RepFrame[]): number[] | null {
  const knees = frames.map((f) => f.knee).filter((v): v is number => v !== null);
  if (knees.length < MIN_FRAMES) return null;
  const straight = Math.max(...knees);
  const bent = (f: RepFrame) => f.knee !== null && f.knee < straight - CROP_DEG;
  const first = frames.findIndex(bent);
  const last = findLastIndex(frames, bent);
  if (first === -1 || last - first + 1 < MIN_FRAMES) return null;
  const rep = frames.slice(first, last + 1);

  const series: Record<Channel, number[]> = { knee: [], hip: [], lean: [], drop: [] };
  for (const c of CHANNELS) {
    const pts = rep.flatMap((f) => (f[c] === null ? [] : [{ t: f.t, v: f[c]! / SCALE[c] }]));
    if (pts.length < Math.max(MIN_FRAMES, MIN_CHANNEL_COVERAGE * rep.length)) return null;
    series[c] = resample(pts, rep[0]!.t, rep[rep.length - 1]!.t, STEPS);
  }

  const summary = [
    Math.min(...series.knee),
    Math.min(...series.hip),
    Math.max(...series.lean),
    Math.max(...series.drop),
    correlation(series.knee, series.hip),
  ];
  return [...CHANNELS.flatMap((c) => series[c]), ...summary];
}

/** Linear resampling of (t, v) points onto `n` evenly spaced times in [t0, t1]. */
export function resample(pts: readonly { t: number; v: number }[], t0: number, t1: number, n: number): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? t0 : t0 + ((t1 - t0) * i) / (n - 1);
    while (j < pts.length - 2 && pts[j + 1]!.t < t) j++;
    const a = pts[j]!;
    const b = pts[Math.min(j + 1, pts.length - 1)]!;
    if (t <= a.t || b.t === a.t) out.push(t <= a.t ? a.v : b.v);
    else if (t >= b.t) out.push(b.v);
    else out.push(a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t));
  }
  return out;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function findLastIndex<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i]!)) return i;
  return -1;
}
