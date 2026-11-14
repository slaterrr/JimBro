import { describe, expect, it } from "vitest";
import {
  analyzeRep,
  assessCameraView,
  cameraViewFlag,
  describeRejection,
  median,
  stdDev,
  summarizeSession,
  toRepEvent,
} from "./form_analyzer";
import type { CompletedRep } from "./rep_counter";
import { POSE_LANDMARKS as L, type LandmarkLike } from "./pose_detection";

function rep(n: number, durationMs: number, minKneeAngle: number, descentMs = 900): CompletedRep {
  return {
    repNumber: n,
    startedAt: n * 10_000,
    endedAt: n * 10_000 + durationMs,
    durationMs,
    minKneeAngle,
    minHipAngle: 80,
    maxHipDrop: 0.5,
    descentMs,
    bottomMs: 200,
    ascentMs: durationMs - descentMs - 200,
  };
}

describe("analyzeRep", () => {
  it("raises no flags for a steady rep", () => {
    const prev = [rep(1, 2000, 85), rep(2, 2100, 82), rep(3, 1950, 84)];
    expect(analyzeRep(rep(4, 2050, 83), prev)).toEqual([]);
  });

  it("flags a fast descent as measured", () => {
    const flags = analyzeRep(rep(1, 1500, 85, 250), []);
    expect(flags).toEqual([expect.objectContaining({ code: "FAST_DESCENT", source: "measured" })]);
  });

  it("flags uneven tempo and depth only after enough reps, as estimated", () => {
    const outlier = rep(3, 3500, 110);
    expect(analyzeRep(outlier, [rep(1, 2000, 85), rep(2, 2000, 85)])).toEqual([]);
    const flags = analyzeRep(rep(4, 3500, 110), [rep(1, 2000, 85), rep(2, 2000, 85), rep(3, 2000, 84)]);
    expect(flags.map((f) => [f.code, f.source])).toEqual([
      ["UNEVEN_TEMPO", "estimated"],
      ["DEPTH_VARIES", "estimated"],
    ]);
  });
});

describe("toRepEvent / describeRejection", () => {
  it("labels the knee angle as measured", () => {
    const e = toRepEvent(rep(1, 2000, 84.27), []);
    expect(e.minKneeAngle).toEqual({ value: 84.3, unit: "deg", source: "measured" });
    expect(e.depthReached).toBe(true);
  });

  it("explains every rejection reason", () => {
    for (const reason of ["SHALLOW_DEPTH", "TOO_FAST", "TOO_SLOW", "TRACKING_LOST"] as const) {
      const flag = describeRejection({ reason, at: 0, minKneeAngle: null });
      expect(flag.message.length).toBeGreaterThan(0);
      expect(flag.source).toBe("measured");
    }
  });
});

describe("summarizeSession", () => {
  it("returns null with no reps", () => {
    expect(summarizeSession([], 1)).toBeNull();
  });

  it("marks average duration as measured and consistency as estimated", () => {
    const s = summarizeSession([rep(1, 2000, 80), rep(2, 2200, 90), rep(3, 1800, 85), rep(4, 2000, 85), rep(5, 2000, 85)], 0.9)!;
    expect(s.totalReps).toBe(5);
    expect(s.avgRepDurationMs).toEqual({ value: 2000, unit: "ms", source: "measured" });
    expect(s.tempoConsistency.source).toBe("estimated");
    expect(s.tempoConsistency.unit).toBe("%");
    expect(s.tempoConsistency.confidence).toBeCloseTo(0.9);
    expect(s.depthConsistency).toMatchObject({ unit: "deg", source: "estimated" });
  });

  it("gives low confidence with few reps or poor tracking", () => {
    expect(summarizeSession([rep(1, 2000, 80)], 1)!.tempoConsistency.confidence).toBe(0);
    expect(summarizeSession([rep(1, 2000, 80), rep(2, 2000, 80), rep(3, 2000, 80), rep(4, 2000, 80), rep(5, 2000, 80)], 0.3)!
      .tempoConsistency.confidence).toBeCloseTo(0.3);
  });
});

describe("assessCameraView", () => {
  function body(shoulderSpread: number): LandmarkLike[] {
    const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[L.LEFT_SHOULDER] = { x: 0.5 - shoulderSpread / 2, y: 0.3, visibility: 0.9 };
    lm[L.RIGHT_SHOULDER] = { x: 0.5 + shoulderSpread / 2, y: 0.3, visibility: 0.9 };
    lm[L.LEFT_HIP] = { x: 0.48, y: 0.6, visibility: 0.9 };
    lm[L.RIGHT_HIP] = { x: 0.52, y: 0.6, visibility: 0.9 };
    return lm;
  }

  it("detects a side-on view", () => {
    expect(assessCameraView(body(0.03)).view).toBe("side");
  });

  it("detects a front view and warns", () => {
    const a = assessCameraView(body(0.25));
    expect(a.view).toBe("front");
    expect(cameraViewFlag(a)).toMatchObject({ code: "CAMERA_NOT_SIDE_ON", source: "estimated" });
  });

  it("returns unknown when the torso isn't visible", () => {
    const lm = body(0.03).map((p) => ({ ...p, visibility: 0.1 }));
    expect(assessCameraView(lm).view).toBe("unknown");
  });
});

describe("stats helpers", () => {
  it("computes median and std dev", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(stdDev([5])).toBe(0);
  });
});
