import { describe, expect, it } from "vitest";
import { jointAngle, movementAngle } from "./angles";
import type { Landmark } from "./tracking";

const P = (x: number, y: number, visibility = 0.9): Landmark => ({ x, y, z: 0, visibility });

describe("jointAngle", () => {
  it.each([
    [P(1, 0), P(0, 0), P(0, 1), 90],
    [P(1, 0), P(0, 0), P(-1, 0), 180],
    [P(1, 0), P(0, 0), P(2, 0), 0],
  ])("computes %#", (a, j, c, expected) => {
    expect(jointAngle(a, j, c)).toBeCloseTo(expected);
  });

  it("returns null on overlap or non-finite", () => {
    expect(jointAngle(P(0, 0), P(0, 0), P(1, 1))).toBeNull();
    expect(jointAngle(P(NaN, 0), P(0, 0), P(1, 1))).toBeNull();
  });
});

describe("movementAngle", () => {
  const body = () => Array.from({ length: 33 }, () => P(0.5, 0.5, 0.9));

  it("uses the more visible arm's elbow for curls", () => {
    const pose = body();
    // right arm bent at 90 deg, left arm hidden
    pose[12] = P(0.5, 0.2); pose[14] = P(0.5, 0.5); pose[16] = P(0.8, 0.5);
    [11, 13, 15].forEach((i) => (pose[i] = P(0, 0, 0.1)));
    const m = movementAngle(pose, "curl");
    expect(m?.angle).toBeCloseTo(90);
    expect(m?.confidence).toBeCloseTo(0.9);
  });

  it("uses hip-knee-ankle for squats", () => {
    const pose = body();
    pose[23] = P(0.4, 0.4); pose[25] = P(0.4, 0.6); pose[27] = P(0.4, 0.8);
    [24, 26, 28].forEach((i) => (pose[i] = P(0, 0, 0.1)));
    expect(movementAngle(pose, "squat")?.angle).toBeCloseTo(180);
  });

  it("returns null without a pose", () => {
    expect(movementAngle(null, "curl")).toBeNull();
    expect(movementAngle([], "curl")).toBeNull();
  });
});
