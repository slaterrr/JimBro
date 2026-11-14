import { describe, expect, it } from "vitest";
import { POSE_LANDMARKS as L, type LandmarkLike } from "../pose_detection";
import { EXERCISES, EXERCISE_IDS, bicepCurl, deadlift, lunge, pushup, shoulderPress, squat } from "./index";

type P = [number, number, number?];

/** 33 landmarks, everything visible at the centre unless overridden. */
function body(points: Partial<Record<number, P>>, defaultVis = 0.9): LandmarkLike[] {
  return Array.from({ length: 33 }, (_, i) => {
    const p = points[i];
    return p ? { x: p[0], y: p[1], visibility: p[2] ?? 0.95 } : { x: 0.5, y: 0.5, visibility: defaultVis };
  });
}
const opts = { aspectRatio: 1, minVisibility: 0.6, preferredSide: null };

describe("exercise registry", () => {
  it("has every exercise, with matching ids", () => {
    expect(EXERCISE_IDS).toEqual(["squat", "deadlift", "lunge", "pushup", "bicep_curl", "shoulder_press"]);
    for (const id of EXERCISE_IDS) expect(EXERCISES[id].id).toBe(id);
  });

  it("gives every rejection and form flag a spoken version", () => {
    for (const ex of Object.values(EXERCISES)) {
      for (const r of Object.values(ex.rejections)) expect(r?.spoken.length).toBeGreaterThan(0);
      expect(ex.spoken.FAST_LOWERING).toBeTruthy();
    }
  });
});

describe("squat.read", () => {
  // Side-on, left leg facing the camera.
  const standing = body({
    [L.LEFT_SHOULDER]: [0.5, 0.2],
    [L.LEFT_HIP]: [0.5, 0.45],
    [L.LEFT_KNEE]: [0.5, 0.65],
    [L.LEFT_ANKLE]: [0.5, 0.85],
    [L.RIGHT_HIP]: [0.52, 0.45, 0.4],
    [L.RIGHT_KNEE]: [0.52, 0.65, 0.4],
    [L.RIGHT_ANKLE]: [0.52, 0.85, 0.4],
  });

  it("reads the knee angle and hip-drop inputs from the more visible leg", () => {
    const r = squat.read(standing, opts);
    expect(r.side).toBe("left");
    expect(r.primaryAngle).toBeCloseTo(180, 0);
    expect(r.progress).toMatchObject({ kind: "drop" });
    if (r.progress?.kind === "drop") {
      expect(r.progress.y).toBeCloseTo(0.45);
      expect(r.progress.refLength).toBeCloseTo(0.4);
    }
    expect(r.highlight).toContain(L.LEFT_KNEE);
  });

  it("returns nothing when neither leg is visible enough", () => {
    const hidden = standing.map((p) => ({ ...p, visibility: 0.3 }));
    expect(squat.read(hidden, opts)).toMatchObject({ visible: false, primaryAngle: null });
    expect(squat.read(undefined, opts).visible).toBe(false);
  });
});

