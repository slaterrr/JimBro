/**
 * Reusable joint-angle maths. Pure functions, no MediaPipe or DOM dependency.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D extends Point2D {
  z: number;
}

const RAD_TO_DEG = 180 / Math.PI;
/** Segments shorter than this (in input units) are treated as degenerate. */
const MIN_SEGMENT_LENGTH = 1e-6;

/**
 * Angle at joint `b` formed by segments b→a and b→c, in degrees (0–180).
 * Uses x/y only, which is what a single camera measures reliably.
 *
 * `aspectRatio` (width / height) corrects MediaPipe's normalised coordinates,
 * where x and y are scaled by different image dimensions. Pass the video's
 * width / height; leave as 1 for pixel coordinates.
 *
 * Returns null when either segment has (near) zero length.
 */
export function calculateAngle(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  aspectRatio = 1,
): number | null {
  const v1x = (a.x - b.x) * aspectRatio;
  const v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspectRatio;
  const v2y = c.y - b.y;
  return angleBetween([v1x, v1y], [v2x, v2y]);
}

/**
 * 3D variant using x/y/z. MediaPipe's z is an estimate of depth from a
 * monocular camera, so angles from this function should be labelled
 * "estimated", not "measured".
 */
export function calculateAngle3D(a: Point3D, b: Point3D, c: Point3D): number | null {
  return angleBetween([a.x - b.x, a.y - b.y, a.z - b.z], [c.x - b.x, c.y - b.y, c.z - b.z]);
}

function angleBetween(v1: number[], v2: number[]): number | null {
  let dot = 0;
  let n1 = 0;
  let n2 = 0;
  for (let i = 0; i < v1.length; i++) {
    const p = v1[i] ?? 0;
    const q = v2[i] ?? 0;
    dot += p * q;
    n1 += p * p;
    n2 += q * q;
  }
  const len1 = Math.sqrt(n1);
  const len2 = Math.sqrt(n2);
  if (len1 < MIN_SEGMENT_LENGTH || len2 < MIN_SEGMENT_LENGTH) return null;
  // Clamp to guard against floating-point drift outside [-1, 1].
  const cos = Math.min(1, Math.max(-1, dot / (len1 * len2)));
  return Math.acos(cos) * RAD_TO_DEG;
}

/**
 * Exponential moving average for angle streams, to remove landmark jitter
 * before thresholds are applied.
 *
 * A null input (lost tracking) resets the filter so a stale value is never
 * blended with a fresh one.
 */
export class AngleSmoother {
  private value: number | null = null;

  /** @param alpha 0–1. Higher follows the raw signal more closely. */
  constructor(private readonly alpha = 0.5) {
    if (alpha <= 0 || alpha > 1) throw new RangeError("alpha must be in (0, 1]");
  }

  next(raw: number | null): number | null {
    if (raw === null || Number.isNaN(raw)) {
      this.value = null;
      return null;
    }
    this.value = this.value === null ? raw : this.alpha * raw + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}
