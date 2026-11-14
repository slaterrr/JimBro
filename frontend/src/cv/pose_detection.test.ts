import { describe, expect, it } from "vitest";
import { CameraError, POSE_LANDMARKS as L, extractSquatJoints, mapCameraError, type LandmarkLike } from "./pose_detection";

/** Side-on standing pose with the left leg facing the camera. */
function pose(opts: { leftVis?: number; rightVis?: number; kneeBend?: boolean } = {}): LandmarkLike[] {
  const lv = opts.leftVis ?? 0.95;
  const rv = opts.rightVis ?? 0.4;
  const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const knee = opts.kneeBend ? { x: 0.65, y: 0.6 } : { x: 0.5, y: 0.65 };
  lm[L.LEFT_SHOULDER] = { x: 0.5, y: 0.2, visibility: lv };
  lm[L.LEFT_HIP] = { x: 0.5, y: 0.45, visibility: lv };
  lm[L.LEFT_KNEE] = { ...knee, visibility: lv };
  lm[L.LEFT_ANKLE] = { x: 0.5, y: 0.85, visibility: lv };
  lm[L.RIGHT_SHOULDER] = { x: 0.52, y: 0.2, visibility: rv };
  lm[L.RIGHT_HIP] = { x: 0.52, y: 0.45, visibility: rv };
  lm[L.RIGHT_KNEE] = { x: 0.52, y: 0.65, visibility: rv };
  lm[L.RIGHT_ANKLE] = { x: 0.52, y: 0.85, visibility: rv };
  return lm;
}

describe("extractSquatJoints", () => {
  it("uses the more visible leg", () => {
    const j = extractSquatJoints(pose());
    expect(j.side).toBe("left");
    expect(j.kneeAngle).toBeCloseTo(180, 0);
    expect(j.hipAngle).toBeCloseTo(180, 0);
    expect(j.visible).toBe(true);
  });

  it("reports a bent knee", () => {
    const j = extractSquatJoints(pose({ kneeBend: true }));
    expect(j.kneeAngle!).toBeLessThan(120);
  });

  it("returns nulls when neither leg passes the confidence threshold", () => {
    const j = extractSquatJoints(pose({ leftVis: 0.4, rightVis: 0.3 }));
    expect(j).toEqual({ side: null, kneeAngle: null, hipAngle: null, visible: false });
  });

  it("returns nulls with no landmarks", () => {
    expect(extractSquatJoints(undefined).visible).toBe(false);
    expect(extractSquatJoints([]).visible).toBe(false);
  });

  it("sticks with the preferred side unless the other is clearly better", () => {
    expect(extractSquatJoints(pose({ leftVis: 0.8, rightVis: 0.88 }), { preferredSide: "left" }).side).toBe("left");
    expect(extractSquatJoints(pose({ leftVis: 0.65, rightVis: 0.95 }), { preferredSide: "left" }).side).toBe("right");
  });

  it("drops the hip angle when the shoulder isn't visible", () => {
    const lm = pose();
    lm[L.LEFT_SHOULDER] = { ...lm[L.LEFT_SHOULDER]!, visibility: 0.2 };
    const j = extractSquatJoints(lm);
    expect(j.kneeAngle).not.toBeNull();
    expect(j.hipAngle).toBeNull();
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
