import { describe, expect, it } from "vitest";
import { facingSign, kneeAnkleRatio, torsoLean } from "./body_metrics";
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
