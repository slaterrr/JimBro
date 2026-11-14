/**
 * Train a per-exercise model for ONE reviewer-labelled technique
 * characteristic (trait), from the lab's exported rep dataset.
 *
 * Built to refuse rather than invent:
 *  - Only reps that at least `minReviewers` reviewers labelled yes/no, and
 *    all agreed on, are used. "unsure", single-reviewer and disputed reps are
 *    excluded and counted.
 *  - Reviewer agreement (Cohen's kappa) must reach `minKappa`, or the label
 *    isn't consistent enough to learn.
 *  - Enough people and examples of each class, or no model.
 *  - Evaluation is leave-one-subject-out, compared against the app's own
 *    rule-based flag for the same code when there is one.
 * Unlabelled movement is never turned into good/bad labels.
 */

import type { ExerciseId } from "../../../../shared/types";
import { getExercise } from "../exercises";
import type { ExerciseDefinition } from "../exercises/types";
import { SignalFilter } from "../signal_filter";
import type { DatasetRep } from "../validation/dataset";
import { toLandmarks, toWorld } from "../validation/format";
import { matchReps } from "../validation/evaluate";
import { replayRecording } from "../validation/replay";
import { auc, confusion, fitLogistic, predict, type Sample } from "./logistic";
import { resample } from "./rep_features";

export interface TraitTrainingOptions {
  minReviewers: number;
  minKappa: number;
  minSubjects: number;
  minPerClass: number;
  /** Release rule: held-out precision at the threshold must reach this. */
  minPrecision: number;
  l2: number;
  steps: number;
}

export const DEFAULT_TRAIT_OPTIONS: Readonly<TraitTrainingOptions> = Object.freeze({
  minReviewers: 2,
  minKappa: 0.6,
  minSubjects: 10,
  minPerClass: 30,
  minPrecision: 0.85,
  l2: 0.05,
  steps: 12,
});

export interface ConsensusResult {
  included: Array<{ row: DatasetRep; y: 0 | 1 }>;
  excluded: { noLabel: number; tooFewReviewers: number; disagreement: number };
}

/** Reps where enough reviewers gave yes/no and all agreed. */
export function consensus(rows: readonly DatasetRep[], code: string, minReviewers: number): ConsensusResult {
  const out: ConsensusResult = { included: [], excluded: { noLabel: 0, tooFewReviewers: 0, disagreement: 0 } };
  for (const row of rows) {
    const votes = Object.values(row.labels[code] ?? {}).filter((v) => v !== "unsure");
    if (votes.length === 0) out.excluded.noLabel += 1;
    else if (votes.length < minReviewers) out.excluded.tooFewReviewers += 1;
    else if (new Set(votes).size > 1) out.excluded.disagreement += 1;
    else out.included.push({ row, y: votes[0] === "yes" ? 1 : 0 });
  }
  return out;
}

/** Mean pairwise Cohen's kappa over reps both reviewers labelled yes/no. null if no pair overlaps enough. */
export function cohenKappa(rows: readonly DatasetRep[], code: string, minOverlap = 10): number | null {
  const reviewers = [...new Set(rows.flatMap((r) => Object.keys(r.labels[code] ?? {})))];
  const kappas: number[] = [];
  for (let i = 0; i < reviewers.length; i++) {
    for (let j = i + 1; j < reviewers.length; j++) {
      const pairs = rows.flatMap((r) => {
        const a = r.labels[code]?.[reviewers[i]!];
        const b = r.labels[code]?.[reviewers[j]!];
        return a && b && a !== "unsure" && b !== "unsure" ? [[a === "yes", b === "yes"] as const] : [];
      });
      if (pairs.length < minOverlap) continue;
      const n = pairs.length;
      const po = pairs.filter(([a, b]) => a === b).length / n;
      const pa = pairs.filter(([a]) => a).length / n;
      const pb = pairs.filter(([, b]) => b).length / n;
      const pe = pa * pb + (1 - pa) * (1 - pb);
      kappas.push(pe >= 1 ? 1 : (po - pe) / (1 - pe));
    }
  }
  return kappas.length ? kappas.reduce((a, b) => a + b, 0) / kappas.length : null;
}

/**
 * Exercise-specific signals for one rep: the app's own reader and filter run
 * over the rep's landmarks; the counting angle ("angle") and every form signal
 * seen at least 5 times in the rep, each resampled to `steps` points plus its
 * min and max.
 */
