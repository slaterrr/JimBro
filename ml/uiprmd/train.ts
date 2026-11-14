/**
 * Train Jim Bro's squat movement-quality model on UI-PRMD (public domain, PDDL 1.0).
 *
 *   npm --prefix frontend run train:uiprmd
 *
 * Reads the Vicon positions for movement 1 (deep squat), correct and
 * incorrect, from ml/data/uiprmd/extracted/. Each rep is turned into what the
 * phone would see: a side view (with a random camera yaw), downsampled to
 * ~33 fps, with landmark noise, then run through the app's own SignalFilter
 * and repFeatures(). A standardised L2 logistic regression is evaluated
 * leave-one-subject-out, then trained on everyone and written to
 * frontend/src/cv/ml/models/squat_uiprmd.json with a report in ml/uiprmd/REPORT.md.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { FEATURE_NAMES, repFeatures, type RepFrame } from "../../frontend/src/cv/ml/rep_features";
import type { QualityModelJson } from "../../frontend/src/cv/ml/quality_model";
import { ANGLE_FILTER, POSITION_FILTER, SignalFilter } from "../../frontend/src/cv/signal_filter";

// Run from frontend/ (npm --prefix frontend run train:uiprmd), so the repo root is one up.
const ROOT = `${process.cwd()}/../`;
const DATA = `${ROOT}ml/data/uiprmd/extracted`;
const MODEL_OUT = `${ROOT}frontend/src/cv/ml/models/squat_uiprmd.json`;
const REPORT_OUT = `${ROOT}ml/uiprmd/REPORT.md`;

// ---- data ------------------------------------------------------------------

/**
 * Vicon Plug-in Gait marker order (39 markers), identified from the geometry
 * of the data: 9/16 shoulders (LSHO/RSHO), 23/24 front hip bones (LASI/RASI),
 * 25/26 back hip bones (LPSI/RPSI), 28/34 knees (LKNE/RKNE), 30/36 ankles
 * (LANK/RANK). Units mm; x forward (subjects face +x), y left, z up.
 */
const MARKERS = {
  left: { sho: 9, asi: 23, psi: 25, kne: 28, ank: 30 },
  right: { sho: 16, asi: 24, psi: 26, kne: 34, ank: 36 },
} as const;
type Side = keyof typeof MARKERS;
type V3 = [number, number, number];

const VICON_HZ = 100;
const STEP = 3; // 100 Hz → ~33 Hz, like a phone camera

interface Rep {
  subject: number;
  episode: number;
  incorrect: boolean;
  frames: V3[][];
}

function loadReps(): Rep[] {
  const reps: Rep[] = [];
  const sets: Array<[string, boolean]> = [
    [`${DATA}/Segmented Movements/Vicon/Positions`, false],
    [`${DATA}/Incorrect Segmented Movements/Vicon/Positions`, true],
  ];
  for (const [dir, incorrect] of sets) {
    for (const name of readdirSync(dir).sort()) {
      const m = /^m01_s(\d+)_e(\d+)_positions(_inc)?\.txt$/.exec(name);
      if (!m) continue;
      const frames = readFileSync(`${dir}/${name}`, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => {
          const v = l.split(",").map(Number);
          return Array.from({ length: 39 }, (_, j) => [v[3 * j]!, v[3 * j + 1]!, v[3 * j + 2]!] as V3);
        });
      reps.push({ subject: Number(m[1]), episode: Number(m[2]), incorrect, frames });
    }
  }
  return reps;
}

// ---- simulate the phone pipeline --------------------------------------------

/** Seeded PRNG so results are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  return { next, gauss };
}

interface Variant {
  side: Side;
  /** Camera yaw away from a perfect side view, degrees. */
  yawDeg: number;
  /** Landmark noise, as a fraction of leg length. */
  noise: number;
}

const angle2 = (a: number[], b: number[], c: number[]) => {
  const v1 = [a[0]! - b[0]!, a[1]! - b[1]!];
  const v2 = [c[0]! - b[0]!, c[1]! - b[1]!];
  const n = Math.hypot(v1[0]!, v1[1]!) * Math.hypot(v2[0]!, v2[1]!);
  if (n < 1e-9) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (v1[0]! * v2[0]! + v1[1]! * v2[1]!) / n))) * 180) / Math.PI;
};

