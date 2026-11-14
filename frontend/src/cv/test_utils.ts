/** Synthetic knee-angle sequences for testing the rep counter. Not shipped. */

export interface Sample {
  t: number;
  knee: number | null;
  hip?: number | null;
}

export const FPS = 30;
const DT = 1000 / FPS;

/** Hold an angle for `ms`. */
export function hold(startT: number, ms: number, knee: number | null): Sample[] {
  const out: Sample[] = [];
  for (let t = startT; t < startT + ms; t += DT) out.push({ t, knee });
  return out;
}

/**
 * One smooth squat: top → `bottom` → top following a cosine, over `ms`.
 * `jitter` adds deterministic ± noise in degrees.
 */
export function squat(startT: number, ms: number, bottom: number, top = 175, jitter = 0): Sample[] {
  const out: Sample[] = [];
  const n = Math.max(2, Math.round(ms / DT));
  for (let i = 0; i <= n; i++) {
    const phase = i / n;
    const depth = (1 - Math.cos(phase * 2 * Math.PI)) / 2; // 0 → 1 → 0
    const noise = jitter ? jitter * Math.sin(i * 2.3) : 0;
    out.push({ t: startT + i * DT, knee: top - (top - bottom) * depth + noise, hip: 170 - 90 * depth });
  }
  return out;
}

/** Concatenate segments so each starts right after the previous one ends. */
export function sequence(...builders: Array<(t: number) => Sample[]>): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  for (const build of builders) {
    const seg = build(t);
    out.push(...seg);
    const last = seg[seg.length - 1];
    t = (last?.t ?? t) + DT;
  }
  return out;
}
