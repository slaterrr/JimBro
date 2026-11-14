/**
 * Tests of the VALIDATION TOOLING on synthetic recordings. These check the
 * evaluation code computes the right numbers; they are not accuracy results.
 */
import { describe, expect, it } from "vitest";
import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L } from "../pose_detection";
import { lungeRep, pose, type PoseSpec } from "../test_fixtures";
import { exportDataset, parseJsonl, toJsonl, type DatasetRep } from "./dataset";
import { countKneeSwaps, evaluate, matchReps, type Evaluation } from "./evaluate";
import { RECORDING_SCHEMA, assertRecording, type Annotation, type Recording } from "./format";
import { recognizeExercise } from "./recognize";
import { EVIDENCE, renderMarkdown, summarize } from "./report";

const DT = 33;

function recording(specs: PoseSpec[], mirrored = false): Recording {
  return {
    schema: RECORDING_SCHEMA,
    id: "rec-1",
    createdAt: "2026-11-14T00:00:00Z",
    subjectId: "subj-1",
    source: { fileName: "x.mp4", sha256: "abc", bytes: 1, durationSec: (specs.length * DT) / 1000, width: 1000, height: 1000, mirrored },
    extraction: { model: "synthetic", mediapipe: "n/a", sampleMs: DT, extractedAt: "2026-11-14T00:00:00Z" },
    frames: specs.map((p, i) => ({
      t: i * DT,
      lm: pose(p).map((q) => [q.x, q.y, q.z ?? 0, q.visibility ?? 0]),
      world: null,
      detectMs: 10 + (i % 5),
    })),
    annotations: [],
  };
}