function toRepFrames(rep: Rep, v: Variant, r: ReturnType<typeof rng>): RepFrame[] {
  const k = MARKERS[v.side];
  const yaw = (v.yawDeg * Math.PI) / 180;
  const fwd = [Math.cos(yaw), Math.sin(yaw)];
  // Side view: horizontal = position along the camera's view-plane axis, vertical = z.
  const project = (p: V3): [number, number] => [p[0] * fwd[0]! + p[1] * fwd[1]!, p[2]];

  const hipCentre = (f: V3[]): V3 => {
    const a = f[k.asi]!;
    const p = f[k.psi]!;
    const mid: V3 = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2, (a[2] + p[2]) / 2];
    // The hip joint (and MediaPipe's hip point) sits below the pelvis markers.
    const depth = Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]);
    return [mid[0], mid[1], mid[2] - 0.5 * depth];
  };

  const f0 = rep.frames[0]!;
  const legLen = Math.hypot(...(project(hipCentre(f0)).map((x, i) => x - project(f0[k.ank]!)[i]!) as [number, number]));
  const sd = v.noise * legLen;
  const jitter = (p: [number, number]): [number, number] => [p[0] + r.gauss() * sd, p[1] + r.gauss() * sd];

  const kneeF = new SignalFilter(ANGLE_FILTER);
  const hipF = new SignalFilter({ ...ANGLE_FILTER, maxRatePerSec: Infinity });
  const leanF = new SignalFilter({ ...ANGLE_FILTER, maxRatePerSec: Infinity });
  const yF = new SignalFilter(POSITION_FILTER);

  const out: RepFrame[] = [];
  let baseY: number | null = null;
  for (let i = 0; i < rep.frames.length; i += STEP) {
    const f = rep.frames[i]!;
    const t = (i * 1000) / VICON_HZ;
    const sho = jitter(project(f[k.sho]!));
    const hip = jitter(project(hipCentre(f)));
    const kne = jitter(project(f[k.kne]!));
    const ank = jitter(project(f[k.ank]!));
    const knee = kneeF.next(angle2(hip, kne, ank), t);
    const hipA = hipF.next(angle2(sho, hip, kne), t);
    const lean = leanF.next(Math.abs((Math.atan2(sho[0] - hip[0], sho[1] - hip[1]) * 180) / Math.PI), t);
    const y = yF.next(hip[1], t);
    // Drop baseline from the first frames (standing), like the app's start position.
    if (baseY === null && y !== null) baseY = y;
    const drop = y === null || baseY === null ? null : (baseY - y) / legLen;
    out.push({ t, knee, hip: hipA, lean, drop });
  }
  return out;
}

// ---- model ------------------------------------------------------------------

interface Sample {
  x: number[];
  y: 0 | 1;
  subject: number;
}

interface Fitted {
  mean: number[];
  std: number[];
  w: number[];
  b: number;
}

function fitLogistic(samples: readonly Sample[], l2: number, iters = 3000, lr = 0.2): Fitted {
  const d = samples[0]!.x.length;
  const mean = Array.from({ length: d }, (_, j) => samples.reduce((s, p) => s + p.x[j]!, 0) / samples.length);
  const std = Array.from({ length: d }, (_, j) =>
    Math.sqrt(samples.reduce((s, p) => s + (p.x[j]! - mean[j]!) ** 2, 0) / samples.length) || 1,
  );
  const X = samples.map((p) => p.x.map((v, j) => (v - mean[j]!) / std[j]!));
  const w = new Array<number>(d).fill(0);
  let b = 0;
  // Balance the classes.
  const pos = samples.filter((s) => s.y === 1).length;
  const wPos = samples.length / (2 * pos);
  const wNeg = samples.length / (2 * (samples.length - pos));
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * xi[j]!;
      const p = 1 / (1 + Math.exp(-z));
      const yi = samples[i]!.y;
      const err = (p - yi) * (yi === 1 ? wPos : wNeg);
      for (let j = 0; j < d; j++) gw[j]! += err * xi[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] = w[j]! - lr * (gw[j]! / X.length + l2 * w[j]!);
    b -= lr * (gb / X.length);
  }
  return { mean, std, w, b };
}

