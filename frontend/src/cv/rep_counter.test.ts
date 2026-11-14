import { describe, expect, it } from "vitest";
import { pushup } from "./exercises/pushup";
import { shoulderPress } from "./exercises/shoulder_press";
import { squat } from "./exercises/squat";
import { bicepCurl } from "./exercises/bicep_curl";
import { BaselineDropMeter, RepCounter, type RepCounterConfig, type RepCounterEvent } from "./rep_counter";
import { hold, sequence, squat as dip, type Sample } from "./test_utils";

/** Squat thresholds without the hip-drop check, for angle-only tests. */
const SQUAT_ANGLE_ONLY: RepCounterConfig = { ...squat.counter, minProgress: 0 };

function run(samples: Array<Sample & { progress?: number | null }>, counter = new RepCounter(SQUAT_ANGLE_ONLY)) {
  const events: RepCounterEvent[] = [];
  for (const s of samples) {
    const e = counter.update(s.t, s.knee, s.progress ?? null);
    if (e) events.push(e);
  }
  return {
    counter,
    events,
    reps: events.flatMap((e) => (e.type === "rep" ? [e.rep] : [])),
    rejected: events.flatMap((e) => (e.type === "rejected" ? [e.rejected] : [])),
  };
}

const oneSquat = (bottom = 80) => sequence((t) => hold(t, 500, 175), (t) => dip(t, 2000, bottom), (t) => hold(t, 300, 175));

