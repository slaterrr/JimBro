/**
 * Tests of the label-gated trait trainer on a SYNTHETIC dataset. A model here
 * learning a synthetic trait proves the pipeline works, not that any real
 * technique check is accurate.
 */
import { describe, expect, it } from "vitest";
import { pose, type PoseSpec } from "../test_fixtures";
import { DATASET_SCHEMA, type DatasetRep } from "../validation/dataset";
import { cohenKappa, consensus, trainTrait } from "./trait_training";

const DT = 33;
const CODE = "DEPTH_SHALLOW";

/** One squat rep; `depth` 0.7 = shallow, 1.2 = deep; small per-subject variation. */
function repRow(subject: number, index: number, shallow: boolean, labels: DatasetRep["labels"]): DatasetRep {
  const depth = (shallow ? 0.7 : 1.2) + ((subject * 7 + index * 3) % 5) * 0.02;
  const specs: PoseSpec[] = [];
  for (let k = 0; k < 10; k++) specs.push({ facing: 1, frontLabel: "left", depth: 0, split: 0 });
  for (let k = 0; k <= 30; k++) specs.push({ facing: 1, frontLabel: "left", depth: depth * Math.sin((Math.PI * k) / 30), split: 0 });
  for (let k = 0; k < 10; k++) specs.push({ facing: 1, frontLabel: "left", depth: 0, split: 0 });
  return {
    schema: DATASET_SCHEMA,
    recordingId: `rec-${subject}`,
    subjectId: `s${subject}`,
    sourceSha256: "x",
    mirrored: false,
    aspectRatio: 1,
    exercise: "squat",
    variation: "bodyweight squat",
    view: "side",
    rep: { index, start: 10 * DT, end: 40 * DT },
    frames: specs.map((p, i) => ({ t: i * DT, lm: pose(p).map((q) => [q.x, q.y, 0, q.visibility ?? 0]), world: null, detectMs: 0 })),
    labels,
    reviewers: Object.keys(labels[CODE] ?? {}),
  };
}

const agree = (shallow: boolean) => ({ [CODE]: { "coach-1": shallow ? "yes" : "no", "coach-2": shallow ? "yes" : "no" } }) as DatasetRep["labels"];

function dataset(subjects: number, labels: (shallow: boolean, i: number) => DatasetRep["labels"] = agree): DatasetRep[] {
  const rows: DatasetRep[] = [];
  for (let s = 0; s < subjects; s++) for (let i = 0; i < 8; i++) rows.push(repRow(s, i, i % 2 === 0, labels(i % 2 === 0, i)));
  return rows;
}

describe("consensus and agreement", () => {
  it("keeps only reps with enough agreeing yes/no reviewers", () => {
    const rows = [
      repRow(0, 0, true, agree(true)),
      repRow(0, 1, true, { [CODE]: { "coach-1": "yes" } }),
      repRow(0, 2, true, { [CODE]: { "coach-1": "yes", "coach-2": "no" } }),
      repRow(0, 3, true, { [CODE]: { "coach-1": "unsure", "coach-2": "unsure" } }),
      repRow(0, 4, true, {}),
    ];
    const c = consensus(rows, CODE, 2);
    expect(c.included.map((x) => x.y)).toEqual([1]);
    expect(c.excluded).toEqual({ noLabel: 2, tooFewReviewers: 1, disagreement: 1 });
  });

  it("measures reviewer agreement with Cohen's kappa", () => {
    expect(cohenKappa(dataset(2), CODE)).toBeCloseTo(1);
    // coach-2 disagrees on half the reps: kappa near 0.
    const noisy = dataset(2, (shallow, i) => ({ [CODE]: { "coach-1": shallow ? "yes" : "no", "coach-2": i % 4 < 2 ? "yes" : "no" } }));
    expect(cohenKappa(noisy, CODE)!).toBeLessThan(0.3);
  });
});

describe("trainTrait", () => {
  it("trains on agreed labels and evaluates on held-out people", () => {
    const r = trainTrait(dataset(12), "squat", CODE);
    expect(r.status).toBe("trained");
    expect(r.data).toMatchObject({ subjects: 12, positives: 48, negatives: 48, kappa: 1 });
    expect(r.heldOut!.auc).toBeGreaterThan(0.9);
    // The app has no rule with this code, so there's no baseline to beat.
    expect(r.ruleBaseline).toBeNull();
    expect(r.releasable).toBe(true);
    expect(r.model!.featureNames[0]).toBe("angle_0");
    expect(r.model!.featureNames.some((n) => n.startsWith("kneeRatio"))).toBe(false); // side view: never present
  });

  it("refuses with a single reviewer (no agreement to check)", () => {
    const r = trainTrait(dataset(12, (shallow) => ({ [CODE]: { "coach-1": shallow ? "yes" : "no" } })), "squat", CODE);
    expect(r.status).toBe("refused");
    expect(r.reasons.join(" ")).toMatch(/agreement|10 people|each class/);
    expect(r.model).toBeUndefined();
  });

  it("refuses when reviewers don't agree", () => {
    const noisy = dataset(12, (shallow, i) => ({ [CODE]: { "coach-1": shallow ? "yes" : "no", "coach-2": i % 4 < 2 ? "yes" : "no" } }));
    const r = trainTrait(noisy, "squat", CODE);
    expect(r.status).toBe("refused");
    expect(r.reasons.join(" ")).toMatch(/κ/);
  });

  it("refuses with too few people", () => {
    const r = trainTrait(dataset(5), "squat", CODE);
    expect(r.status).toBe("refused");
    expect(r.reasons.join(" ")).toMatch(/Only 5 people/);
  });

  it("never invents labels: unlabelled reps produce no training data", () => {
    const r = trainTrait(dataset(12, () => ({})), "squat", CODE);
    expect(r.status).toBe("refused");
    expect(r.data.included).toBe(0);
  });
});