function predict(m: Fitted, x: readonly number[]): number {
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += m.w[j]! * ((x[j]! - m.mean[j]!) / m.std[j]!);
  return 1 / (1 + Math.exp(-z));
}

function auc(scores: readonly { p: number; y: number }[]): number {
  const pos = scores.filter((s) => s.y === 1);
  const neg = scores.filter((s) => s.y === 0);
  let wins = 0;
  for (const a of pos) for (const n of neg) wins += a.p > n.p ? 1 : a.p === n.p ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function confusion(scores: readonly { p: number; y: number }[], thr: number) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const s of scores) {
    const pred = s.p >= thr;
    if (pred && s.y === 1) tp++;
    else if (pred) fp++;
    else if (s.y === 1) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, tn, fn, precision, recall, f1, accuracy: (tp + tn) / scores.length };
}

// ---- main -------------------------------------------------------------------

const L2 = 0.05; // fixed in advance, not tuned on the evaluation
const TRAIN_VARIANTS = 6;

function samplesFor(reps: readonly Rep[], variants: (r: ReturnType<typeof rng>) => Variant[], seed: number): Sample[] {
  const r = rng(seed);
  const out: Sample[] = [];
  for (const rep of reps) {
    for (const v of variants(r)) {
      const x = repFeatures(toRepFrames(rep, v, r));
      if (x) out.push({ x, y: rep.incorrect ? 1 : 0, subject: rep.subject });
    }
  }
  return out;
}

const trainVariants = (r: ReturnType<typeof rng>): Variant[] =>
  Array.from({ length: TRAIN_VARIANTS }, (_, i) => ({
    side: i % 2 ? "left" : "right",
    yawDeg: (r.next() * 2 - 1) * 20,
    noise: 0.005 + r.next() * 0.015,
  }));
const testVariants = (yaw: number, noise: number) => (r: ReturnType<typeof rng>): Variant[] => [
  { side: "left", yawDeg: (r.next() * 2 - 1) * yaw, noise },
  { side: "right", yawDeg: (r.next() * 2 - 1) * yaw, noise },
];

const reps = loadReps();
const subjects = [...new Set(reps.map((r) => r.subject))].sort((a, b) => a - b);
console.log(`Loaded ${reps.length} reps (${reps.filter((r) => r.incorrect).length} incorrect) from ${subjects.length} subjects.`);

const conditions = [
  { name: "typical (yaw ±15°, noise 1%)", yaw: 15, noise: 0.01 },
  { name: "hard (yaw ±30°, noise 2.5%)", yaw: 30, noise: 0.025 },
];
const oof: Record<string, { p: number; y: number; subject: number; x: number[] }[]> = {};
for (const c of conditions) oof[c.name] = [];
let skipped = 0;

for (const s of subjects) {
  const train = samplesFor(reps.filter((r) => r.subject !== s), trainVariants, 1000 + s);
  const model = fitLogistic(train, L2);
  for (const c of conditions) {
    const test = samplesFor(reps.filter((r) => r.subject === s), testVariants(c.yaw, c.noise), 2000 + s);
    skipped += reps.filter((r) => r.subject === s).length * 2 - test.length;
    for (const t of test) oof[c.name]!.push({ p: predict(model, t.x), y: t.y, subject: s, x: t.x });
  }
  console.log(`  held out subject ${s}: trained on ${train.length} samples`);
}

// Threshold: highest-F1 threshold with precision ≥ 0.85 on the typical condition's
// out-of-fold scores (else best F1). Reported metrics at that threshold are
// therefore slightly optimistic; the AUC is not affected.
const typical = oof[conditions[0]!.name]!;
let threshold = 0.5;
let best = -1;
for (let thr = 0.3; thr <= 0.9; thr += 0.01) {
  const m = confusion(typical, thr);
  const score = m.precision >= 0.85 ? m.f1 + 1 : m.f1;
  if (score > best) {
    best = score;
    threshold = Math.round(thr * 100) / 100;
  }
}

const results = conditions.map((c) => {
  const sc = oof[c.name]!;
  const perSubject = subjects.map((s) => confusion(sc.filter((x) => x.subject === s), threshold).accuracy);
  return {
    condition: c.name,
    n: sc.length,
    auc: auc(sc),
    at05: confusion(sc, 0.5),
    atThr: confusion(sc, threshold),
    perSubject,
  };
});

