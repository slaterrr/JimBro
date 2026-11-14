import { describe, expect, it } from "vitest";
import { FeedbackFeed, SessionClock, formatDuration, formatSignal } from "./live_feedback";

const flag = (code: string) => ({ code, message: `msg ${code}`, source: "measured" as const });

describe("FeedbackFeed", () => {
  it("merges the same observation within the window instead of repeating it", () => {
    const f = new FeedbackFeed(10_000);
    f.addRep(1, [flag("FAST_LOWERING")], 0);
    f.addRep(2, [flag("FAST_LOWERING")], 3000);
    expect(f.list()).toHaveLength(1);
    expect(f.list()[0]).toMatchObject({ code: "FAST_LOWERING", count: 2, rep: 2 });
    f.addRep(3, [flag("FAST_LOWERING")], 20_000);
    expect(f.list()).toHaveLength(2);
  });

  it("marks 'not counted' notes resolved once a later rep counts", () => {
    const f = new FeedbackFeed();
    f.addRejection(flag("SHALLOW_DEPTH"), 0);
    expect(f.list()[0]!.resolved).toBe(false);
    f.addRep(1, [], 2000);
    expect(f.list()[0]!.resolved).toBe(true);
    // A new rejection of the same kind is live again.
    f.addRejection(flag("SHALLOW_DEPTH"), 3000);
    expect(f.list()[0]).toMatchObject({ resolved: false, count: 2 });
  });

  it("keeps hints in one slot and caps the list", () => {
    const f = new FeedbackFeed(10_000, 3);
    f.setHint("Step back");
    f.setHint("Turn side on");
    expect(f.hint).toBe("Turn side on");
    f.setHint(null);
    expect(f.hint).toBeNull();
    ["A", "B", "C", "D"].forEach((c, i) => f.addRep(i + 1, [flag(c)], i * 100));
    expect(f.list().map((i) => i.code)).toEqual(["D", "C", "B"]);
  });
});

describe("SessionClock", () => {
  it("counts active time only, and freezes on stop", () => {
    const c = new SessionClock();
    c.start(1000);
    expect(c.elapsed(4000)).toBe(3000);
    c.pause(4000);
    expect(c.elapsed(9000)).toBe(3000);
    c.resume(9000);
    expect(c.elapsed(10_000)).toBe(4000);
    c.stop(12_000);
    expect(c.elapsed(60_000)).toBe(6000);
    expect(formatDuration(6000)).toBe("0:06");
    expect(formatDuration(125_000)).toBe("2:05");
  });

  it("handles stop while paused", () => {
    const c = new SessionClock();
    c.start(0);
    c.pause(5000);
    c.stop(8000);
    expect(c.elapsed(20_000)).toBe(5000);
  });
});

describe("formatSignal", () => {
  it("formats known signals and hides unknown ones", () => {
    expect(formatSignal("frontKnee", 92.4)).toBe("92°");
    expect(formatSignal("handsUp", 0.874)).toBe("87%");
    expect(formatSignal("kneeRatio", 0.912)).toBe("0.91");
    expect(formatSignal("hipOffset", 3)).toBeNull();
    expect(formatSignal("torsoLean", null)).toBeNull();
  });
});
