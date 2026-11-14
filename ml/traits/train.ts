/**
 * Train reviewer-labelled technique characteristics from a lab export.
 *
 *   npm --prefix frontend run train:traits -- path/to/jimbro-reps.jsonl
 *
 * For every (exercise, label code) in the file, runs the label-gated trainer
 * (frontend/src/cv/ml/trait_training.ts): it refuses when reviewer agreement,
 * people or examples are insufficient, and otherwise reports
 * leave-one-subject-out results against the app's rule-based flag.
 * Writes ml/data/trait-models/<exercise>__<code>.json (trained only) and
 * ml/data/trait-models/REPORT.md. Nothing is copied into the app: a model is
 * shipped only by a deliberate change after review.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ExerciseId } from "../../shared/types";
import { trainTrait, type TraitResult } from "../../frontend/src/cv/ml/trait_training";
import { DATASET_SCHEMA, parseJsonl, type DatasetRep } from "../../frontend/src/cv/validation/dataset";

const ROOT = `${process.cwd()}/../`;
const OUT = `${ROOT}ml/data/trait-models`;
const input = process.argv[2];
if (!input) {
  console.error("Usage: npm --prefix frontend run train:traits -- <jimbro-reps.jsonl>");
  process.exit(1);
}

const rows = parseJsonl<DatasetRep>(readFileSync(input.startsWith("/") ? input : `${ROOT}${input}`, "utf8"));
const bad = rows.filter((r) => r.schema !== DATASET_SCHEMA);
if (bad.length) {
  console.error(`${bad.length} rows aren't ${DATASET_SCHEMA}; export from the validation lab.`);
  process.exit(1);
}

const pairs = new Set(rows.flatMap((r) => Object.keys(r.labels).map((code) => `${r.exercise}|${code}`)));
mkdirSync(OUT, { recursive: true });
const results: TraitResult[] = [];
for (const pair of [...pairs].sort()) {
  const [exercise, code] = pair.split("|") as [ExerciseId, string];
  const r = trainTrait(rows, exercise, code);
  results.push(r);
  if (r.status === "trained") writeFileSync(`${OUT}/${exercise}__${code}.json`, `${JSON.stringify(r, null, 2)}\n`);
  console.log(`${exercise} / ${code}: ${r.status}${r.reasons.length ? ` (${r.reasons.join(" ")})` : ""}`);
}

const pct = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(1)}%`);
const report = [
  "# Trait training report",
  "",
  `Input: ${rows.length} reps from ${new Set(rows.map((r) => r.subjectId)).size} people. Generated ${new Date().toISOString()}.`,
  "",
  "| Exercise | Label | Status | Usable reps (yes/no) | People | κ | Held-out AUC | Precision | Recall | Rule baseline F1 | Releasable | Why refused |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.exercise} | ${r.code} | ${r.status} | ${r.data.included} (${r.data.positives}/${r.data.negatives}) | ${r.data.subjects} | ${r.data.kappa === null ? "–" : r.data.kappa.toFixed(2)} | ${r.heldOut ? r.heldOut.auc.toFixed(3) : "–"} | ${pct(r.heldOut?.precision)} | ${pct(r.heldOut?.recall)} | ${r.ruleBaseline ? pct(r.ruleBaseline.f1) : "no rule"} | ${r.releasable ? "yes" : "no"} | ${r.reasons.join(" ") || "–"} |`,
  ),
  "",
  "Excluded per label (no label / single reviewer / disagreement) is in each model's JSON and the console output.",
].join("\n");
writeFileSync(`${OUT}/REPORT.md`, `${report}\n`);
console.log(`\nWrote ${OUT}/REPORT.md`);