// Final model on everyone.
const all = samplesFor(reps, trainVariants, 42);
const final = fitLogistic(all, L2);
const typ = results[0]!;
const spec: QualityModelJson = {
  name: "squat_uiprmd_v1",
  positiveMeaning: "Movement resembles UI-PRMD's deliberately incorrect deep squats",
  featureNames: [...FEATURE_NAMES],
  mean: final.mean.map(r6),
  std: final.std.map(r6),
  weights: final.w.map(r6),
  bias: r6(final.b),
  threshold,
  evaluation: {
    subjects: subjects.length,
    auc: r3(typ.auc),
    precision: r3(typ.atThr.precision),
    recall: r3(typ.atThr.recall),
    f1: r3(typ.atThr.f1),
    accuracy: r3(typ.atThr.accuracy),
    hardConditionAuc: r3(results[1]!.auc),
  },
  trainedOn: "UI-PRMD movement 1 (deep squat), Vicon positions, side-view projection; PDDL 1.0",
  trainedAt: new Date().toISOString().slice(0, 10),
};
mkdirSync(MODEL_OUT.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(MODEL_OUT, `${JSON.stringify(spec, null, 2)}\n`);

// Most influential features (standardised weights).
const top = final.w
  .map((w, i) => ({ name: FEATURE_NAMES[i]!, w }))
  .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
  .slice(0, 8);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Domain-gap probe: synthetic side-view gym squats at different depths, scored
// by the final model. UI-PRMD's correct squats are very deep overhead squats.
function syntheticSquat(bottom: number, drop: number, lean: number): RepFrame[] {
  const f: RepFrame[] = [];
  for (let t = 0; t <= 3400; t += 33) {
    const ph = Math.min(1, Math.max(0, (t - 500) / 2400));
    const d = (1 - Math.cos(ph * 2 * Math.PI)) / 2;
    f.push({ t, knee: 175 - (175 - bottom) * d, hip: 172 - (172 - (bottom - 10)) * d, lean: 5 + (lean - 5) * d, drop: drop * d });
  }
  return f;
}
const probes = [
  { label: "very deep (knee 55°, hips 60%, lean 25°)", b: 55, d: 0.6, l: 25 },
  { label: "below parallel (knee 70°, hips 50%, lean 30°)", b: 70, d: 0.5, l: 30 },
  { label: "parallel, app's minimum depth (knee 80°, hips 42%, lean 35°)", b: 80, d: 0.42, l: 35 },
  { label: "parallel, forward lean (knee 80°, hips 42%, lean 50°)", b: 80, d: 0.42, l: 50 },
].map((p) => ({ ...p, score: predict(final, repFeatures(syntheticSquat(p.b, p.d, p.l))!) }));

// Is the model more than a depth check? Compare with single-feature baselines,
// and score only reps deep enough that the app's squat counter would count them
// (knee ≤ 85°, hips dropped ≥ 40% of leg length), where depth can't explain it.
const fi = (n: string) => FEATURE_NAMES.indexOf(n);
const baseline = (name: string, sign: 1 | -1) => auc(typical.map((t) => ({ p: sign * t.x[fi(name)]!, y: t.y })));
const baselines = [
  { name: "hip drop only (shallower = incorrect)", auc: baseline("drop_max", -1) },
  { name: "knee angle only (less bent = incorrect)", auc: baseline("knee_min", 1) },
];
const counted = typical.filter((t) => t.x[fi("knee_min")]! * 180 <= 85 && t.x[fi("drop_max")]! >= 0.4);
const countedPos = counted.filter((t) => t.y === 1).length;
const countedAuc = countedPos > 0 && countedPos < counted.length ? auc(counted) : NaN;
const countedAt = confusion(counted, threshold);
const report = `# UI-PRMD squat movement-quality model: evaluation

Generated by \`ml/uiprmd/train.ts\` on ${spec.trainedAt}. Re-run to reproduce (seeded).

## Data

- UI-PRMD movement 1, deep squat (FMS-style, dowel held overhead), Vicon
  positions. ${reps.length} reps from ${subjects.length} healthy subjects:
  ${reps.filter((r) => !r.incorrect).length} correct, ${reps.filter((r) => r.incorrect).length} deliberately incorrect.
  Licence: Open Data Commons PDDL 1.0 (public domain).
- Labels are **correct vs. incorrect only**: the dataset doesn't say what was
  wrong with each incorrect rep, so neither can this model.
- Each rep is converted to what a phone would see: side view with a random
  camera yaw, ~33 fps, landmark noise, then the app's own \`SignalFilter\` and
  \`repFeatures()\` (knee angle, hip angle, torso lean, hip drop; ${FEATURE_NAMES.length} features).
  Training uses ${TRAIN_VARIANTS} variants per rep (both sides, yaw ±20°, noise 0.5–2% of leg length).

## Method

Standardised logistic regression, L2 = ${L2} (fixed in advance), balanced class
weights. **Leave-one-subject-out**: each subject is scored by a model that never
saw them. ${skipped} test samples were skipped because repFeatures() found too
little usable movement.

## Results (held-out subjects)

Decision threshold: **${threshold}** (picked on the typical condition's
out-of-fold scores, aiming for precision ≥ 85%; metrics at this threshold are
slightly optimistic, AUC is not).

| Condition | Samples | AUC | Precision | Recall | F1 | Accuracy | At 0.5: precision / recall |
|---|---|---|---|---|---|---|---|
${results
  .map(
    (r) =>
      `| ${r.condition} | ${r.n} | ${r.auc.toFixed(3)} | ${pct(r.atThr.precision)} | ${pct(r.atThr.recall)} | ${pct(r.atThr.f1)} | ${pct(r.atThr.accuracy)} | ${pct(r.at05.precision)} / ${pct(r.at05.recall)} |`,
  )
  .join("\n")}

Confusion matrix, typical condition (positive = incorrect):

| | Predicted incorrect | Predicted correct |
|---|---|---|
| Actually incorrect | ${typ.atThr.tp} | ${typ.atThr.fn} |
| Actually correct | ${typ.atThr.fp} | ${typ.atThr.tn} |

Accuracy per held-out subject (typical): ${typ.perSubject.map((a, i) => `s${subjects[i]} ${pct(a)}`).join(", ")}.

### Is it more than a depth check?

| Scorer (typical condition, held-out) | AUC |
|---|---|
| This model | ${typ.auc.toFixed(3)} |
${baselines.map((b) => `| ${b.name} | ${b.auc.toFixed(3)} |`).join("\n")}

Only reps deep enough for the app to count (knee ≤ 85°, hip drop ≥ 40%):
${counted.length} of ${typical.length} samples, ${countedPos} of them incorrect. Model AUC on
these: **${Number.isNaN(countedAuc) ? "n/a" : countedAuc.toFixed(3)}**; at the threshold it flags
${countedAt.tp + countedAt.fp} (${countedAt.tp} truly incorrect, ${countedAt.fp} correct).

Most influential features (standardised weight; positive pushes toward "incorrect"):
${top.map((t) => `- \`${t.name}\`: ${t.w >= 0 ? "+" : ""}${t.w.toFixed(2)}`).join("\n")}

