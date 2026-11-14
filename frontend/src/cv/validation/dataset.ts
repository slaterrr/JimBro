/**
 * Export annotated recordings as a training-ready dataset (JSON Lines).
 *
 * One line per rep. A rep's boundaries come from the first reviewer who
 * marked it; other reviewers' labels are attached to the same rep when their
 * rep overlaps it (≥ 50% of the shorter one). Every label keeps its reviewer,
 * so agreement can be measured and audited later. Nothing is merged or
 * resolved here: consensus is the training pipeline's job, with explicit rules.
 */

import type { Annotation, Recording, RecordingFrame, RepAnnotation } from "./format";

export const DATASET_SCHEMA = "jimbro.rep-dataset/v1";

export interface DatasetRep {
  schema: typeof DATASET_SCHEMA;
  recordingId: string;
  subjectId: string;
  /** For auditing: the source video's hash. */
  sourceSha256: string;
  mirrored: boolean;
  aspectRatio: number;
  exercise: string;
  variation: string;
  view: string;
  rep: { index: number; start: number; end: number; frontLeg?: string; arm?: string };
  /** Frames from 1 s before the rep to 0.5 s after (for context). */
  frames: RecordingFrame[];
  /** labels[code][reviewerId] = "yes" | "no" | "unsure" */
  labels: Record<string, Record<string, "yes" | "no" | "unsure">>;
  /** Every reviewer who marked this rep, whether or not they labelled traits. */
  reviewers: string[];
}

const OVERLAP = 0.5;

function overlaps(a: RepAnnotation, b: RepAnnotation): boolean {
  const o = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return o > 0 && o / Math.min(a.end - a.start, b.end - b.start) >= OVERLAP;
}

export function exportDataset(recordings: readonly Recording[]): DatasetRep[] {
  const out: DatasetRep[] = [];
  for (const rec of recordings) {
    // Group annotations by exercise + variation + view (a recording could hold more than one set).
    const byKey = new Map<string, Annotation[]>();
    for (const a of rec.annotations) {
      const k = `${a.exercise}|${a.variation}|${a.view}`;
      byKey.set(k, [...(byKey.get(k) ?? []), a]);
    }
    for (const anns of byKey.values()) {
      const primary = anns[0]!;
      primary.reps.forEach((rep, index) => {
        const labels: DatasetRep["labels"] = {};
        const reviewers: string[] = [];
        for (const a of anns) {
          const i = a === primary ? index : a.reps.findIndex((r) => overlaps(r, rep));
          if (i === -1) continue;
          reviewers.push(a.reviewer.id);
          for (const t of a.traits) {
            if (t.rep !== i && t.rep !== null) continue;
            (labels[t.code] ??= {})[a.reviewer.id] = t.value;
          }
        }
        out.push({
          schema: DATASET_SCHEMA,
          recordingId: rec.id,
          subjectId: rec.subjectId,
          sourceSha256: rec.source.sha256,
          mirrored: rec.source.mirrored,
          aspectRatio: rec.source.width / rec.source.height,
          exercise: primary.exercise,
          variation: primary.variation,
          view: primary.view,
          rep: { index, start: rep.start, end: rep.end, frontLeg: rep.frontLeg, arm: rep.arm },
          frames: rec.frames.filter((f) => f.t >= rep.start - 1000 && f.t <= rep.end + 500),
          labels,
          reviewers: [...new Set(reviewers)],
        });
      });
    }
  }
  return out;
}

export const toJsonl = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

export function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}