describe("RepCounter (squat thresholds, decreasing angle)", () => {
  it("counts clean reps", () => {
    const { reps, rejected, counter } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => dip(t, 2000, 80),
        (t) => hold(t, 300, 175),
        (t) => dip(t, 2000, 82),
        (t) => hold(t, 300, 175),
        (t) => dip(t, 1800, 75),
        (t) => hold(t, 300, 175),
      ),
    );
    expect(reps.map((r) => r.repNumber)).toEqual([1, 2, 3]);
    expect(rejected).toEqual([]);
    expect(counter.repCount).toBe(3);
    expect(counter.phase).toBe("start");
  });

  it("measures duration, peak angle and phase timings", () => {
    const rep = run(oneSquat()).reps[0]!;
    // Duration runs from leaving the start zone to returning to it, so the
    // near-straight top of the 2 s cosine isn't included.
    expect(rep.durationMs).toBeGreaterThan(1300);
    expect(rep.durationMs).toBeLessThan(2000);
    expect(rep.peakAngle).toBeCloseTo(80, 0);
    expect(rep.toPeakMs + rep.peakHoldMs + rep.returnMs).toBeCloseTo(rep.durationMs);
    expect(rep.toPeakMs).toBeGreaterThan(0);
    expect(rep.returnMs).toBeGreaterThan(0);
  });

  it("rejects a partial rep and does not count it", () => {
    for (const bottom of [100, 105, 110, 120]) {
      const { reps, rejected } = run(oneSquat(bottom));
      expect(reps).toEqual([]);
      expect(rejected.map((r) => r.reason)).toEqual(["PARTIAL_RANGE"]);
    }
  });

  it("ignores small dips as noise", () => {
    expect(run(oneSquat(145)).events).toEqual([]);
  });

  it("does not count until the start position has been seen (starting mid-rep)", () => {
    const { reps } = run(
      sequence((t) => hold(t, 500, 80), (t) => hold(t, 500, 175), (t) => dip(t, 2000, 80), (t) => hold(t, 300, 175)),
    );
    expect(reps.length).toBe(1);
  });

  it("doesn't double count when the angle jitters around thresholds", () => {
    const { reps } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => dip(t, 2400, 75, 175, 6),
        (t) => hold(t, 400, 175),
        (t) => dip(t, 2400, 75, 175, 6),
        (t) => hold(t, 400, 175),
      ),
    );
    expect(reps.length).toBe(2);
  });

  it("counts a bounce at the bottom as one rep", () => {
    const samples: Sample[] = [
      ...hold(0, 500, 175),
      ...[160, 140, 120, 100, 85, 78, 90, 110, 95, 82, 100, 130, 150, 165, 175].map((knee, i) => ({ t: 500 + i * 120, knee })),
      ...hold(500 + 15 * 120, 300, 175),
    ];
    const { reps } = run(samples);
    expect(reps.length).toBe(1);
    expect(reps[0]!.peakAngle).toBe(78);
  });

  it("rejects reps that are too fast", () => {
    const { reps, rejected } = run(sequence((t) => hold(t, 500, 175), (t) => dip(t, 300, 80), (t) => hold(t, 300, 175)));
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["TOO_FAST"]);
  });

  it("rejects reps that are too slow", () => {
    const { reps, rejected } = run(
      sequence((t) => hold(t, 500, 175), (t) => dip(t, 1000, 80).slice(0, 16), (t) => hold(t, 13_000, 80), (t) => hold(t, 300, 175)),
    );
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["TOO_SLOW"]);
  });

  it("stays quiet about a very long incomplete attempt (a rest, not a rep)", () => {
    const { events } = run(
      sequence((t) => hold(t, 500, 175), (t) => hold(t, 13_000, 120), (t) => hold(t, 300, 175)),
    );
    expect(events).toEqual([]);
  });

  it("pauses through a short tracking dropout and still counts the rep", () => {
    const withGap = dip(0, 2000, 80).map((s, i) => (i > 25 && i < 33 ? { ...s, knee: null } : s));
    const { reps } = run(
      sequence((t) => hold(t, 500, 175), (t) => withGap.map((s) => ({ ...s, t: s.t + t })), (t) => hold(t, 300, 175)),
    );
    expect(reps.length).toBe(1);
  });

  it("aborts a rep when tracking is lost for too long, and needs a fresh start", () => {
    const { reps, rejected, counter } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => dip(t, 2000, 80).slice(0, 25),
        (t) => hold(t, 1000, null),
        (t) => hold(t, 300, 90),
        (t) => hold(t, 300, 175),
      ),
    );
    expect(rejected.map((r) => r.reason)).toEqual(["TRACKING_LOST"]);
    expect(reps).toEqual([]);
    expect(counter.repCount).toBe(0);
    expect(counter.armed).toBe(true);
  });

  it("cancelCurrentRep drops the rep in progress but keeps the count", () => {
    const counter = new RepCounter(SQUAT_ANGLE_ONLY);
    run(oneSquat(), counter);
    run(dip(10_000, 2000, 80).slice(0, 30), counter);
    expect(counter.phase).not.toBe("start");
    counter.cancelCurrentRep();
    expect(counter.repCount).toBe(1);
    expect(counter.phase).toBe("start");
    expect(counter.armed).toBe(false);
  });

  it("configure changes thresholds live, keeps the count, rejects invalid values", () => {
    const counter = new RepCounter(SQUAT_ANGLE_ONLY);
    run(oneSquat(), counter);
    counter.configure({ peakAngle: 70 });
    const { rejected } = run(oneSquat(80).map((s) => ({ ...s, t: s.t + 10_000 })), counter);
    expect(rejected.map((r) => [r.reason, Math.round(r.peakAngle ?? 0)])).toEqual([["PARTIAL_RANGE", 80]]);
    expect(counter.repCount).toBe(1);
    expect(() => counter.configure({ peakAngle: 145 })).toThrow(RangeError);
    expect(counter.config.peakAngle).toBe(70);
  });

  it("validates its config", () => {
    expect(() => new RepCounter({ ...SQUAT_ANGLE_ONLY, startAngle: 140, leaveStartAngle: 150 })).toThrow(RangeError);
    expect(() => new RepCounter({ ...SQUAT_ANGLE_ONLY, peakAngle: 145 })).toThrow(RangeError);
  });

  it("every built-in exercise has a valid config", () => {
    for (const ex of [squat, pushup, bicepCurl, shoulderPress]) {
      expect(() => new RepCounter(ex.counter)).not.toThrow();
    }
  });
});

