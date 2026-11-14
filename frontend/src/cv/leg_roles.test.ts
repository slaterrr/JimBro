import { describe, expect, it } from "vitest";
import { lunge } from "./exercises/lunge";
import { LegRoleTracker } from "./leg_roles";
import { POSE_LANDMARKS as L } from "./pose_detection";
import { lungeRep, pose } from "./test_fixtures";
import { BaselineDropMeter, RepCounter } from "./rep_counter";

const opts = { minVisibility: 0.6, aspectRatio: 1 };

describe("LegRoleTracker", () => {
  it("finds the front leg from foot position and facing, not from labels or image side", () => {
    for (const facing of [1, -1] as const) {
      for (const frontLabel of ["left", "right"] as const) {
        const t = new LegRoleTracker();
        const r = t.update(pose({ facing, frontLabel, depth: 1.2, split: 1 }), opts);
        expect(r.status).toBe("split");
        if (r.status === "split") {
          expect(r.front.label).toBe(frontLabel);
          expect(r.facing).toBe(facing);
          expect(r.front.kneeAngle).toBeLessThan(r.back.kneeAngle);
        }
      }
    }
  });

  it("doesn't pick the most visible knee: the camera-side leg here is the back leg", () => {
    const t = new LegRoleTracker();
    const r = t.update(pose({ facing: 1, frontLabel: "right", nearLabel: "left", depth: 1.2, split: 1 }), opts);
    expect(r.status === "split" && r.front.label).toBe("right");
  });

  it("reports 'together' with no roles while the feet are together", () => {
    const r = new LegRoleTracker().update(pose({ facing: 1, frontLabel: "left", depth: 0, split: 0 }), opts);
    expect(r.status).toBe("together");
  });

  it("re-decides roles each rep of alternating lunges", () => {
    const t = new LegRoleTracker();
    const fronts: string[] = [];
    for (const frontLabel of ["left", "right", "left"] as const) {
      for (const p of lungeRep(1, frontLabel)) {
        const r = t.update(pose(p), opts);
        if (r.status === "split" && p.depth > 1) fronts.push(r.front.label);
      }
    }
    // Collapse runs: one role decision per rep.
    expect(fronts.filter((f, i) => f !== fronts[i - 1])).toEqual(["left", "right", "left"]);
  });

  it("keeps the same physical front leg when MediaPipe swaps whole-leg labels mid-rep", () => {
    const t = new LegRoleTracker();
    const angles: number[] = [];
    lungeRep(1, "left").forEach((p, i) => {
      // Frames 30–34: the model swaps which leg it calls left and right.
      const swapped = i >= 30 && i <= 34 ? { ...p, frontLabel: "right" as const, nearLabel: "right" as const } : p;
      const r = t.update(pose(swapped), opts);
      if (r.status === "split" && p.depth > 0.6) angles.push(r.front.kneeAngle);
    });
    // The front-knee angle stays smooth (no jump to the back knee's angle).
    const jumps = angles.slice(1).map((a, i) => Math.abs(a - angles[i]!));
    expect(Math.max(...jumps)).toBeLessThan(8);
  });

  it("re-pairs a knee whose label alone was swapped, using learned bone lengths", () => {
    const t = new LegRoleTracker();
    for (let i = 0; i < 10; i++) t.update(pose({ facing: 1, frontLabel: "left", depth: 0, split: 0 }), opts);
    const lm = pose({ facing: 1, frontLabel: "left", depth: 1.2, split: 1 });
    const clean = new LegRoleTracker();
    for (let i = 0; i < 10; i++) clean.update(pose({ facing: 1, frontLabel: "left", depth: 0, split: 0 }), opts);
    const expected = clean.update(lm, opts);
    // Swap only the knee landmarks.
    const swapped = lm.slice();
    [swapped[L.LEFT_KNEE], swapped[L.RIGHT_KNEE]] = [lm[L.RIGHT_KNEE]!, lm[L.LEFT_KNEE]!];
    const r = t.update(swapped, opts);
    expect(r.status).toBe("split");
    if (r.status === "split" && expected.status === "split") {
      expect(r.front.kneeAngle).toBeCloseTo(expected.front.kneeAngle, 0);
      expect(r.back.kneeAngle).toBeCloseTo(expected.back.kneeAngle, 0);
    }
  });

  it("is uncertain when a leg is hidden, instead of guessing", () => {
    const r = new LegRoleTracker().update(pose({ facing: 1, frontLabel: "left", depth: 1, split: 1, farVis: 0.2 }), opts);
    expect(r.status).toBe("uncertain");
  });

  it("is uncertain when it can't tell which way the user faces", () => {
    const lm = pose({ facing: 1, frontLabel: "left", depth: 1, split: 1 }).map((p, i) =>
      [L.NOSE, L.LEFT_HEEL, L.RIGHT_HEEL, L.LEFT_FOOT_INDEX, L.RIGHT_FOOT_INDEX].includes(i as never) ? { ...p, visibility: 0.05 } : p,
    );
    const r = new LegRoleTracker().update(lm, opts);
    expect(r.status === "uncertain" && r.reason).toMatch(/facing/);
  });
});

describe("lunge reader", () => {
  const ro = { aspectRatio: 1, minVisibility: 0.6, preferredSide: null };

  it("counts on the front knee and measures the back knee separately", () => {
    const r = lunge.read(pose({ facing: -1, frontLabel: "right", depth: 1.2, split: 1 }), ro);
    expect(r.side).toBe("right");
    expect(r.primaryAngle).toBe(r.form.frontKnee);
    expect(r.form.backKnee!).toBeGreaterThan(r.form.frontKnee!);
  });

  it("gives no angle and a hint when uncertain, and refuses front-on filming", () => {
    const hidden = lunge.read(pose({ facing: 1, frontLabel: "left", depth: 1, split: 1, farVis: 0.2 }), ro);
    expect(hidden.primaryAngle).toBeNull();
    expect(hidden.positionHint).toMatch(/Both legs/);
    expect(lunge.read(pose({ facing: 1, frontLabel: "left", depth: 0, split: 0 }), { ...ro, view: "front" }).positionHint).toMatch(
      /side on/,
    );
  });

  it("counts every rep of alternating lunges facing either way", () => {
    for (const facing of [1, -1] as const) {
      const read = lunge.createReader!();
      const counter = new RepCounter(lunge.counter);
      const drop = new BaselineDropMeter();
      let reps = 0;
      const frames = (["left", "right", "left", "right"] as const).flatMap((s) => lungeRep(facing, s));
      frames.forEach((p, i) => {
        const r = read(pose(p), ro);
        const prog =
          r.progress?.kind === "drop"
            ? drop.update(r.progress.y, r.progress.refLength, counter.phase === "start" && counter.atStart(r.primaryAngle))
            : null;
        if (counter.update(i * 33, r.primaryAngle, prog)?.type === "rep") reps += 1;
      });
      expect(reps).toBe(4);
    }
  });

  it("reports front and back knee depth per rep as measurements", () => {
    const m = lunge.repMetrics!({
      frontKnee: { min: 92.4, max: 170, coverage: 1 },
      backKnee: { min: 110.6, max: 170, coverage: 1 },
      "stepRatio@peak": { min: 1, max: 1.3, coverage: 1 },
    }, []);
    expect(m.frontKneeMin).toEqual({ value: 92, unit: "deg", source: "measured" });
    expect(m.backKneeMin?.value).toBe(111);
    expect(m.stepLength?.value).toBe(130);
  });
});