describe("pushup.read", () => {
  // Side-on plank, head to the left, arms straight down.
  const plank = (hipY = 0.52) =>
    body({
      [L.LEFT_SHOULDER]: [0.3, 0.5],
      [L.LEFT_ELBOW]: [0.3, 0.6],
      [L.LEFT_WRIST]: [0.3, 0.7],
      [L.LEFT_HIP]: [0.55, hipY],
      [L.LEFT_ANKLE]: [0.8, 0.55],
      [L.RIGHT_SHOULDER]: [0.31, 0.5, 0.3],
      [L.RIGHT_ELBOW]: [0.31, 0.6, 0.3],
      [L.RIGHT_WRIST]: [0.31, 0.7, 0.3],
    });

  it("reads the elbow angle and chest-drop inputs in a plank", () => {
    const r = pushup.read(plank(), opts);
    expect(r.visible).toBe(true);
    expect(r.primaryAngle).toBeCloseTo(180, 0);
    expect(r.progress).toMatchObject({ kind: "drop", y: 0.5 });
    expect(r.form.bodyLine).toBeGreaterThan(170);
    expect(r.positionHint).toBeNull();
  });

  it("doesn't count arm bends while standing up", () => {
    const standing = body({
      [L.LEFT_SHOULDER]: [0.5, 0.2],
      [L.LEFT_ELBOW]: [0.5, 0.35],
      [L.LEFT_WRIST]: [0.55, 0.25],
      [L.LEFT_HIP]: [0.5, 0.5],
      [L.LEFT_ANKLE]: [0.5, 0.9],
    });
    const r = pushup.read(standing, opts);
    expect(r.primaryAngle).toBeNull();
    expect(r.positionHint).toMatch(/push-up position/);
  });

  it("flags sagging and piked hips from the body line", () => {
    const sag = pushup.read(plank(0.62), opts).form;
    expect(sag.bodyLine).toBeLessThan(160);
    expect(sag.hipOffset).toBeGreaterThan(0);
    const flags = pushup.formChecks({} as never, {
      bodyLine: { min: sag.bodyLine!, max: 175, coverage: 1 },
      hipOffset: { min: 0, max: sag.hipOffset!, coverage: 1 },
    });
    expect(flags.map((f) => [f.code, f.source])).toEqual([["HIPS_SAGGING", "measured"]]);

    const pike = pushup.read(plank(0.4), opts).form;
    expect(pike.hipOffset).toBeLessThan(0);
    const pikeFlags = pushup.formChecks({} as never, {
      bodyLine: { min: pike.bodyLine!, max: 175, coverage: 1 },
      hipOffset: { min: pike.hipOffset!, max: 0, coverage: 1 },
    });
    expect(pikeFlags.map((f) => f.code)).toEqual(["HIPS_PIKED"]);
  });
});

describe("bicepCurl.read", () => {
  const arm = (wrist: P) =>
    body({
      [L.LEFT_SHOULDER]: [0.5, 0.3],
      [L.LEFT_ELBOW]: [0.5, 0.5],
      [L.LEFT_WRIST]: wrist,
      [L.LEFT_HIP]: [0.5, 0.6],
      [L.RIGHT_SHOULDER]: [0.51, 0.3, 0.3],
      [L.RIGHT_ELBOW]: [0.51, 0.5, 0.3],
      [L.RIGHT_WRIST]: [0.51, 0.7, 0.3],
    });

  it("reads a straight arm and a curled arm", () => {
    expect(bicepCurl.read(arm([0.5, 0.7]), opts).primaryAngle).toBeCloseTo(180, 0);
    expect(bicepCurl.read(arm([0.6, 0.4]), opts).primaryAngle).toBeCloseTo(45, 0);
    expect(bicepCurl.read(arm([0.5, 0.7]), opts).side).toBe("left");
  });

  it("measures elbow drift and body swing, and flags them", () => {
    expect(bicepCurl.read(arm([0.6, 0.4]), opts).form.elbowDrift).toBeCloseTo(0, 0);
    const flags = bicepCurl.formChecks({} as never, {
      elbowDrift: { min: 5, max: 50, coverage: 1 },
      torsoLean: { min: -2, max: 20, coverage: 1 },
    });
    expect(flags.map((f) => [f.code, f.source])).toEqual([
      ["ELBOW_DRIFT", "measured"],
      ["BODY_SWING", "measured"],
    ]);
    expect(bicepCurl.formChecks({} as never, { elbowDrift: { min: 0, max: 10, coverage: 1 }, torsoLean: { min: 0, max: 5, coverage: 1 } })).toEqual([]);
  });
});