describe("progress check (squat hip drop)", () => {
  const withProgress = (samples: Sample[], f: (knee: number) => number) =>
    samples.map((s) => ({ ...s, progress: s.knee === null ? null : f(s.knee) }));
  const real = (k: number) => ((175 - k) / 95) * 0.5;

  it("counts a real squat where the hips drop with the knee", () => {
    const { reps } = run(withProgress(oneSquat(), real), new RepCounter(squat.counter));
    expect(reps.length).toBe(1);
    expect(reps[0]!.maxProgress).toBeCloseTo(0.5, 1);
  });

  it("rejects a bent knee when the hips stay up (raised leg on one foot)", () => {
    const { reps, rejected } = run(withProgress(oneSquat(), () => 0.05), new RepCounter(squat.counter));
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["PROGRESS_NOT_MET"]);
  });

  it("rejects a half squat even if the knee angle misreads deep", () => {
    const { reps } = run(withProgress(oneSquat(), (k) => ((175 - k) / 95) * 0.28), new RepCounter(squat.counter));
    expect(reps).toEqual([]);
  });

  it("falls back to the angle alone when progress isn't measured", () => {
    expect(run(oneSquat(), new RepCounter(squat.counter)).reps.length).toBe(1);
  });
});

describe("RepCounter (shoulder press thresholds, increasing angle)", () => {
  /** Elbow from rack (`low`) up to `high` and back, with hands rising in proportion. */
  function press(t0: number, ms: number, high: number, low = 85, handsTop = 0.95) {
    return dip(t0, ms, -high, -low).map((s) => {
      const elbow = -(s.knee as number);
      return { t: s.t, knee: elbow, progress: 0.4 + ((elbow - low) / (high - low)) * (handsTop - 0.4) };
    });
  }
  const rack = (t: number, ms: number) => hold(t, ms, 85).map((s) => ({ ...s, progress: 0.4 }));

  it("counts a full press to lockout", () => {
    const { reps } = run(
      sequence((t) => rack(t, 500), (t) => press(t, 2000, 170), (t) => rack(t, 300), (t) => press(t, 2000, 168), (t) => rack(t, 300)),
      new RepCounter(shoulderPress.counter),
    );
    expect(reps.map((r) => r.repNumber)).toEqual([1, 2]);
    expect(reps[0]!.peakAngle).toBeCloseTo(170, 0);
  });

  it("rejects a half press", () => {
    const { reps, rejected } = run(
      sequence((t) => rack(t, 500), (t) => press(t, 2000, 140, 85, 0.7), (t) => rack(t, 300)),
      new RepCounter(shoulderPress.counter),
    );
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["PARTIAL_RANGE"]);
  });

  it("rejects straight arms that aren't overhead (e.g. arms out to the side)", () => {
    const { reps, rejected } = run(
      sequence((t) => rack(t, 500), (t) => press(t, 2000, 170, 85, 0.45), (t) => rack(t, 300)),
      new RepCounter(shoulderPress.counter),
    );
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["PROGRESS_NOT_MET"]);
  });

  it("doesn't arm or count while the arms hang down before the set", () => {
    const hanging = (t: number, ms: number) => hold(t, ms, 170).map((s) => ({ ...s, progress: -0.9 }));
    const { events, counter } = run(sequence((t) => hanging(t, 2000)), new RepCounter(shoulderPress.counter));
    expect(events).toEqual([]);
    expect(counter.armed).toBe(false);
  });
});

describe("BaselineDropMeter", () => {
  it("returns null until a start baseline exists", () => {
    expect(new BaselineDropMeter().update(0.5, 0.4, false)).toBeNull();
  });

  it("measures drop as a fraction of the reference length", () => {
    const m = new BaselineDropMeter(1);
    expect(m.update(0.45, 0.4, true)).toBeCloseTo(0);
    expect(m.update(0.65, 0.3, false)).toBeCloseTo(0.5);
    expect(m.update(0.4, 0.4, false)).toBeCloseTo(-0.125);
  });

  it("only learns the baseline in the start position, and resets", () => {
    const m = new BaselineDropMeter(1);
    m.update(0.45, 0.4, true);
    m.update(0.65, 0.3, false);
    expect(m.update(0.65, 0.3, false)).toBeCloseTo(0.5);
    expect(m.update(null, 0.4, false)).toBeNull();
    m.reset();
    expect(m.update(0.6, 0.4, false)).toBeNull();
  });
});
