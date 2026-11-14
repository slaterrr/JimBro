import { describe, expect, it } from "vitest";
import { squat, squatQualityModel } from "../exercises/squat";
import modelJson from "./models/squat_uiprmd.json";
import { QualityModel, type QualityModelJson } from "./quality_model";
import { FEATURE_NAMES, STEPS, repFeatures, resample, type RepFrame } from "./rep_features";

/** A synthetic side-view squat trace: stand, descend to `bottom`, rise, stand. */
function squatTrace(bottom: number, dropMax: number, leanMax = 30, ms = 2400): RepFrame[] {
  const frames: RepFrame[] = [];
  for (let t = 0; t <= ms + 1000; t += 33) {
    const phase = Math.min(1, Math.max(0, (t - 500) / ms));
    const d = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    frames.push({
      t,
      knee: 175 - (175 - bottom) * d,
      hip: 172 - (172 - (bottom - 10)) * d,
      lean: 5 + (leanMax - 5) * d,
      drop: dropMax * d,
    });
  }
  return frames;
}

describe("repFeatures", () => {
  it("produces one value per feature name", () => {
    const f = repFeatures(squatTrace(70, 0.55))!;
    expect(f).toHaveLength(FEATURE_NAMES.length);
    expect(f.every(Number.isFinite)).toBe(true);
  });

  it("crops standing time, so a longer pause doesn't change the features", () => {
    const a = repFeatures(squatTrace(70, 0.55))!;
    const padded = [...squatTrace(70, 0.55)];
    const extra = Array.from({ length: 30 }, (_, i) => ({ ...padded[0]!, t: -1000 + i * 33 }));
    const b = repFeatures([...extra, ...padded])!;
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 2);
  });

  it("is speed-independent (resampled in time)", () => {
    const slow = repFeatures(squatTrace(70, 0.55, 30, 3600))!;
    const fast = repFeatures(squatTrace(70, 0.55, 30, 1800))!;
    for (let i = 0; i < 4 * STEPS; i++) expect(fast[i]).toBeCloseTo(slow[i]!, 1);
  });

  it("refuses to judge without enough evidence", () => {
    expect(repFeatures([])).toBeNull();
    // Barely bends: nothing to crop.
    expect(repFeatures(squatTrace(170, 0.02))).toBeNull();
    // A channel mostly missing.
    const gappy = squatTrace(70, 0.55).map((f, i) => (i % 3 ? { ...f, lean: null } : f));
    expect(repFeatures(gappy)).toBeNull();
  });

  it("resamples linearly", () => {
    const pts = [
      { t: 0, v: 0 },
      { t: 10, v: 10 },
    ];
    expect(resample(pts, 0, 10, 3)).toEqual([0, 5, 10]);
  });
});

describe("QualityModel", () => {
  it("loads the shipped squat model, built on this build's features", () => {
    expect(squatQualityModel.spec.featureNames).toEqual([...FEATURE_NAMES]);
    expect(squatQualityModel.spec.threshold).toBeGreaterThan(0);
    expect(squatQualityModel.spec.evaluation.subjects).toBe(10);
  });

  it("scores deeper squats as less likely incorrect than shallow ones", () => {
    const deep = squatQualityModel.predict(repFeatures(squatTrace(60, 0.6))!);
    const shallow = squatQualityModel.predict(repFeatures(squatTrace(115, 0.25))!);
    expect(deep).toBeGreaterThanOrEqual(0);
    expect(shallow).toBeLessThanOrEqual(1);
    expect(shallow).toBeGreaterThan(deep);
  });

  it("documents the domain gap: a parallel gym squat scores high, so the squat model must not flag yet", () => {
    const parallel = squatQualityModel.predict(repFeatures(squatTrace(80, 0.42, 35))!);
    expect(parallel).toBeGreaterThan(squatQualityModel.spec.threshold);
    expect(squat.quality?.raiseFlag).toBe(false);
  });

  it("rejects a model trained on different features", () => {
    const bad = { ...(modelJson as QualityModelJson), featureNames: ["x"], mean: [0], std: [1], weights: [1] };
    expect(() => new QualityModel(bad)).toThrow(/different features/);
  });
});