## Domain gap: why the app records this score but doesn't give feedback from it

Synthetic side-view gym squats scored by the final model (threshold ${threshold}):

${probes.map((p) => `- ${p.label}: **${pct(p.score)}**`).join("\n")}

A parallel squat at the depth the app already requires scores as "incorrect",
because the dataset's correct squats are much deeper overhead squats. Shown to
users, this would mislabel ordinary good reps. So in the app the model's score
is recorded on each rep (\`RepEvent.movementQuality\`, estimated) and shown on
the test page as experimental, but \`raiseFlag\` is off: no on-screen or spoken
feedback until it's recalibrated on labelled gym recordings.

## What this does and doesn't show

- It shows the features separate this dataset's correct and incorrect deep
  squats for people the model hasn't seen, under simulated phone conditions.
- It does **not** show accuracy on real phone video, on gym squats with load,
  or on everyday mistakes: UI-PRMD's errors were acted by 10 healthy people,
  its squats are overhead-dowel deep squats, and the "camera" is simulated
  from motion capture. Treat the in-app score as estimated, and validate on
  labelled phone recordings before relying on it.
`;
writeFileSync(REPORT_OUT, report);
console.log(report);

function r6(x: number) {
  return Math.round(x * 1e6) / 1e6;
}
function r3(x: number) {
  return Math.round(x * 1000) / 1000;
}