export function traitSignals(row: DatasetRep, ex: ExerciseDefinition, steps: number): Map<string, number[]> {
  const read = ex.createReader ? ex.createReader() : (lm: Parameters<ExerciseDefinition["read"]>[0], o: Parameters<ExerciseDefinition["read"]>[1]) => ex.read(lm, o);
  const angleF = new SignalFilter();
  const formF = new Map<string, SignalFilter>();
  const series = new Map<string, Array<{ t: number; v: number }>>();
  const push = (k: string, t: number, v: number | null) => {
    if (v !== null) series.set(k, [...(series.get(k) ?? []), { t, v }]);
  };
  for (const f of row.frames) {
    const r = read(toLandmarks(f.lm), {
      aspectRatio: row.aspectRatio,
      minVisibility: 0.6,
      preferredSide: null,
      world: toWorld(f.world),
      view: row.view === "front" ? "front" : "side",
      t: f.t,
    });
    const a = angleF.next(r.primaryAngle, f.t);
    const inRep = f.t >= row.rep.start && f.t <= row.rep.end;
    if (inRep) push("angle", f.t, a);
    for (const [k, raw] of Object.entries(r.form)) {
      let flt = formF.get(k);
      if (!flt) formF.set(k, (flt = new SignalFilter({ maxRatePerSec: Infinity })));
      const v = flt.next(raw, f.t);
      if (inRep) push(k, f.t, v);
    }
  }
  const out = new Map<string, number[]>();
  for (const [k, pts] of series) {
    if (pts.length < 5) continue;
    const vals = pts.map((p) => p.v);
    out.set(k, [...resample(pts, row.rep.start, row.rep.end, steps), Math.min(...vals), Math.max(...vals)]);
  }
  return out;
}

export interface TraitResult {
  exercise: string;
  code: string;
  status: "trained" | "refused";
  reasons: string[];
  data: {
    included: number;
    positives: number;
    negatives: number;
    subjects: number;
    excluded: ConsensusResult["excluded"];
    droppedForMissingSignals: number;
    kappa: number | null;
  };
  /** Leave-one-subject-out results (only when trained). */
  heldOut?: { auc: number; precision: number; recall: number; f1: number; threshold: number };
  /** The app's rule-based flag with the same code, scored on the same reps. */
  ruleBaseline?: { precision: number; recall: number; f1: number } | null;
  /** Release rule met: precision target, and better F1 than the rule baseline if there is one. */
  releasable?: boolean;
  model?: { featureNames: string[]; mean: number[]; std: number[]; weights: number[]; bias: number; threshold: number };
}

