import { describe, expect, it } from "vitest";
import { calculateAngle } from "./angle_calculator";
import { facingSign, kneeAnkleRatio, sagittalAngle, torsoLean } from "./body_metrics";
import { POSE_LANDMARKS as L, type LandmarkLike } from "./pose_detection";

const blank = (): LandmarkLike[] => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));

describe("body metrics", () => {
  it("reads facing direction from heel to toe", () => {
    const lm = blank();
    lm[L.LEFT_HEEL] = { x: 0.4, y: 0.9, visibility: 0.9 };
    lm[L.LEFT_FOOT_INDEX] = { x: 0.47, y: 0.9, visibility: 0.9 };
    expect(facingSign(lm, "left", 0.6)).toBe(1);
    lm[L.LEFT_FOOT_INDEX] = { x: 0.33, y: 0.9, visibility: 0.9 };
    expect(facingSign(lm, "left", 0.6)).toBe(-1);
    lm[L.LEFT_FOOT_INDEX] = { x: 0.33, y: 0.9, visibility: 0.2 };
    expect(facingSign(lm, "left", 0.6)).toBeNull();
  });

  it("measures torso lean, signed by facing", () => {
    const hip = { x: 0.5, y: 0.6 };
    expect(torsoLean({ x: 0.5, y: 0.3 }, hip, 1)).toBeCloseTo(0);
    expect(torsoLean({ x: 0.8, y: 0.3 }, hip, 1, 1)).toBeCloseTo(45);
    expect(torsoLean({ x: 0.8, y: 0.3 }, hip, 1, -1)).toBeCloseTo(-45);
  });

  it("computes the knee-to-ankle ratio, null with feet together or hidden", () => {
    const lm = blank();
    lm[L.LEFT_ANKLE] = { x: 0.4, y: 0.9, visibility: 0.9 };
    lm[L.RIGHT_ANKLE] = { x: 0.6, y: 0.9, visibility: 0.9 };
    lm[L.LEFT_KNEE] = { x: 0.45, y: 0.7, visibility: 0.9 };
    lm[L.RIGHT_KNEE] = { x: 0.55, y: 0.7, visibility: 0.9 };
    expect(kneeAnkleRatio(lm, 0.6)).toBeCloseTo(0.5);
    lm[L.RIGHT_ANKLE] = { x: 0.41, y: 0.9, visibility: 0.9 };
    expect(kneeAnkleRatio(lm, 0.6)).toBeNull();
  });
});

describe("sagittalAngle (perspective)", () => {
  // A squatting leg (knee ≈ 114°) in the body's sagittal plane (y up, z forward).
  const hipL = { x: -0.1, y: 0, z: 0 };
  const hipR = { x: 0.1, y: 0, z: 0 };
  const hip = { x: 0.1, y: 0, z: 0 };
  const knee = { x: 0.1, y: -0.3, z: 0.3 };
  const ankle = { x: 0.1, y: -0.7, z: 0.15 };
  const rotY = (p: { x: number; y: number; z: number }, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) };
  };
  const truth = sagittalAngle(hip, knee, ankle, hipL, hipR)!;

  it("doesn't change with camera yaw, while the 2D image angle does", () => {
    for (const yaw of [0, 20, 40, 60]) {
      const [h, k, a, l, r] = [hip, knee, ankle, hipL, hipR].map((p) => rotY(p, yaw)) as [typeof hip, typeof hip, typeof hip, typeof hip, typeof hip];
      expect(sagittalAngle(h, k, a, l, r)).toBeCloseTo(truth, 6);
      // Side-on camera looks along x: the image shows (z, y).
      const img = (p: typeof hip) => ({ x: p.z, y: -p.y });
      const twoD = calculateAngle(img(h), img(k), img(a))!;
      if (yaw === 0) expect(twoD).toBeCloseTo(truth, 1);
      // 40° off side-on already reads ~12° too open; 60° reads ~28° too open.
      if (yaw === 40) expect(twoD - truth).toBeGreaterThan(10);
      if (yaw === 60) expect(twoD - truth).toBeGreaterThan(25);
    }
  });

  it("returns null without a hip axis", () => {
    expect(sagittalAngle(hip, knee, ankle, hipL, hipL)).toBeNull();
  });
});
