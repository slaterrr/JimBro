// Real-video validation: score labeled clips through the app's vision engine API (the same code path
// the app uses), measure landmark reliability, and aggregate per exercise and view. Real and
// simulated results are kept in separate buckets and never combined.
//
// Clip JSON (fixtures/*.landmarks.json, or recordings from record.html):
//   { clip, movement, split: 'dev'|'heldout', adversarial, view?, kind?: 'real'|'sim',
//     source?: provenance URL or 'sim', reps: [{ end_ms }], wrongModes?: [exercise ids],
//     frames: [{ t, pose: [[x, y, visibility] x33] | [{x, y, visibility}] | null }] }
import { analyzerFor, countsWithCamera } from '../../../apps/expo/src/lib/analyzers.js';
import { analyzeRecording } from '../../../apps/expo/src/lib/visionEngine.js';
import { matchReps, TOLERANCE_MS } from './evaluate.mjs';
import { landmarkReliability } from './reliability.mjs';

const toPoint = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], visibility: p[2] } : p);

/** Normalize a raw clip: landmark objects, a real/sim/unknown source, view and split defaults. */
export function loadClip(raw) {
  const kind = raw.kind === 'real' || raw.kind === 'sim' ? raw.kind
    : raw.source === 'sim' ? 'sim'
      : typeof raw.source === 'string' && /^https?:\/\//.test(raw.source) ? 'real'
        : raw.recordedWith ? 'real'
          : 'unknown';
  return {
    clip: raw.clip,
    movement: raw.movement,
    split: raw.split ?? 'dev',
    adversarial: Boolean(raw.adversarial),
    view: raw.view ?? 'unknown',
    source: kind,
    provenance: typeof raw.source === 'string' && raw.source !== 'sim' ? raw.source : null,
    reps: raw.reps ?? [],
    wrongModes: raw.wrongModes ?? [],
    frames: (raw.frames ?? []).map((f) => ({ t: f.t, pose: f.pose ? f.pose.map(toPoint) : null })),
  };
}

const ratio = (a, b) => (b ? Math.round((1000 * a) / b) / 1000 : null);

/** Score one clip. Returns counts, matching, mismatches, wrong-mode false counts and reliability. */
export function validateClip(clip, { tol = TOLERANCE_MS } = {}) {
  const trueEnds = clip.reps.map((r) => r.end_ms);
  const run = analyzeRecording(clip.frames, { exerciseId: clip.movement, sessionId: clip.clip });
  const predEnds = run.events.filter((e) => e.type === 'RepCompleted').map((e) => e.timestamp);
  const m = matchReps(trueEnds, predEnds, tol);
  const timing = m.matched.map(([t, p]) => Math.abs(p - t));
  const wrongMode = clip.wrongModes.filter((mode) => mode !== clip.movement && countsWithCamera(mode)).map((mode) => {
    const r = analyzeRecording(clip.frames, { exerciseId: mode, sessionId: `${clip.clip}-${mode}` });
    return { mode, falseCounts: r.count, mismatchEvents: r.events.filter((e) => e.type === 'ExerciseMismatch').length };
  });
  return {
    clip: clip.clip, movement: clip.movement, source: clip.source, view: clip.view, split: clip.split,
    adversarial: clip.adversarial, validation: analyzerFor(clip.movement)?.status ?? 'unknown',
    labeled: trueEnds.length, counted: run.count,
    tp: m.matched.length, fp: m.false.length, fn: m.missed.length,
    countError: Math.abs(run.count - trueEnds.length),
    meanTimingErrMs: timing.length ? Math.round(timing.reduce((a, b) => a + b, 0) / timing.length) : null,
    mismatches: run.events.filter((e) => e.type === 'ExerciseMismatch').map((e) => e.data.observed),
    rejected: run.events.filter((e) => e.type === 'RepRejected').length,
    wrongMode,
    reliability: landmarkReliability(clip.frames, clip.movement),
  };
}

function totals(rows) {
  const t = { clips: rows.length, labeled: 0, counted: 0, tp: 0, fp: 0, fn: 0, adversarialFalse: 0, absCountError: 0, wrongModeRuns: 0, wrongModeFalse: 0 };
  for (const r of rows) {
    t.labeled += r.labeled; t.counted += r.counted; t.tp += r.tp; t.fp += r.fp; t.fn += r.fn;
    t.absCountError += r.countError;
    if (r.adversarial) t.adversarialFalse += r.fp;
    t.wrongModeRuns += r.wrongMode.length;
    t.wrongModeFalse += r.wrongMode.reduce((a, w) => a + w.falseCounts, 0);
  }
  return {
    ...t,
    precision: ratio(t.tp, t.tp + t.fp), recall: ratio(t.tp, t.tp + t.fn),
    meanAbsCountError: ratio(t.absCountError, t.clips),
    meanTrackedPct: rows.length ? Math.round(rows.reduce((a, r) => a + (r.reliability.trackedPct ?? 0), 0) / rows.length) : null,
  };
}

const group = (rows, key) => rows.reduce((g, r) => ((g[key(r)] ??= []).push(r), g), {});

/** Per exercise and per exercise/view, in separate real / sim / unknown buckets. */
export function aggregate(rows) {
  const out = { real: {}, sim: {}, unknown: {}, byView: { real: {}, sim: {}, unknown: {} } };
  for (const [src, list] of Object.entries(group(rows, (r) => r.source))) {
    for (const [mv, l] of Object.entries(group(list, (r) => r.movement))) out[src][mv] = totals(l);
    for (const [k, l] of Object.entries(group(list, (r) => `${r.movement}/${r.view}`))) out.byView[src][k] = totals(l);
  }
  return out;
}
