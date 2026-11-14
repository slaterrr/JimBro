// Scoring for real-video replay. Rep identity is its completion time (return to rest);
// a prediction matches a labeled rep only once and only within the tolerance.
import { LiveSession } from '../../../apps/expo/src/lib/live.js';

export const TOLERANCE_MS = 600;

/** Greedy one-to-one matching in time order. Returns matched pairs, missed true reps, false predictions. */
export function matchReps(trueEnds, predEnds, tol = TOLERANCE_MS) {
  const used = new Set();
  const matched = [];
  const missed = [];
  for (const t of [...trueEnds].sort((a, b) => a - b)) {
    let best = -1;
    predEnds.forEach((p, i) => {
      if (used.has(i) || Math.abs(p - t) > tol) return;
      if (best < 0 || Math.abs(p - t) < Math.abs(predEnds[best] - t)) best = i;
    });
    if (best < 0) missed.push(t);
    else { used.add(best); matched.push([t, predEnds[best]]); }
  }
  return { matched, missed, false: predEnds.filter((_, i) => !used.has(i)) };
}

const ratio = (a, b) => (b ? a / b : null);

export function scoreClip({ trueEnds, predEnds, tol = TOLERANCE_MS }) {
  const m = matchReps(trueEnds, predEnds, tol);
  const tp = m.matched.length;
  const fp = m.false.length;
  const fn = m.missed.length;
  const timingErr = m.matched.map(([t, p]) => Math.abs(p - t));
  return {
    tp, fp, fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    meanTimingErrMs: timingErr.length ? timingErr.reduce((a, b) => a + b, 0) / timingErr.length : null,
    missed: m.missed, false: m.false,
  };
}

/** Micro-averaged totals per split; adversarial false reps are reported separately. */
export function summarize(rows) {
  const out = {};
  for (const r of rows) {
    const s = (out[r.split] ??= { clips: 0, tp: 0, fp: 0, fn: 0, adversarialFalseReps: 0 });
    s.clips += 1; s.tp += r.tp; s.fp += r.fp; s.fn += r.fn;
    if (r.adversarial) s.adversarialFalseReps += r.fp;
  }
  for (const s of Object.values(out)) {
    s.precision = ratio(s.tp, s.tp + s.fp);
    s.recall = ratio(s.tp, s.tp + s.fn);
  }
  return out;
}

/** Run recorded landmark frames through the exact app pipeline (LiveSession → RepCounter). */
export function replay(movement, frames) {
  const session = new LiveSession(movement);
  const log = [];
  const predEnds = [];
  for (const { t, pose } of frames) {
    const out = session.frame(t, pose);
    if (out.rep) predEnds.push(t);
    log.push({ t, count: out.count, state: out.state, angle: out.angle, tracking: out.tracking.status, issue: out.issue ?? null, hint: out.hint ?? null, rep: Boolean(out.rep) });
  }
  const ok = log.filter((f) => f.tracking === 'ok').length;
  return { predEnds, frames: log, trackingOkRatio: ratio(ok, log.length), reps: session.repsDetail(), suggested: session.suggested ?? null };
}
