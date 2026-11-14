import type { Landmark, TrackingStatus } from "./tracking";

/** Upper + lower body connections (MediaPipe indices), face omitted for clarity. */
export const SKELETON: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

export const STATUS_COLOR: Record<TrackingStatus, string> = {
  ok: "#22d3ee",
  low: "#f59e0b",
  lost: "#ef4444",
};

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: readonly Landmark[] | null,
  status: TrackingStatus,
  minVisibility = 0.3,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (!pose) return;
  ctx.strokeStyle = STATUS_COLOR[status];
  ctx.fillStyle = STATUS_COLOR[status];
  ctx.lineWidth = 4;
  for (const [a, b] of SKELETON) {
    const p = pose[a];
    const q = pose[b];
    if (!p || !q || (p.visibility ?? 0) < minVisibility || (q.visibility ?? 0) < minVisibility)
      continue;
    ctx.beginPath();
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
    ctx.stroke();
  }
  for (const i of new Set(SKELETON.flat())) {
    const p = pose[i];
    if (!p || (p.visibility ?? 0) < minVisibility) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