describe("shoulderPress.read", () => {
  // Front view; image left = person's right, but only symmetry matters here.
  const rack = body({
    [L.LEFT_SHOULDER]: [0.4, 0.4],
    [L.LEFT_ELBOW]: [0.3, 0.4],
    [L.LEFT_WRIST]: [0.3, 0.3],
    [L.RIGHT_SHOULDER]: [0.6, 0.4],
    [L.RIGHT_ELBOW]: [0.7, 0.4],
    [L.RIGHT_WRIST]: [0.7, 0.3],
  });
  const overhead = body({
    [L.LEFT_SHOULDER]: [0.4, 0.4],
    [L.LEFT_ELBOW]: [0.38, 0.27],
    [L.LEFT_WRIST]: [0.37, 0.14],
    [L.RIGHT_SHOULDER]: [0.6, 0.4],
    [L.RIGHT_ELBOW]: [0.62, 0.27],
    [L.RIGHT_WRIST]: [0.63, 0.14],
  });

  it("reads both elbows at the rack position", () => {
    const r = shoulderPress.read(rack, opts);
    expect(r.side).toBe("both");
    expect(r.primaryAngle).toBeCloseTo(90, 0);
    expect(r.progress).toMatchObject({ kind: "absolute" });
    if (r.progress?.kind === "absolute") expect(r.progress.value).toBeCloseTo(0.5, 1);
  });

  it("reads lockout with hands well above the shoulders", () => {
    const r = shoulderPress.read(overhead, opts);
    expect(r.primaryAngle!).toBeGreaterThan(170);
    if (r.progress?.kind === "absolute") expect(r.progress.value).toBeGreaterThan(0.9);
  });

  it("uses the lagging arm, and measures the difference", () => {
    const uneven = overhead.map((p, i) => (i === L.RIGHT_WRIST ? { ...p, x: 0.75, y: 0.3 } : i === L.RIGHT_ELBOW ? { ...p, x: 0.7, y: 0.4 } : p));
    const r = shoulderPress.read(uneven, opts);
    expect(r.primaryAngle!).toBeLessThan(120);
    expect(r.form.armDiff!).toBeGreaterThan(50);
    const flags = shoulderPress.formChecks({} as never, { armDiff: { min: 0, max: r.form.armDiff!, coverage: 1 } });
    expect(flags.map((f) => f.code)).toEqual(["UNEVEN_ARMS"]);
  });

  it("asks to face the camera when an arm is hidden", () => {
    const sideOn = rack.map((p, i) => (i === L.RIGHT_WRIST ? { ...p, visibility: 0.2 } : p));
    const r = shoulderPress.read(sideOn, opts);
    expect(r.primaryAngle).toBeNull();
    expect(r.positionHint).toMatch(/Face the camera/);
  });
});

describe("squat, front view", () => {
  // Facing the camera, standing, feet hip-width apart.
  const front = (kneeSpread: number) =>
    body({
      [L.LEFT_SHOULDER]: [0.42, 0.2],
      [L.RIGHT_SHOULDER]: [0.58, 0.2],
      [L.LEFT_HIP]: [0.45, 0.5],
      [L.RIGHT_HIP]: [0.55, 0.5],
      [L.LEFT_KNEE]: [0.5 - kneeSpread / 2, 0.7],
      [L.RIGHT_KNEE]: [0.5 + kneeSpread / 2, 0.7],
      [L.LEFT_ANKLE]: [0.44, 0.9],
      [L.RIGHT_ANKLE]: [0.56, 0.9],
    });
  // World landmarks (metres): a bent knee, pointing toward the camera (−z).
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[L.LEFT_HIP] = { x: -0.1, y: 0, z: 0 };
  world[L.LEFT_KNEE] = { x: -0.1, y: 0.3, z: -0.3 };
  world[L.LEFT_ANKLE] = { x: -0.1, y: 0.7, z: -0.3 };
  world[L.RIGHT_HIP] = { x: 0.1, y: 0, z: 0 };
  world[L.RIGHT_KNEE] = { x: 0.1, y: 0.3, z: -0.3 };
  world[L.RIGHT_ANKLE] = { x: 0.1, y: 0.7, z: -0.3 };

  it("uses the 3D knee angle and measures the knee-to-ankle ratio", () => {
    const r = squat.read(front(0.12), { ...opts, view: "front", world });
    expect(r.view).toBe("front");
    expect(r.side).toBe("both");
    expect(r.primaryAngle).toBeCloseTo(135, 0);
    expect(r.form.kneeRatio).toBeCloseTo(1, 1);
  });

  it("falls back to the side-view reading without world landmarks", () => {
    expect(squat.read(front(0.12), { ...opts, view: "front" }).view).toBe("side");
  });

  it("flags knees caving in on the way up, only from the front", () => {
    const r = squat.read(front(0.06), { ...opts, view: "front", world });
    expect(r.form.kneeRatio).toBeCloseTo(0.5, 1);
    const stats = { "kneeRatio@returning": { min: r.form.kneeRatio!, max: 1, coverage: 1 } };
    expect(squat.formChecks({} as never, stats, "front").map((f) => [f.code, f.source])).toEqual([
      ["KNEES_CAVING", "estimated"],
    ]);
    expect(squat.formChecks({} as never, stats, "side")).toEqual([]);
  });

  it("asks to step back when the legs aren't all visible", () => {
    const hidden = front(0.12).map((p, i) => (i === L.RIGHT_ANKLE ? { ...p, visibility: 0.2 } : p));
    expect(squat.read(hidden, { ...opts, view: "front", world }).positionHint).toMatch(/both legs/);
  });
});