/** Squats = feet together, hips descending. */
function squatSpecs(reps: number): { specs: PoseSpec[]; spans: Array<{ start: number; end: number }> } {
  const specs: PoseSpec[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const add = (n: number, depth: (k: number) => number) => {
    for (let k = 0; k <= n; k++) specs.push({ facing: 1, frontLabel: "left", depth: depth(k / n), split: 0 });
  };
  add(15, () => 0);
  for (let r = 0; r < reps; r++) {
    const start = specs.length * DT;
    add(30, (k) => 1.2 * Math.sin(Math.PI * k));
    spans.push({ start, end: specs.length * DT });
    add(10, () => 0);
  }
  return { specs, spans };
}

function annotation(over: Partial<Annotation>): Annotation {
  return {
    id: "ann-1",
    reviewer: { id: "coach-1", role: "coach" },
    createdAt: "2026-11-14T00:00:00Z",
    exercise: "squat",
    variation: "bodyweight squat",
    view: "side",
    reps: [],
    angleChecks: [],
    traits: [],
    ...over,
  };
}

describe("recording format", () => {
  it("accepts a valid recording and rejects broken ones", () => {
    const rec = recording(squatSpecs(1).specs);
    expect(() => assertRecording(rec)).not.toThrow();
    expect(() => assertRecording({ ...rec, schema: "x" })).toThrow(/schema/);
    expect(() => assertRecording({ ...rec, frames: [rec.frames[1], rec.frames[0]] })).toThrow(/increase/);
    expect(() =>
      assertRecording({ ...rec, annotations: [annotation({ reps: [{ start: 100, end: 50 }] })] }),
    ).toThrow(/after start/);
  });
});

describe("evaluate: reps", () => {
  const { specs, spans } = squatSpecs(3);
  const rec = recording(specs);

  it("replays through the real tracker and matches every annotated rep", () => {
    const e = evaluate(rec, annotation({ reps: spans }));
    expect(e.reps).toMatchObject({ annotated: 3, predicted: 3, countError: 0, matched: 3, falsePositives: 0, missed: 0 });
  });

  it("reports missed reps and false positives", () => {
    const extra = evaluate(rec, annotation({ reps: [...spans, { start: 99_000, end: 100_000 }] }));
    expect(extra.reps).toMatchObject({ countError: -1, missed: 1 });
    const fewer = evaluate(rec, annotation({ reps: spans.slice(0, 2) }));
    expect(fewer.reps).toMatchObject({ countError: 1, falsePositives: 1 });
  });

  it("pairs reps one-to-one by overlap", () => {
    const ev = (n: number, s: number, e: number) => ({ repNumber: n, startedAt: s, endedAt: e }) as never;
    const m = matchReps({ reps: [{ start: 0, end: 1000 }, { start: 1200, end: 2000 }] }, [ev(1, 100, 900), ev(2, 5000, 6000)]);
    expect(m.map((x) => x.predicted?.repNumber ?? null)).toEqual([1, null]);
  });

  it("records extraction and pipeline latency", () => {
    const e = evaluate(rec, annotation({ reps: spans }));
    expect(e.latency.detectP50).toBeGreaterThanOrEqual(10);
    expect(e.latency.pipelineP95).toBeGreaterThanOrEqual(0);
  });
});

describe("evaluate: angles", () => {
  const { specs } = squatSpecs(1);
  const rec = recording(specs);
  const f = rec.frames[30]!;
  const lm = f.lm!.map(([x, y]) => ({ x: x!, y: y! }));
  const truth = calculateAngle(lm[L.LEFT_HIP]!, lm[L.LEFT_KNEE]!, lm[L.LEFT_ANKLE]!)!;

  it("computes error against goniometer references, separately from on-screen ones", () => {
    const e = evaluate(
      rec,
      annotation({
        angleChecks: [
          { t: f.t, joint: "left_knee", degrees: truth + 3, method: "goniometer" },
          { t: f.t, joint: "left_knee", degrees: truth - 10, method: "on-screen" },
        ],
      }),
    );
    expect(e.angles.groundTruth.n).toBe(1);
    expect(e.angles.groundTruth.meanAbsError).toBeCloseTo(3, 5);
    expect(e.angles.onScreen.meanAbsError).toBeCloseTo(10, 5);
  });
});

describe("evaluate: lunge leg roles", () => {
  const sets: PoseSpec[] = [...lungeRep(1, "left"), ...lungeRep(1, "right")];
  const spanOf = (from: number, n: number) => ({ start: from * DT, end: (from + n) * DT });
  const n = lungeRep(1, "left").length;

  it("scores front-leg identification against the reviewer", () => {
    const e = evaluate(
      recording(sets),
      annotation({ exercise: "lunge", reps: [{ ...spanOf(0, n), frontLeg: "left" }, { ...spanOf(n, n), frontLeg: "right" }] }),
    );
    expect(e.legRoles).toEqual({ checked: 2, correct: 2, wrong: 0, uncertain: 0 });
  });

  it("swaps left/right for mirrored (selfie) videos", () => {
    // In a mirrored video MediaPipe's "left" is the person's right.
    const e = evaluate(
      recording(sets, true),
      annotation({ exercise: "lunge", reps: [{ ...spanOf(0, n), frontLeg: "right" }, { ...spanOf(n, n), frontLeg: "left" }] }),
    );
    expect(e.legRoles?.correct).toBe(2);
  });

  it("counts uncertain reps instead of guessing", () => {
    const hidden = lungeRep(1, "left", { farVis: 0.1 });
    const e = evaluate(recording(hidden), annotation({ exercise: "lunge", reps: [{ start: 0, end: hidden.length * DT, frontLeg: "left" }] }));
    expect(e.legRoles).toMatchObject({ checked: 1, correct: 0, uncertain: 1 });
  });
});

describe("landmark checks and recognition", () => {
  it("detects a left/right knee swap", () => {
    const rec = recording(squatSpecs(1).specs.map((p) => ({ ...p, split: 0.6 })));
    const i = 20;
    const f = rec.frames[i]!.lm!;
    [f[L.LEFT_KNEE], f[L.RIGHT_KNEE]] = [f[L.RIGHT_KNEE]!, f[L.LEFT_KNEE]!];
    expect(countKneeSwaps(rec)).toBeGreaterThanOrEqual(1);
    expect(countKneeSwaps(recording(squatSpecs(1).specs))).toBe(0);
  });

  it("recognises squats and lunges from the synthetic clips", () => {
    const toLm = (specs: PoseSpec[]) => specs.map((p) => pose(p));
    expect(recognizeExercise(toLm(squatSpecs(2).specs), 1).exercise).toBe("squat");
    expect(recognizeExercise(toLm([...lungeRep(1, "left"), ...lungeRep(1, "right")]), 1).exercise).toBe("lunge");
    expect(recognizeExercise([], 1).exercise).toBeNull();
  });
});

describe("reliability verdicts", () => {
  const { specs, spans } = squatSpecs(3);
  const one = evaluate(recording(specs), annotation({ reps: spans }));

  it("never calls one person's perfect result validated", () => {
    const [s] = summarize([one]);
    expect(s!.reps.precision).toBe(1);
    expect(s!.reps.verdict).toBe("insufficient evidence");
    expect(s!.angles.verdict).toBe("not validated");
  });

  it("validates only with enough people and reps meeting the target", () => {
    const many: Evaluation[] = Array.from({ length: EVIDENCE.minSubjects }, (_, i) => ({
      ...one,
      subjectId: `s${i}`,
      recordingId: `r${i}`,
      reps: { ...one.reps, annotated: 12, predicted: 12, matched: 12, countError: 0, falsePositives: 0, missed: 0 },
    }));
    expect(summarize(many)[0]!.reps.verdict).toBe("validated");
    const bad = many.map((e) => ({ ...e, reps: { ...e.reps, predicted: 14, matched: 11, countError: 2, falsePositives: 3, missed: 1 } }));
    expect(summarize(bad)[0]!.reps.verdict).toBe("below target");
  });

  it("renders an explicit 'nothing validated' report with no data", () => {
    expect(renderMarkdown([])).toMatch(/No annotated recordings evaluated yet/);
    expect(renderMarkdown(summarize([one]))).toMatch(/not from the unit tests/);
  });
});

describe("dataset export", () => {
  const { specs, spans } = squatSpecs(2);
  const rec = recording(specs);
  rec.annotations = [
    annotation({ id: "a1", reviewer: { id: "coach-1", role: "coach" }, reps: spans, traits: [{ rep: 0, code: "DEPTH_OK", value: "yes" }] }),
    annotation({
      id: "a2",
      reviewer: { id: "coach-2", role: "coach" },
      // Slightly different boundaries for the same reps.
      reps: spans.map((s) => ({ start: s.start + 60, end: s.end - 30 })),
      traits: [
        { rep: 0, code: "DEPTH_OK", value: "no" },
        { rep: null, code: "SET_NOTE", value: "unsure" },
      ],
    }),
  ];

  it("exports one row per rep with every reviewer's labels kept separate", () => {
    const rows = exportDataset([rec]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.labels.DEPTH_OK).toEqual({ "coach-1": "yes", "coach-2": "no" });
    expect(rows[0]!.labels.SET_NOTE).toEqual({ "coach-2": "unsure" });
    expect(rows[1]!.labels.DEPTH_OK).toBeUndefined();
    expect(rows[0]!.reviewers).toEqual(["coach-1", "coach-2"]);
    expect(rows[0]).toMatchObject({ subjectId: "subj-1", sourceSha256: "abc", exercise: "squat" });
    // Context frames around the rep.
    expect(rows[0]!.frames[0]!.t).toBeLessThan(spans[0]!.start);
  });

  it("round-trips through JSON Lines", () => {
    const rows = exportDataset([rec]);
    expect(parseJsonl<DatasetRep>(toJsonl(rows))).toEqual(JSON.parse(JSON.stringify(rows)));
  });
});

describe("evaluate: 2D vs 3D angle error under camera yaw", () => {
  const rotY = (p: { x: number; y: number; z: number }, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) };
  };
  function yawedRecording(yaw: number): Recording {
    const body = {
      [L.LEFT_HIP]: { x: -0.1, y: 0, z: 0 },
      [L.RIGHT_HIP]: { x: 0.1, y: 0, z: 0 },
      [L.RIGHT_KNEE]: { x: 0.1, y: -0.3, z: 0.3 },
      [L.RIGHT_ANKLE]: { x: 0.1, y: -0.7, z: 0.15 },
    } as Record<number, { x: number; y: number; z: number }>;
    const world = Array.from({ length: 33 }, (_, i) => {
      const p = rotY(body[i] ?? { x: 0, y: 0, z: 0 }, yaw);
      return [p.x, p.y, p.z];
    });
    // Side-on camera: image x = depth axis z, image y = down.
    const lm = world.map(([, y, z]) => [0.5 + z! * 0.5, 0.5 - y! * 0.5, 0, 0.95]);
    const rec = recording(squatSpecs(1).specs.slice(0, 3));
    rec.frames = rec.frames.map((f) => ({ ...f, lm, world }));
    return rec;
  }

  it("shows the 2D error growing with yaw while the 3D sagittal angle stays right", () => {
    const truth = 114.44;
    const check = { t: 0, joint: "right_knee" as const, degrees: truth, method: "goniometer" as const };
    const side = evaluate(yawedRecording(0), annotation({ angleChecks: [check] }));
    const turned = evaluate(yawedRecording(40), annotation({ angleChecks: [check] }));
    expect(side.angles.groundTruth.meanAbsError!).toBeLessThan(0.5);
    expect(turned.angles.groundTruth.meanAbsError!).toBeGreaterThan(10);
    expect(turned.angles.groundTruth3d.meanAbsError!).toBeLessThan(0.5);
  });
});
