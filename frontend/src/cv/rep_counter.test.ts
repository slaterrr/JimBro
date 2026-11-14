import { describe, expect, it } from "vitest";
import { HipDropMeter, SquatRepCounter, type RepCounterEvent } from "./rep_counter";
import { hold, sequence, squat, type Sample } from "./test_utils";

function run(samples: Sample[], counter = new SquatRepCounter()) {
  const events: RepCounterEvent[] = [];
  for (const s of samples) {
    const e = counter.update(s.t, s.knee, s.hip ?? null);
    if (e) events.push(e);
  }
  return {
    counter,
    events,
    reps: events.flatMap((e) => (e.type === "rep" ? [e.rep] : [])),
    rejected: events.flatMap((e) => (e.type === "rejected" ? [e.rejected] : [])),
  };
}

describe("SquatRepCounter", () => {
  it("counts clean reps", () => {
    const { reps, rejected, counter } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => squat(t, 2000, 80),
        (t) => hold(t, 300, 175),
        (t) => squat(t, 2000, 85),
        (t) => hold(t, 300, 175),
        (t) => squat(t, 1800, 75),
        (t) => hold(t, 300, 175),
      ),
    );
    expect(reps.map((r) => r.repNumber)).toEqual([1, 2, 3]);
    expect(rejected).toEqual([]);
    expect(counter.repCount).toBe(3);
    expect(counter.phase).toBe("standing");
  });

  it("measures duration, depth and phase timings", () => {
    const { reps } = run(sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 80), (t) => hold(t, 300, 175)));
    const rep = reps[0]!;
    // Duration runs from leaving lockout (< descentStartAngle) to lockout again
    // (≥ standingAngle), so the near-straight top of the 2 s cosine isn't included.
    expect(rep.durationMs).toBeGreaterThan(1300);
    expect(rep.durationMs).toBeLessThan(2000);
    expect(rep.minKneeAngle).toBeCloseTo(80, 0);
    expect(rep.minHipAngle).not.toBeNull();
    expect(rep.descentMs + rep.bottomMs + rep.ascentMs).toBeCloseTo(rep.durationMs);
    expect(rep.descentMs).toBeGreaterThan(0);
    expect(rep.ascentMs).toBeGreaterThan(0);
  });

  it("rejects a shallow squat and does not count it", () => {
    const { reps, rejected } = run(
      sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 120), (t) => hold(t, 300, 175)),
    );
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["SHALLOW_DEPTH"]);
  });

  it("ignores small dips as noise", () => {
    const { events } = run(sequence((t) => hold(t, 500, 175), (t) => squat(t, 1500, 145), (t) => hold(t, 300, 175)));
    expect(events).toEqual([]);
  });

  it("does not count a rep until the user has stood up (starting mid-squat)", () => {
    const { reps, counter } = run(
      sequence(
        (t) => hold(t, 500, 90), // already at the bottom when tracking starts
        (t) => hold(t, 500, 175), // stands up: this must NOT count
        (t) => squat(t, 2000, 80), // real rep
        (t) => hold(t, 300, 175),
      ),
    );
    expect(reps.length).toBe(1);
    expect(counter.repCount).toBe(1);
  });

  it("doesn't double count when the angle jitters around thresholds", () => {
    const { reps } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => squat(t, 2400, 80, 175, 6), // ±6° noise
        (t) => hold(t, 400, 175),
        (t) => squat(t, 2400, 80, 175, 6),
        (t) => hold(t, 400, 175),
      ),
    );
    expect(reps.length).toBe(2);
  });

  it("counts a bounce at the bottom as one rep", () => {
    // Down to 80, up to 115, back to 85, then stand: one rep.
    const samples: Sample[] = [
      ...hold(0, 500, 175),
      ...[160, 140, 120, 100, 85, 80, 95, 115, 100, 85, 100, 130, 150, 165, 175].map((knee, i) => ({
        t: 500 + i * 120,
        knee,
      })),
      ...hold(500 + 15 * 120, 300, 175),
    ];
    const { reps } = run(samples);
    expect(reps.length).toBe(1);
    expect(reps[0]!.minKneeAngle).toBe(80);
  });

  it("rejects reps that are too fast", () => {
    const { reps, rejected } = run(sequence((t) => hold(t, 500, 175), (t) => squat(t, 300, 80), (t) => hold(t, 300, 175)));
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["TOO_FAST"]);
  });

  it("rejects reps that are too slow", () => {
    const { reps, rejected } = run(
      sequence((t) => hold(t, 500, 175), (t) => squat(t, 1000, 80).slice(0, 16), (t) => hold(t, 13_000, 85), (t) => hold(t, 300, 175)),
    );
    expect(reps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["TOO_SLOW"]);
  });

  it("pauses through a short tracking dropout and still counts the rep", () => {
    const rep = squat(0, 2000, 80);
    const withGap = rep.map((s, i) => (i > 25 && i < 33 ? { ...s, knee: null } : s)); // ~250 ms gap
    const { reps } = run(sequence((t) => hold(t, 500, 175), (t) => withGap.map((s) => ({ ...s, t: s.t + t })), (t) => hold(t, 300, 175)));
    expect(reps.length).toBe(1);
  });

  it("aborts a rep when tracking is lost for too long, and needs a fresh stand", () => {
    const { reps, rejected, counter } = run(
      sequence(
        (t) => hold(t, 500, 175),
        (t) => squat(t, 2000, 80).slice(0, 25), // down to the bottom
        (t) => hold(t, 1000, null), // lost for 1 s
        (t) => hold(t, 300, 90), // reappears still low
        (t) => hold(t, 300, 175), // stands up: must not count
      ),
    );
    expect(rejected.map((r) => r.reason)).toEqual(["TRACKING_LOST"]);
    expect(reps).toEqual([]);
    expect(counter.repCount).toBe(0);
    expect(counter.armed).toBe(true);
  });

  it("cancelCurrentRep drops the rep in progress but keeps the count", () => {
    const counter = new SquatRepCounter();
    run(sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 80), (t) => hold(t, 300, 175)), counter);
    run(squat(10_000, 2000, 80).slice(0, 30), counter);
    expect(counter.phase).not.toBe("standing");
    counter.cancelCurrentRep();
    expect(counter.repCount).toBe(1);
    expect(counter.phase).toBe("standing");
    expect(counter.armed).toBe(false);
  });

  it("a stricter depth line rejects a squat the default would count", () => {
    const seq = () => sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 95), (t) => hold(t, 300, 175));
    expect(run(seq()).reps.length).toBe(1);
    const strict = new SquatRepCounter();
    strict.configure({ depthAngle: 90 });
    const { reps, rejected } = run(seq(), strict);
    expect(reps).toEqual([]);
    expect(rejected.map((r) => [r.reason, Math.round(r.minKneeAngle ?? 0)])).toEqual([["SHALLOW_DEPTH", 95]]);
  });

  it("configure keeps the count and rejects invalid thresholds", () => {
    const counter = new SquatRepCounter();
    run(sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 80), (t) => hold(t, 300, 175)), counter);
    counter.configure({ depthAngle: 85 });
    expect(counter.repCount).toBe(1);
    expect(counter.config.depthAngle).toBe(85);
    expect(() => counter.configure({ depthAngle: 145 })).toThrow(RangeError);
    expect(counter.config.depthAngle).toBe(85);
  });

  describe("hip drop", () => {
    /** Attach a hip-drop value to each sample: `drop(kneeAngle)`. */
    const withDrop = (samples: Sample[], drop: (knee: number) => number) =>
      samples.map((s) => ({ ...s, drop: s.knee === null ? null : drop(s.knee) }));
    const runDrop = (samples: Array<Sample & { drop: number | null }>, counter = new SquatRepCounter()) => {
      const events = samples.map((s) => counter.update(s.t, s.knee, null, s.drop)).filter((e) => e !== null);
      return {
        reps: events.flatMap((e) => (e.type === "rep" ? [e.rep] : [])),
        rejected: events.flatMap((e) => (e.type === "rejected" ? [e.rejected] : [])),
      };
    };
    const oneSquat = () =>
      sequence((t) => hold(t, 500, 175), (t) => squat(t, 2000, 80), (t) => hold(t, 300, 175));

    it("counts a real squat where the hips drop with the knee", () => {
      // Hips drop in proportion to knee bend: ~0.5 of leg length at 80°.
      const { reps } = runDrop(withDrop(oneSquat(), (k) => ((175 - k) / 95) * 0.5));
      expect(reps.length).toBe(1);
      expect(reps[0]!.maxHipDrop).toBeCloseTo(0.5, 1);
    });

    it("does not count a bent knee when the hips stay up (raised leg on one foot)", () => {
      const { reps, rejected } = runDrop(withDrop(oneSquat(), () => 0.05));
      expect(reps).toEqual([]);
      expect(rejected.map((r) => r.reason)).toEqual(["NO_HIP_DROP"]);
    });

    it("does not count a small dip even if the knee angle reads deep", () => {
      const { reps } = runDrop(withDrop(oneSquat(), (k) => ((175 - k) / 95) * 0.2));
      expect(reps).toEqual([]);
    });

    it("falls back to the knee angle when hip drop isn't measured", () => {
      const { reps } = runDrop(withDrop(oneSquat(), () => NaN).map((s) => ({ ...s, drop: null })));
      expect(reps.length).toBe(1);
    });

    it("can be disabled", () => {
      const { reps } = runDrop(withDrop(oneSquat(), () => 0), new SquatRepCounter({ minHipDrop: 0 }));
      expect(reps.length).toBe(1);
    });
  });

  it("validates its config", () => {
    expect(() => new SquatRepCounter({ standingAngle: 140, descentStartAngle: 150 })).toThrow(RangeError);
    expect(() => new SquatRepCounter({ depthAngle: 145 })).toThrow(RangeError);
  });
});

describe("HipDropMeter", () => {
  it("returns null until a standing baseline exists", () => {
    const m = new HipDropMeter();
    expect(m.update(0.5, 0.4, false)).toBeNull();
  });

  it("measures drop as a fraction of standing leg length", () => {
    const m = new HipDropMeter(1);
    expect(m.update(0.45, 0.4, true)).toBeCloseTo(0);
    expect(m.update(0.65, 0.3, false)).toBeCloseTo(0.5); // 0.2 down / 0.4 leg
    expect(m.update(0.4, 0.4, false)).toBeCloseTo(-0.125); // above standing height
  });

  it("only learns the baseline while standing", () => {
    const m = new HipDropMeter(1);
    m.update(0.45, 0.4, true);
    m.update(0.65, 0.3, false); // squatting: baseline must not move
    expect(m.update(0.65, 0.3, false)).toBeCloseTo(0.5);
  });

  it("returns null without a hip position, and resets", () => {
    const m = new HipDropMeter(1);
    m.update(0.45, 0.4, true);
    expect(m.update(null, 0.4, false)).toBeNull();
    m.reset();
    expect(m.update(0.6, 0.4, false)).toBeNull();
  });
});
