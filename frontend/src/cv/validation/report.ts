/**
 * Aggregate evaluations into a reliability verdict per exercise and view.
 *
 * A measurement is "validated" only when real annotated recordings meet the
 * target AND there's enough evidence (people and reps) for that to mean
 * something. Below the evidence bar it's "insufficient evidence", whatever
 * the numbers say. No recordings at all = "not validated".
 */

import type { Evaluation } from "./evaluate";

export const TARGETS = {
  /** Fraction of sets with exactly the annotated number of reps. */
  exactCountRate: 0.95,
  /** Counted reps that match an annotated rep, and annotated reps that were counted. */
  repPrecision: 0.97,
  repRecall: 0.97,
  /** Mean absolute joint-angle error vs goniometer / mocap, degrees. */
  angleMaeSide: 5,
  angleMaeOther: 10,
  /** Front-leg identification accuracy (uncertain counts as not correct). */
  legRoleAccuracy: 0.95,
  armAccuracy: 0.95,
  recognitionAccuracy: 0.95,
  /** Pipeline latency budget per frame (p95, ms), excluding pose detection. */
  pipelineP95Ms: 4,
} as const;

export const EVIDENCE = {
  minSubjects: 10,
  minReps: 100,
  minAngleChecks: 30,
  minLegChecks: 50,
} as const;

export type Verdict = "validated" | "below target" | "insufficient evidence" | "not validated";

export interface GroupSummary {
  exercise: string;
  view: string;
  recordings: number;
  subjects: number;
  reps: { annotated: number; precision: number | null; recall: number | null; exactCountRate: number | null; verdict: Verdict };
  /** Attempts of a different movement (e.g. lunges in a squat set): how many, and how many were wrongly counted. */
  wrongMovement: { annotated: number; accepted: number };
  angles: { n: number; mae: number | null; verdict: Verdict; n3d: number; mae3d: number | null };
  legRoles: { n: number; accuracy: number | null; uncertainRate: number | null; verdict: Verdict } | null;
  arms: { n: number; accuracy: number | null; verdict: Verdict } | null;
  recognition: { n: number; accuracy: number | null };
  landmarks: { missingRate: number; notVisibleRate: number; glitchRate: number; swapsPer1000: number };
  latency: { detectP95: number; pipelineP95: number };
}