describe("deadlift.read", () => {
  // Side-on, facing image right (toes to the right of heels).
  const pose = (shoulder: [number, number]) =>
    body({
      [L.LEFT_SHOULDER]: shoulder,
      [L.LEFT_HIP]: [0.5, 0.5],
      [L.LEFT_KNEE]: [0.55, 0.7],
      [L.LEFT_ANKLE]: [0.5, 0.9],
      [L.LEFT_HEEL]: [0.48, 0.92],
      [L.LEFT_FOOT_INDEX]: [0.56, 0.92],
      [L.RIGHT_SHOULDER]: [shoulder[0], shoulder[1], 0.3],
      [L.RIGHT_HIP]: [0.5, 0.5, 0.3],
      [L.RIGHT_KNEE]: [0.55, 0.7, 0.3],
    });

  it("reads a small hip angle at set-up, forward lean, and shoulder height as negated y", () => {
    const r = deadlift.read(pose([0.75, 0.42]), opts);
    expect(r.primaryAngle!).toBeLessThan(115);
    expect(r.form.torsoLean!).toBeGreaterThan(45);
    expect(r.progress).toMatchObject({ kind: "drop", y: -0.42 });
  });

  it("reads lockout, and a lean back past vertical as negative", () => {
    const tall = deadlift.read(pose([0.5, 0.2]), opts);
    expect(tall.primaryAngle!).toBeGreaterThan(160);
    expect(Math.abs(tall.form.torsoLean!)).toBeLessThan(1);
    const leanBack = deadlift.read(pose([0.4, 0.22]), opts);
    expect(leanBack.form.torsoLean!).toBeLessThan(-15);
    const flags = deadlift.formChecks({} as never, {
      "torsoLean@peak": { min: leanBack.form.torsoLean!, max: 0, coverage: 1 },
    });
    expect(flags.map((f) => f.code)).toEqual(["LEANING_BACK"]);
  });
});

describe("lunge.read", () => {
  const pose = (backAnkleX: number, shoulderX = 0.5) =>
    body({
      [L.LEFT_SHOULDER]: [shoulderX, 0.2],
      [L.LEFT_HIP]: [0.5, 0.5],
      [L.LEFT_KNEE]: [0.68, 0.55],
      [L.LEFT_ANKLE]: [0.65, 0.85],
      [L.RIGHT_HIP]: [0.5, 0.5, 0.5],
      [L.RIGHT_ANKLE]: [backAnkleX, 0.85, 0.5],
    });

  it("reads the knee angle, step length and torso lean", () => {
    const r = lunge.read(pose(0.25), opts);
    expect(r.side).toBe("left");
    expect(r.primaryAngle!).toBeLessThan(110);
    expect(r.form.stepRatio!).toBeGreaterThan(0.9);
    expect(r.form.torsoLean!).toBeCloseTo(0, 0);
  });

  it("flags a short step and a leaning torso", () => {
    const r = lunge.read(pose(0.6, 0.35), opts);
    expect(r.form.stepRatio!).toBeLessThan(0.45);
    const flags = lunge.formChecks({} as never, {
      "stepRatio@peak": { min: r.form.stepRatio!, max: r.form.stepRatio!, coverage: 1 },
      torsoLean: { min: 0, max: r.form.torsoLean!, coverage: 1 },
    });
    expect(flags.map((f) => f.code)).toEqual(["SHORT_STEP", "TORSO_LEAN"]);
  });
});
