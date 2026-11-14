import { describe, expect, it } from "vitest";
import { squat } from "./exercises/squat";
import { RepCounter } from "./rep_counter";
import { POSITION_FILTER, SignalFilter } from "./signal_filter";
import { hold, sequence, squat as dip, type Sample } from "./test_utils";

const noise = (i: number) => 3 * Math.sin(i * 2.7) + 2 * Math.cos(i * 1.3);

describe("SignalFilter", () => {
  it("removes most jitter while the joint is still", () => {
    const f = new SignalFilter();
    const out: number[] = [];
    for (let i = 0; i < 120; i++) out.push(f.next(170 + noise(i), i * 33)!);
    const tail = out.slice(30);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(4); // raw spread is ~10°
  });

  it("follows a fast movement with little lag", () => {
    const f = new SignalFilter();
    let lastOut = 0;
    // 175° → 85° in 500 ms (≈ 180°/s), then hold.
    for (let i = 0; i <= 15; i++) lastOut = f.next(175 - 6 * i, i * 33)!;
    expect(lastOut).toBeLessThan(100);
    for (let i = 16; i <= 25; i++) lastOut = f.next(85, i * 33)!;
    expect(lastOut).toBeCloseTo(85, 0);
  });

  it("bridges short gaps but not long ones", () => {
    const f = new SignalFilter();
    f.next(120, 0);
    f.next(120, 33);
    expect(f.next(null, 66)).toBeCloseTo(120);
    expect(f.next(null, 150)).toBeCloseTo(120);
    expect(f.next(null, 250)).toBeNull();
    expect(f.getStats().bridged).toBe(2);
    // After a long gap it starts fresh, without blending in the stale value.
    expect(f.next(60, 300)).toBe(60);
  });

  it("rejects a one-frame jump as a glitch, but accepts a real level change", () => {
    const f = new SignalFilter();
    for (let i = 0; i < 10; i++) f.next(130, i * 33);
    expect(f.next(60, 330)).toBeCloseTo(130, 0); // 70° in 33 ms ≈ 2100°/s: rejected, held
    expect(f.getStats().rejected).toBe(1);
    f.next(130, 363);
    // A level that persists past maxConsecutiveRejects is accepted.
    let v = 0;
    for (let i = 0; i < 6; i++) v = f.next(40, 400 + i * 33)!;
    expect(v).toBeLessThan(80);
  });

  it("POSITION_FILTER has no glitch gate", () => {
    const f = new SignalFilter(POSITION_FILTER);
    f.next(0.5, 0);
    expect(f.next(0.9, 33)).toBeGreaterThan(0.5);
    expect(f.getStats().rejected).toBe(0);
  });
});

describe("filtering before counting", () => {
  // A half squat (bottom 110°) with a single glitch frame reading 40°. With the
  // previous fixed EMA (alpha 0.5) this glitch was enough to count the rep.
  function halfSquatWithGlitch(): Sample[] {
    const s = sequence((t) => hold(t, 500, 175), (t) => dip(t, 2000, 110), (t) => hold(t, 400, 175));
    const mid = s.findIndex((p) => p.knee !== null && p.knee < 112);
    s[mid] = { ...s[mid]!, knee: 40 };
    return s;
  }

  function count(samples: Sample[], filter: SignalFilter | null) {
    const c = new RepCounter({ ...squat.counter, minProgress: 0 });
    let reps = 0;
    for (const p of samples) {
      const a = filter ? filter.next(p.knee, p.t) : p.knee;
      if (c.update(p.t, a, null)?.type === "rep") reps += 1;
    }
    return reps;
  }

  it("doesn't let a one-frame glitch turn a half squat into a counted rep", () => {
    expect(count(halfSquatWithGlitch(), new SignalFilter())).toBe(0);
  });

  it("still counts real full-depth reps", () => {
    const reps = sequence((t) => hold(t, 500, 175), (t) => dip(t, 2000, 75), (t) => hold(t, 400, 175), (t) => dip(t, 1500, 80), (t) => hold(t, 400, 175));
    expect(count(reps, new SignalFilter())).toBe(2);
  });
});