export function trainTrait(
  rows: readonly DatasetRep[],
  exercise: ExerciseId,
  code: string,
  options: Partial<TraitTrainingOptions> = {},
): TraitResult {
  const o = { ...DEFAULT_TRAIT_OPTIONS, ...options };
  const ex = getExercise(exercise);
  const mine = rows.filter((r) => r.exercise === exercise);
  const c = consensus(mine, code, o.minReviewers);
  const kappa = cohenKappa(mine, code);

  // Use the signals present in at least 90% of the labelled reps (e.g. a
  // side-view squat never has the front-view knee ratio); drop reps missing one.
  const signals = c.included.map((it) => traitSignals(it.row, ex, o.steps));
  const counts = new Map<string, number>();
  for (const m of signals) for (const k of m.keys()) counts.set(k, (counts.get(k) ?? 0) + 1);
  const keys = [...counts.entries()]
    .filter(([, n]) => n >= 0.9 * c.included.length)
    .map(([k]) => k)
    .sort((a, b) => (a === "angle" ? -1 : b === "angle" ? 1 : a.localeCompare(b)));
  const names = keys.flatMap((k) => [...Array.from({ length: o.steps }, (_, i) => `${k}_${i}`), `${k}_min`, `${k}_max`]);

  const samples: Sample[] = [];
  const kept: Array<{ row: DatasetRep; y: 0 | 1 }> = [];
  let dropped = 0;
  c.included.forEach((it, i) => {
    const m = signals[i]!;
    if (!keys.length || keys.some((k) => !m.has(k))) {
      dropped += 1;
      return;
    }
    samples.push({ x: keys.flatMap((k) => m.get(k)!), y: it.y, subject: it.row.subjectId });
    kept.push(it);
  });
  const positives = samples.filter((s) => s.y === 1).length;
  const subjects = new Set(samples.map((s) => s.subject)).size;
  const result: TraitResult = {
    exercise,
    code,
    status: "refused",
    reasons: [],
    data: { included: samples.length, positives, negatives: samples.length - positives, subjects, excluded: c.excluded, droppedForMissingSignals: dropped, kappa },
  };

  if (kappa === null) result.reasons.push(`No pair of reviewers labelled at least 10 of the same reps, so agreement can't be checked.`);
  else if (kappa < o.minKappa) result.reasons.push(`Reviewer agreement κ = ${kappa.toFixed(2)} is below ${o.minKappa}: the label isn't consistent enough to learn.`);
  if (subjects < o.minSubjects) result.reasons.push(`Only ${subjects} people with usable consensus labels (need ${o.minSubjects}).`);
  if (positives < o.minPerClass || samples.length - positives < o.minPerClass) {
    result.reasons.push(`Need ${o.minPerClass} reps of each class; have ${positives} yes / ${samples.length - positives} no.`);
  }
  if (result.reasons.length) return result;

  // Leave-one-subject-out.
  const oof: Array<{ p: number; y: number }> = [];
  for (const s of new Set(samples.map((x) => x.subject))) {
    const model = fitLogistic(samples.filter((x) => x.subject !== s), o.l2);
    for (const t of samples.filter((x) => x.subject === s)) oof.push({ p: predict(model, t.x), y: t.y });
  }
  let threshold = 0.5;
  let best = -1;
  for (let thr = 0.3; thr <= 0.9; thr += 0.01) {
    const m = confusion(oof, thr);
    const score = m.precision >= o.minPrecision ? m.f1 + 1 : m.f1;
    if (score > best) {
      best = score;
      threshold = Math.round(thr * 100) / 100;
    }
  }
  const m = confusion(oof, threshold);
  result.heldOut = { auc: auc(oof), precision: m.precision, recall: m.recall, f1: m.f1, threshold };
  result.ruleBaseline = ruleBaseline(kept, exercise, code);
  result.releasable = m.precision >= o.minPrecision && (!result.ruleBaseline || m.f1 > result.ruleBaseline.f1);

  const final = fitLogistic(samples, o.l2);
  result.status = "trained";
  result.model = { featureNames: names, mean: final.mean, std: final.std, weights: final.w, bias: final.b, threshold };
  return result;
}

/**
 * How the app's existing rule does on the same reps: replay each rep's frames
 * through the tracker and see whether it raised a flag with this code. null if
 * the rule never produces this code (no baseline to compare with).
 */
function ruleBaseline(items: ReadonlyArray<{ row: DatasetRep; y: 0 | 1 }>, exercise: ExerciseId, code: string) {
  const scores: Array<{ p: number; y: number }> = [];
  let everRaised = false;
  for (const { row, y } of items) {
    const rec = {
      schema: "jimbro.recording/v1" as const,
      id: row.recordingId,
      createdAt: "",
      subjectId: row.subjectId,
      source: { fileName: "", sha256: row.sourceSha256, bytes: 0, durationSec: 0, width: 1000 * row.aspectRatio, height: 1000, mirrored: row.mirrored },
      extraction: { model: "", mediapipe: "", sampleMs: 0, extractedAt: "" },
      frames: row.frames,
      annotations: [],
    };
    const { session } = replayRecording(rec, exercise);
    const [match] = matchReps({ reps: [{ start: row.rep.start, end: row.rep.end }] }, session.reps);
    const rep = match?.predicted ? session.reps.find((r) => r.repNumber === match.predicted!.repNumber) : undefined;
    const raised = rep?.formFlags.some((f) => f.code === code) ?? false;
    everRaised ||= raised;
    scores.push({ p: raised ? 1 : 0, y });
  }
  if (!everRaised && !knownRuleCode(exercise, code)) return null;
  const m = confusion(scores, 0.5);
  return { precision: m.precision, recall: m.recall, f1: m.f1 };
}

function knownRuleCode(exercise: ExerciseId, code: string): boolean {
  const ex = getExercise(exercise);
  return code in ex.spoken || ["FAST_LOWERING", "UNEVEN_TEMPO", "RANGE_VARIES"].includes(code);
}
