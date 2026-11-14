import { describe, expect, it } from "vitest";
import { AngleSmoother, calculateAngle, calculateAngle3D } from "./angle_calculator";

describe("calculateAngle", () => {
  it("returns 90° for a right angle", () => {
    expect(calculateAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });

  it("returns 180° for a straight line and 0° for a fold", () => {
    expect(calculateAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
    expect(calculateAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
  });

  it("is symmetric in a and c", () => {
    const a = { x: 0.2, y: 0.9 };
    const b = { x: 0.5, y: 0.5 };
    const c = { x: 0.9, y: 0.6 };
    expect(calculateAngle(a, b, c)).toBeCloseTo(calculateAngle(c, b, a)!);
  });

  it("corrects for non-square normalised coordinates", () => {
    // In a 16:9 frame, a normalised (0.5625, 0) step is as long in pixels as (0, 1).
    const angle = calculateAngle({ x: 0.5625, y: 0 }, { x: 0, y: 0 }, { x: 0.5625, y: 1 }, 16 / 9);
    expect(angle).toBeCloseTo(45);
  });

  it("returns null for a zero-length segment", () => {
    expect(calculateAngle({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it("supports 3D", () => {
    expect(calculateAngle3D({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(90);
  });
});

describe("AngleSmoother", () => {
  it("passes the first value through and then blends", () => {
    const s = new AngleSmoother(0.5);
    expect(s.next(100)).toBe(100);
    expect(s.next(120)).toBe(110);
  });

  it("resets on null so stale values are not blended in", () => {
    const s = new AngleSmoother(0.5);
    s.next(100);
    expect(s.next(null)).toBeNull();
    expect(s.next(160)).toBe(160);
  });

  it("rejects an invalid alpha", () => {
    expect(() => new AngleSmoother(0)).toThrow(RangeError);
  });
});
