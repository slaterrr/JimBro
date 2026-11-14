import { describe, expect, it } from "vitest";
import { CameraError, POSE_LANDMARKS as L, distance, mapCameraError, pickSide, type LandmarkLike } from "./pose_detection";

const LEG = { left: [L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE], right: [L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE] };

function legs(leftVis: number, rightVis: number): LandmarkLike[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: 0.5,
    y: 0.5,
    visibility: LEG.left.includes(i as never) ? leftVis : LEG.right.includes(i as never) ? rightVis : 0.9,
  }));
}

describe("pickSide", () => {
  it("picks the more visible side", () => {
    expect(pickSide(legs(0.95, 0.4), LEG, 0.6)).toBe("left");
    expect(pickSide(legs(0.4, 0.95), LEG, 0.6)).toBe("right");
  });

  it("returns null when neither side passes the threshold", () => {
    expect(pickSide(legs(0.4, 0.3), LEG, 0.6)).toBeNull();
  });

  it("sticks with the preferred side unless the other is clearly better", () => {
    expect(pickSide(legs(0.8, 0.88), LEG, 0.6, "left")).toBe("left");
    expect(pickSide(legs(0.65, 0.95), LEG, 0.6, "left")).toBe("right");
  });
});

describe("distance", () => {
  it("corrects x for the aspect ratio", () => {
    expect(distance({ x: 0, y: 0 }, { x: 0.5625, y: 0 }, 16 / 9)).toBeCloseTo(1);
  });
});

describe("mapCameraError", () => {
  const cases: Array<[string, string]> = [
    ["NotAllowedError", "PERMISSION_DENIED"],
    ["NotFoundError", "NO_CAMERA"],
    ["OverconstrainedError", "NO_CAMERA"],
    ["NotReadableError", "CAMERA_IN_USE"],
    ["SecurityError", "INSECURE_CONTEXT"],
    ["SomethingElse", "UNKNOWN"],
  ];
  it.each(cases)("maps %s to %s", (name, code) => {
    const e = mapCameraError(Object.assign(new Error("x"), { name }));
    expect(e).toBeInstanceOf(CameraError);
    expect(e.code).toBe(code);
    expect(e.message.length).toBeGreaterThan(0);
  });

  it("passes CameraError through", () => {
    const e = new CameraError("NO_CAMERA");
    expect(mapCameraError(e)).toBe(e);
  });
});