export function summarize(evals: readonly Evaluation[]): GroupSummary[] {
  const groups = new Map<string, Evaluation[]>();
  for (const e of evals) {
    const k = `${e.exercise}|${e.view}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.entries()].map(([k, es]) => {
    const [exercise, view] = k.split("|") as [string, string];
    const subjects = new Set(es.map((e) => e.subjectId)).size;
    const sum = (f: (e: Evaluation) => number) => es.reduce((a, e) => a + f(e), 0);
    const annotated = sum((e) => e.reps.annotated);
    const predicted = sum((e) => e.reps.predicted);
    const matched = sum((e) => e.reps.matched);
    const precision = predicted ? matched / predicted : null;
    const recall = annotated ? matched / annotated : null;
    const exact = es.length ? es.filter((e) => e.reps.countError === 0).length / es.length : null;
    const enough = subjects >= EVIDENCE.minSubjects && annotated >= EVIDENCE.minReps;
    const repsOk = precision !== null && recall !== null && exact !== null && precision >= TARGETS.repPrecision && recall >= TARGETS.repRecall && exact >= TARGETS.exactCountRate;

    const angleN = sum((e) => e.angles.groundTruth.n);
    const angleMae = angleN ? sum((e) => (e.angles.groundTruth.meanAbsError ?? 0) * e.angles.groundTruth.n) / angleN : null;
    const angleTarget = view === "side" ? TARGETS.angleMaeSide : TARGETS.angleMaeOther;
    const n3d = sum((e) => e.angles.groundTruth3d.n);
    const mae3d = n3d ? sum((e) => (e.angles.groundTruth3d.meanAbsError ?? 0) * e.angles.groundTruth3d.n) / n3d : null;

    const legs = es.filter((e) => e.legRoles);
    const legN = legs.reduce((a, e) => a + e.legRoles!.checked, 0);
    const legAcc = legN ? legs.reduce((a, e) => a + e.legRoles!.correct, 0) / legN : null;
    const armsE = es.filter((e) => e.arms);
    const armN = armsE.reduce((a, e) => a + e.arms!.checked, 0);
    const armAcc = armN ? armsE.reduce((a, e) => a + e.arms!.correct, 0) / armN : null;

    const frames = sum((e) => e.landmarks.frames) || 1;
    const verdict = (n: number, ok: boolean, minN: number): Verdict =>
      n === 0 ? "not validated" : subjects < EVIDENCE.minSubjects || n < minN ? "insufficient evidence" : ok ? "validated" : "below target";

    const wrongAnnotated = sum((e) => e.reps.wrongMovement.annotated);
    const wrongAccepted = sum((e) => e.reps.wrongMovement.accepted);
    return {
      exercise,
      view,
      wrongMovement: { annotated: wrongAnnotated, accepted: wrongAccepted },
      recordings: new Set(es.map((e) => e.recordingId)).size,
      subjects,
      reps: {
        annotated,
        precision,
        recall,
        exactCountRate: exact,
        // Any wrong movement counted as this exercise fails the target outright.
        verdict:
          annotated === 0 ? "not validated" : !enough ? "insufficient evidence" : repsOk && wrongAccepted === 0 ? "validated" : "below target",
      },
      angles: {
        n: angleN,
        mae: angleMae,
        verdict: verdict(angleN, angleMae !== null && angleMae <= angleTarget, EVIDENCE.minAngleChecks),
        n3d,
        mae3d,
      },
      legRoles: legs.length
        ? {
            n: legN,
            accuracy: legAcc,
            uncertainRate: legN ? legs.reduce((a, e) => a + e.legRoles!.uncertain, 0) / legN : null,
            verdict: verdict(legN, legAcc !== null && legAcc >= TARGETS.legRoleAccuracy, EVIDENCE.minLegChecks),
          }
        : null,
      arms: armsE.length
        ? { n: armN, accuracy: armAcc, verdict: verdict(armN, armAcc !== null && armAcc >= TARGETS.armAccuracy, EVIDENCE.minLegChecks) }
        : null,
      recognition: { n: es.length, accuracy: es.length ? es.filter((e) => e.recognition.correct).length / es.length : null },
      landmarks: {
        missingRate: sum((e) => e.landmarks.missing) / frames,
        notVisibleRate: sum((e) => e.landmarks.notVisible) / frames,
        glitchRate: sum((e) => e.landmarks.glitches) / frames,
        swapsPer1000: (sum((e) => e.landmarks.suspectedSwaps) / frames) * 1000,
      },
      latency: {
        detectP95: Math.max(...es.map((e) => e.latency.detectP95)),
        pipelineP95: Math.max(...es.map((e) => e.latency.pipelineP95)),
      },
    };
  });
}

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null, d = 1) => (x === null ? "–" : x.toFixed(d));

export function renderMarkdown(summaries: readonly GroupSummary[], generatedAt = new Date().toISOString()): string {
  const lines = [
    "# Jim Bro CV: real-world validation report",
    "",
    `Generated ${generatedAt}. These numbers come from recorded people compared with reviewer annotations,`,
    "not from the unit tests. Passing unit tests only shows the code behaves as designed on synthetic input.",
    "",
    `Evidence bar: at least ${EVIDENCE.minSubjects} people, ${EVIDENCE.minReps} reps, ${EVIDENCE.minAngleChecks} goniometer/mocap angle checks, ${EVIDENCE.minLegChecks} leg/arm checks per exercise and view.`,
    "",
  ];
  if (summaries.length === 0) {
    lines.push("**No annotated recordings evaluated yet: every measurement is unvalidated.**");
    return lines.join("\n");
  }
  lines.push(
    "| Exercise | View | People | Reps | Real reps counted | Wrong movements counted | Rep precision / recall | Exact count | Rep verdict | Angle MAE 2D (n) | Angle MAE 3D (n) | Angle verdict (2D) | Leg/arm accuracy (n) | Leg/arm verdict | Recognition |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    const la = s.legRoles ?? s.arms;
    lines.push(
      `| ${s.exercise} | ${s.view} | ${s.subjects} | ${s.reps.annotated} | ${pct(s.reps.recall)} (${s.reps.recall === null ? 0 : Math.round(s.reps.recall * s.reps.annotated)}/${s.reps.annotated}) | ${s.wrongMovement.accepted}/${s.wrongMovement.annotated} | ${pct(s.reps.precision)} / ${pct(s.reps.recall)} | ${pct(s.reps.exactCountRate)} | ${s.reps.verdict} | ${s.angles.mae === null ? "–" : `${num(s.angles.mae)}°`} (${s.angles.n}) | ${s.angles.mae3d === null ? "–" : `${num(s.angles.mae3d)}°`} (${s.angles.n3d}) | ${s.angles.verdict} | ${la ? `${pct(la.accuracy)} (${la.n})` : "–"} | ${la ? la.verdict : "–"} | ${pct(s.recognition.accuracy)} (${s.recognition.n}) |`,
    );
  }
  lines.push("", "Landmark quality and latency:", "", "| Exercise | View | No person | Joints not visible | Glitches rejected | Suspected knee swaps /1000 frames | Detect p95 | Pipeline p95 |", "|---|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    lines.push(
      `| ${s.exercise} | ${s.view} | ${pct(s.landmarks.missingRate)} | ${pct(s.landmarks.notVisibleRate)} | ${pct(s.landmarks.glitchRate)} | ${num(s.landmarks.swapsPer1000)} | ${num(s.latency.detectP95)} ms | ${num(s.latency.pipelineP95, 2)} ms |`,
    );
  }
  return lines.join("\n");
}
