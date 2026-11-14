import { describe, expect, it } from "vitest";
import type { RepEvent } from "../../../../shared/types";
import { POSE_LANDMARKS as L, type LandmarkLike, type WorldLandmarkLike } from "../pose_detection";
import { ARM_ACTIVE_DEG, armsUsed, bicepCurl, curlStyle } from "./bicep_curl";
import { deadlift, extensionTiming } from "./deadlift";
import { shoulderPress } from "./shoulder_press";
import type { FormSeries } from "./types";

const ro = { aspectRatio: 1, minVisibility: 0.6, preferredSide: null };

describe("deadlift", () => {
  /** A pull from set-up to lockout; `kneeLeadMs` shifts when the knees finish extending. */
  function pull(kneeLeadMs: number): FormSeries {
    const out: FormSeries[number][] = [];
    for (let t = 0; t <= 1500; t += 33) {
      const hip = 90 + 85 * Math.min(1, t / 1500);
      const knee = 120 + 55 * Math.min(1, t / (1500 - kneeLeadMs));
      out.push({ t, phase: t < 1400 ? "toward_peak" : "peak", form: { hipAngle: hip, kneeAngle: knee } });
    }
    return out;
  }

  it("times hip vs knee extension", () => {
    expect(Math.abs(extensionTiming(pull(0))!.kneeLeadMs)).toBeLessThan(70);
    expect(extensionTiming(pull(600))!.kneeLeadMs).toBeGreaterThan(450);
  });

  it("returns nothing to time when a joint barely moved or wasn't seen", () => {
    const still = pull(0).map((f) => ({ ...f, form: { ...f.form, kneeAngle: 170 } }));
    expect(extensionTiming(still)).toBeNull();
    const unseen = pull(0).map((f) => ({ ...f, form: { ...f.form, kneeAngle: null } }));
    expect(extensionTiming(unseen)).toBeNull();
  });

  it("reports hip/knee extension, torso change and timing as measurements, not flags", () => {
    const m = deadlift.repMetrics!(
      {
        hipAngle: { min: 88, max: 176, coverage: 1 },
        kneeAngle: { min: 118, max: 175, coverage: 1 },
        torsoLean: { min: -2, max: 52, coverage: 1 },
      },
      pull(400),
    );
    expect(m).toMatchObject({
      hipAngleSetup: { value: 88, source: "measured" },
      hipAngleLockout: { value: 176 },
      kneeAngleSetup: { value: 118 },
      torsoAngleChange: { value: 54, unit: "deg" },
    });
    expect(m.kneeLeadMs!.value).toBeGreaterThan(250);
    expect(deadlift.formChecks({} as never, {})).toEqual([]);
  });
});

describe("shoulder press metrics", () => {
  it("reports each arm's lockout, the difference, and overhead reach", () => {
    const m = shoulderPress.repMetrics!(
      {
        leftElbow: { min: 85, max: 172, coverage: 1 },
        rightElbow: { min: 88, max: 158, coverage: 1 },
        armDiff: { min: 0, max: 18, coverage: 1 },
        handsUp: { min: 0.4, max: 0.93, coverage: 1 },
      },
      [],
    );
    expect(m.lockoutLeft!.value).toBe(172);
    expect(m.lockoutRight!.value).toBe(158);
    expect(m.lockoutDiff!.value).toBe(14);
    expect(m.overheadReach).toEqual({ value: 93, unit: "% arm", source: "measured" });
  });
});

describe("bicep curl, front view", () => {
  // Image landmarks: both arms visible. World landmarks: left arm curled to 60°, right hanging straight.
  const image: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
  const world: WorldLandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[L.LEFT_SHOULDER] = { x: 0.2, y: -0.4, z: 0 };
  world[L.LEFT_HIP] = { x: 0.1, y: 0.1, z: 0 };
  world[L.LEFT_ELBOW] = { x: 0.2, y: -0.1, z: 0 };
  const a = (60 * Math.PI) / 180;
  world[L.LEFT_WRIST] = { x: 0.2, y: -0.1 - 0.25 * Math.cos(a), z: -0.25 * Math.sin(a) };
  world[L.RIGHT_SHOULDER] = { x: -0.2, y: -0.4, z: 0 };
  world[L.RIGHT_HIP] = { x: -0.1, y: 0.1, z: 0 };
  world[L.RIGHT_ELBOW] = { x: -0.2, y: -0.1, z: 0 };
  world[L.RIGHT_WRIST] = { x: -0.2, y: 0.15, z: 0 };

  it("tracks both arms in 3D and counts on the more-bent one", () => {
    const r = bicepCurl.read(image, { ...ro, view: "front", world });
    expect(r.view).toBe("front");
    expect(r.side).toBe("both");
    expect(r.form.leftElbow!).toBeCloseTo(60, 0);
    expect(r.form.rightElbow!).toBeCloseTo(180, 0);
    expect(r.primaryAngle!).toBeCloseTo(60, 0);
  });

  it("asks for the arms when neither is visible", () => {
    const hidden = image.map((p) => ({ ...p, visibility: 0.1 }));
    expect(bicepCurl.read(hidden, { ...ro, view: "front", world }).positionHint).toMatch(/arms in view/);
  });

  it("doesn't apply the side-view elbow-drift threshold to a front-view 3D estimate", () => {
    const stats = { elbowDrift: { min: 5, max: 60, coverage: 1 } };
    expect(bicepCurl.formChecks({} as never, stats, "side").map((f) => f.code)).toContain("ELBOW_DRIFT");
    expect(bicepCurl.formChecks({} as never, stats, "front")).toEqual([]);
  });
});

describe("curl style", () => {
  const rep = (l: number, r: number): RepEvent =>
    ({
      metrics: {
        leftArmRange: { value: l, unit: "deg", source: "measured" },
        rightArmRange: { value: r, unit: "deg", source: "measured" },
      },
    }) as unknown as RepEvent;
  const L_ = rep(ARM_ACTIVE_DEG + 40, 5);
  const R_ = rep(5, ARM_ACTIVE_DEG + 40);
  const B_ = rep(95, 92);

  it("tells which arm did each rep", () => {
    expect([armsUsed(L_), armsUsed(R_), armsUsed(B_), armsUsed(rep(40, 40))]).toEqual(["left", "right", "both", null]);
  });

  it("distinguishes alternating, simultaneous and single-arm sets", () => {
    expect(curlStyle([L_, R_, L_, R_, L_, R_])).toBe("alternating");
    expect(curlStyle([B_, B_, B_, B_])).toBe("simultaneous");
    expect(curlStyle([L_, L_, L_, L_])).toBe("single-arm");
    expect(curlStyle([L_, R_, L_])).toBeNull(); // too few
    expect(curlStyle([L_, L_, R_, R_, L_, L_])).toBeNull(); // no clear pattern
  });

  it("reports the style as a session insight", () => {
    const out = bicepCurl.sessionInsights!([L_, R_, L_, R_]);
    expect(out).toEqual([{ code: "CURL_STYLE_ALTERNATING", message: "Alternating curls: 2 left, 2 right.", source: "measured" }]);
  });
});
