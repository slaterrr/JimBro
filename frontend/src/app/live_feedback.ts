/**
 * Live feedback state for the workout screen, kept free of DOM code so it can
 * be tested.
 *
 *  - FeedbackFeed: the list of recent observations. The same code within
 *    `windowMs` is merged (×2, ×3…) instead of repeated; position hints live
 *    in a single slot that's replaced or cleared, never stacked; and a
 *    "not counted" note is marked resolved once a later rep counts, so the
 *    screen never shows "not counted" next to a fresh count without context.
 *  - SessionClock: workout duration excluding paused time.
 */

import type { FormFlag, MetricSource } from "../../../shared/types";

export interface FeedItem {
  id: number;
  code: string;
  message: string;
  source: MetricSource;
  kind: "form" | "not-counted";
  /** ms, of the latest occurrence. */
  t: number;
  count: number;
  /** Rep it applies to, if any. */
  rep: number | null;
  /** A later rep counted after this "not counted" note. */
  resolved: boolean;
}

export class FeedbackFeed {
  private items: FeedItem[] = [];
  private nextId = 1;
  private hintText: string | null = null;

  constructor(
    private readonly windowMs = 10_000,
    private readonly maxItems = 6,
  ) {}

  /** Form flags of a counted rep. */
  addRep(repNumber: number, flags: readonly FormFlag[], t: number): void {
    for (const it of this.items) if (it.kind === "not-counted") it.resolved = true;
    for (const f of flags) this.push({ code: f.code, message: f.message, source: f.source, kind: "form", rep: repNumber }, t);
  }

  /** An attempt that wasn't counted. */
  addRejection(flag: FormFlag, t: number): void {
    this.push({ code: flag.code, message: flag.message, source: flag.source, kind: "not-counted", rep: null }, t);
  }

  /** Current position hint or camera warning (null clears it). */
  setHint(text: string | null): void {
    this.hintText = text;
  }

  get hint(): string | null {
    return this.hintText;
  }

  list(): readonly FeedItem[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    this.hintText = null;
  }

  private push(x: Omit<FeedItem, "id" | "t" | "count" | "resolved">, t: number): void {
    const same = this.items.find((i) => i.code === x.code && i.kind === x.kind && t - i.t <= this.windowMs);
    if (same) {
      same.count += 1;
      same.t = t;
      same.rep = x.rep ?? same.rep;
      same.resolved = false;
      this.items = [same, ...this.items.filter((i) => i !== same)];
      return;
    }
    this.items = [{ ...x, id: this.nextId++, t, count: 1, resolved: false }, ...this.items].slice(0, this.maxItems);
  }
}

export class SessionClock {
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private stoppedAt: number | null = null;

  start(t: number): void {
    this.startedAt = t;
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.stoppedAt = null;
  }

  pause(t: number): void {
    if (this.startedAt !== null && this.pausedAt === null && this.stoppedAt === null) this.pausedAt = t;
  }

  resume(t: number): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += t - this.pausedAt;
      this.pausedAt = null;
    }
  }

  stop(t: number): void {
    if (this.startedAt === null || this.stoppedAt !== null) return;
    this.resume(t);
    this.stoppedAt = t;
  }

  /** Active (unpaused) time in ms. */
  elapsed(t: number): number {
    if (this.startedAt === null) return 0;
    const end = this.stoppedAt ?? this.pausedAt ?? t;
    return Math.max(0, end - this.startedAt - this.pausedTotal);
  }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Display names and units for live form signals. Signals not listed aren't shown. */
export const SIGNAL_LABELS: Record<string, { label: string; unit: "deg" | "pct" | "ratio" }> = {
  frontKnee: { label: "Front knee", unit: "deg" },
  backKnee: { label: "Back knee", unit: "deg" },
  hipAngle: { label: "Hip angle", unit: "deg" },
  kneeAngle: { label: "Knee angle", unit: "deg" },
  torsoLean: { label: "Torso lean", unit: "deg" },
  leftElbow: { label: "Left elbow", unit: "deg" },
  rightElbow: { label: "Right elbow", unit: "deg" },
  elbowDrift: { label: "Upper arm vs torso", unit: "deg" },
  armDiff: { label: "Arm difference", unit: "deg" },
  handsUp: { label: "Hands above shoulders", unit: "pct" },
  stepRatio: { label: "Step length", unit: "pct" },
  kneeRatio: { label: "Knee ÷ ankle width", unit: "ratio" },
  bodyLine: { label: "Body line", unit: "deg" },
};

export function formatSignal(key: string, v: number | null): string | null {
  const meta = SIGNAL_LABELS[key];
  if (!meta || v === null) return null;
  if (meta.unit === "deg") return `${Math.round(Math.abs(v))}°`;
  if (meta.unit === "pct") return `${Math.round(v * 100)}%`;
  return v.toFixed(2);
}
