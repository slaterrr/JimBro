import { describe, expect, it } from "vitest";
import { bicepCurl, pushup, shoulderPress, squat } from "./exercises";
import {
  analyzeRep,
  assessCameraView,
  cameraViewFlag,
  describeRejection,
  median,
  spokenFor,
  stdDev,
  summarizeSession,
  toRepEvent,
} from "./form_analyzer";
import { POSE_LANDMARKS as L, type LandmarkLike } from "./pose_detection";
import type { CompletedRep, RejectionReason } from "./rep_counter";

function rep(n: number, durationMs: number, peakAngle: number, toPeakMs = 900, returnMs = 900): CompletedRep {
  return {
    repNumber: n,
    startedAt: n * 10_000,
    endedAt: n * 10_000 + durationMs,
    durationMs,
    peakAngle,
    maxProgress: 0.5,
    toPeakMs,
    peakHoldMs: durationMs - toPeakMs - returnMs,
    returnMs,
  };
}

describe("analyzeRep", () => {
  it("raises no flags for a steady rep", () => {
    const prev = [rep(1, 2000, 85), rep(2, 2100, 82), rep(3, 1950, 84)];
    expect(analyzeRep(squat, rep(4, 2050, 83), prev)).toEqual([]);
  });

  it("flags fast lowering on the right phase for each exercise", () => {
    // Squat lowers on the way to the peak...
    expect(analyzeRep(squat, rep(1, 1500, 80, 250, 900), []).map((f) => f.code)).toEqual(["FAST_LOWERING"]);
    expect(analyzeRep(squat, rep(1, 1500, 80, 900, 250), [])).toEqual([]);
    // ...a curl lowers on the way back.
    expect(analyzeRep(bicepCurl, rep(1, 1500, 50, 900, 250), []).map((f) => f.code)).toEqual(["FAST_LOWERING"]);
    expect(analyzeRep(bicepCurl, rep(1, 1500, 50, 250, 900), [])).toEqual([]);
  });

  it("flags uneven tempo and range only after enough reps, as estimated", () => {
    expect(analyzeRep(squat, rep(3, 3500, 110), [rep(1, 2000, 85), rep(2, 2000, 85)])).toEqual([]);
    const flags = analyzeRep(squat, rep(4, 3500, 110), [rep(1, 2000, 85), rep(2, 2000, 85), rep(3, 2000, 84)]);
    expect(flags.map((f) => [f.code, f.source])).toEqual([
      ["UNEVEN_TEMPO", "estimated"],
      ["RANGE_VARIES", "estimated"],
    ]);
    expect(flags[1]!.message).toMatch(/less range/);
  });

  it("knows 'less range' means a lower angle for presses", () => {
    const prev = [rep(1, 2000, 170), rep(2, 2000, 170), rep(3, 2000, 168)];
    const flags = analyzeRep(shoulderPress, rep(4, 2000, 150), prev);
    expect(flags.find((f) => f.code === "RANGE_VARIES")!.message).toMatch(/less range/);
  });

  it("includes exercise-specific form checks", () => {
    const flags = analyzeRep(bicepCurl, rep(1, 2000, 50), [], { elbowDrift: { min: 5, max: 60 } });
    expect(flags.map((f) => f.code)).toContain("ELBOW_DRIFT");
  });
});

describe("toRepEvent / describeRejection / spokenFor", () => {
  it("labels the peak angle as measured and tags the exercise", () => {
    const e = toRepEvent(pushup, rep(1, 2000, 84.27), []);
    expect(e).toMatchObject({ exercise: "pushup", primaryJoint: "elbow", fullRange: true });
    expect(e.peakAngle).toEqual({ value: 84.3, unit: "deg", source: "measured" });
  });

  it("uses exercise-specific wording where defined, generic otherwise", () => {
    const r = (reason: RejectionReason) => ({ reason, at: 0, peakAngle: null, maxProgress: null });
    expect(describeRejection(squat, r("PARTIAL_RANGE")).code).toBe("SHALLOW_DEPTH");
    expect(describeRejection(squat, r("PROGRESS_NOT_MET")).code).toBe("NO_HIP_DROP");
    expect(describeRejection(bicepCurl, r("PARTIAL_RANGE")).code).toBe("INCOMPLETE_CURL");
    expect(describeRejection(shoulderPress, r("PROGRESS_NOT_MET")).code).toBe("NOT_OVERHEAD");
    for (const reason of ["TOO_FAST", "TOO_SLOW", "TRACKING_LOST"] as const) {
      const flag = describeRejection(pushup, r(reason));
      expect(flag.source).toBe("measured");
      expect(spokenFor(pushup, flag.code)).toBeTruthy();
    }
  });

  it("finds spoken text for rejections and form flags", () => {
    expect(spokenFor(squat, "NO_HIP_DROP")).toMatch(/hips/);
    expect(spokenFor(pushup, "HIPS_SAGGING")).toMatch(/hips/);
    expect(spokenFor(squat, "UNEVEN_TEMPO")).toBeNull();
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
    expect(s.tempoConsistency).toMatchObject({ unit: "%", source: "estimated", confidence: 0.9 });
    expect(s.rangeConsistency).toMatchObject({ unit: "deg", source: "estimated" });
  });

  it("gives low confidence with few reps or poor tracking", () => {
    expect(summarizeSession([rep(1, 2000, 80)], 1)!.tempoConsistency.confidence).toBe(0);
    const five = [1, 2, 3, 4, 5].map((n) => rep(n, 2000, 80));
    expect(summarizeSession(five, 0.3)!.tempoConsistency.confidence).toBeCloseTo(0.3);
  });
});

describe("assessCameraView", () => {
  function upright(shoulderSpread: number): LandmarkLike[] {
    const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    lm[L.LEFT_SHOULDER] = { x: 0.5 - shoulderSpread / 2, y: 0.3, visibility: 0.9 };
    lm[L.RIGHT_SHOULDER] = { x: 0.5 + shoulderSpread / 2, y: 0.3, visibility: 0.9 };
    lm[L.LEFT_HIP] = { x: 0.48, y: 0.6, visibility: 0.9 };
    lm[L.RIGHT_HIP] = { x: 0.52, y: 0.6, visibility: 0.9 };
    return lm;
  }

  it("detects side and front views", () => {
    expect(assessCameraView(upright(0.03)).view).toBe("side");
    expect(assessCameraView(upright(0.25)).view).toBe("front");
  });

  it("warns only when the view doesn't suit the exercise", () => {
    const front = assessCameraView(upright(0.25));
    const side = assessCameraView(upright(0.03));
    expect(cameraViewFlag(front, "side")).toMatchObject({ code: "CAMERA_NOT_SIDE_ON", source: "estimated" });
    expect(cameraViewFlag(front, "front")).toBeNull();
    expect(cameraViewFlag(side, "front")).toMatchObject({ code: "CAMERA_NOT_FRONT_ON" });
    expect(cameraViewFlag(side, "side")).toBeNull();
  });

  it("returns unknown when lying horizontal (push-ups) or not visible", () => {
    const lying = upright(0.03).map((p, i) =>
      i === L.LEFT_HIP || i === L.RIGHT_HIP ? { ...p, x: 0.9, y: 0.32 } : p,
    );
    expect(assessCameraView(lying).view).toBe("unknown");
    expect(assessCameraView(upright(0.03).map((p) => ({ ...p, visibility: 0.1 }))).view).toBe("unknown");
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
