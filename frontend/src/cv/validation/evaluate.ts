/**
 * Compare the app's output on a Recording with a reviewer's Annotation.
 *
 * This is REAL-WORLD accuracy: what the tracker gets right on recorded human
 * movement versus what a person marked. It is separate from the unit tests,
 * which only check the code does what it was designed to do on synthetic
 * input. A green test suite says nothing about these numbers.
 */

import type { RepEvent } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { armsUsed } from "../exercises/bicep_curl";
import { POSE_LANDMARKS as L } from "../pose_detection";
import { ANGLE_JOINTS, toLandmarks, type Annotation, type AngleJoint, type Recording, type View } from "./format";
import { recognizeExercise } from "./recognize";
import { replayRecording, type ReplayResult } from "./replay";

export interface RepMatch {
  annotated: { start: number; end: number };
  predicted: { start: number; end: number; repNumber: number } | null;
}

export interface Evaluation {
  recordingId: string;
  subjectId: string;
  annotationId: string;
  reviewerId: string;
  exercise: string;
  variation: string;
  view: View;
  reps: {
    annotated: number;
    predicted: number;
    /** predicted − annotated */
    countError: number;
    matched: number;
    /** Counted reps with no annotated rep. */
    falsePositives: number;
    /** Annotated reps the app didn't count. */
    missed: number;
    matches: RepMatch[];
  };
  angles: {
    /** Only goniometer / mocap references count as ground truth; on-screen ones are reported separately. */
    groundTruth: AngleErrors;
    onScreen: AngleErrors;
  };
  /** Lunges with annotated front legs. */
  legRoles: { checked: number; correct: number; wrong: number; uncertain: number } | null;
  /** Curls with annotated arms. */
  arms: { checked: number; correct: number } | null;
  recognition: { predicted: string | null; correct: boolean; evidence: Record<string, number> };
  landmarks: {
    frames: number;
    /** No person detected. */
    missing: number;
    /** Counting joints below the visibility threshold (app's own judgement). */
    notVisible: number;
    /** Readings rejected by the glitch filter. */
    glitches: number;
    /** Frames where the left/right knees look swapped vs. the previous frame. */
    suspectedSwaps: number;
  };
  latency: { detectP50: number; detectP95: number; pipelineP50: number; pipelineP95: number };
}

export interface AngleErrors {
  n: number;
  meanAbsError: number | null;
  maxAbsError: number | null;
  perJoint: Partial<Record<AngleJoint, { n: number; meanAbsError: number }>>;
}

const OVERLAP_MIN = 0.3;

/** Evaluate one annotation of a recording. */
export function evaluate(rec: Recording, ann: Annotation, replay?: ReplayResult): Evaluation {
  const r = replay ?? replayRecording(rec, ann.exercise);
  const predicted = r.session.reps;
  const matches = matchReps(ann, predicted);
  const matched = matches.filter((m) => m.predicted).length;
  const swap = (s: "left" | "right") => (rec.source.mirrored ? (s === "left" ? "right" : "left") : s);

  // Front/back legs: majority side the app reported while the matched rep was at depth.
  let legRoles: Evaluation["legRoles"] = null;
  if (ann.exercise === "lunge" && ann.reps.some((x) => x.frontLeg)) {
    legRoles = { checked: 0, correct: 0, wrong: 0, uncertain: 0 };
    ann.reps.forEach((rep, i) => {
      if (!rep.frontLeg) return;
      legRoles!.checked += 1;
      const span = matches[i]!.predicted ?? rep;
      const sides = r.frames
        .filter((f) => f.t >= span.start && f.t <= span.end && f.visible && (f.activeSide === "left" || f.activeSide === "right"))
        .map((f) => swap(f.activeSide as "left" | "right"));
      if (sides.length === 0) legRoles!.uncertain += 1;
      else {
        const left = sides.filter((s) => s === "left").length;
        const guess = left >= sides.length - left ? "left" : "right";
        if (guess === rep.frontLeg) legRoles!.correct += 1;
        else legRoles!.wrong += 1;
      }
    });
  }

  let arms: Evaluation["arms"] = null;
  if (ann.exercise === "bicep_curl" && ann.reps.some((x) => x.arm)) {
    arms = { checked: 0, correct: 0 };
    matches.forEach((m, i) => {
      const want = ann.reps[i]!.arm;
      if (!want) return;
      arms!.checked += 1;
      const ev = m.predicted ? predicted.find((p) => p.repNumber === m.predicted!.repNumber) : undefined;
      const got = ev ? armsUsed(ev) : null;
      const gotPerson = got === "left" || got === "right" ? swap(got) : got;
      if (gotPerson === want) arms!.correct += 1;
    });
  }

  const aspect = rec.source.width / rec.source.height;
  const angleErr = (method: (m: string) => boolean): AngleErrors => {
    const errs: Array<{ joint: AngleJoint; e: number }> = [];
    for (const c of ann.angleChecks.filter((x) => method(x.method))) {
      const frame = nearestFrame(rec, c.t);
      const lm = toLandmarks(frame?.lm ?? null);
      if (!lm) continue;
      // A mirrored video's "left knee" in MediaPipe terms is the person's right.
      const joint = rec.source.mirrored ? mirrorJoint(c.joint) : c.joint;
      const [a, b, cc] = ANGLE_JOINTS[joint];
      const angle = calculateAngle(lm[a]!, lm[b]!, lm[cc]!, aspect);
      if (angle !== null) errs.push({ joint: c.joint, e: Math.abs(angle - c.degrees) });
    }
    const perJoint: AngleErrors["perJoint"] = {};
    for (const j of new Set(errs.map((x) => x.joint))) {
      const js = errs.filter((x) => x.joint === j).map((x) => x.e);
      perJoint[j] = { n: js.length, meanAbsError: mean(js) };
    }
    return {
      n: errs.length,
      meanAbsError: errs.length ? mean(errs.map((x) => x.e)) : null,
      maxAbsError: errs.length ? Math.max(...errs.map((x) => x.e)) : null,
      perJoint,
    };
  };

  const recog = recognizeExercise(rec.frames.map((f) => toLandmarks(f.lm)), aspect);

  return {
    recordingId: rec.id,
    subjectId: rec.subjectId,
    annotationId: ann.id,
    reviewerId: ann.reviewer.id,
    exercise: ann.exercise,
    variation: ann.variation,
    view: ann.view,
    reps: {
      annotated: ann.reps.length,
      predicted: predicted.length,
      countError: predicted.length - ann.reps.length,
      matched,
      falsePositives: predicted.length - matched,
      missed: ann.reps.length - matched,
      matches,
    },
    angles: {
      groundTruth: angleErr((m) => m === "goniometer" || m === "mocap"),
      onScreen: angleErr((m) => m === "on-screen"),
    },
    legRoles,
    arms,
    recognition: { predicted: recog.exercise, correct: recog.exercise === ann.exercise, evidence: recog.evidence },
    landmarks: {
      frames: rec.frames.length,
      missing: rec.frames.filter((f) => !f.lm).length,
      notVisible: r.frames.filter((f) => !f.visible).length,
      glitches: Math.round(r.trackingQuality.glitches * rec.frames.length),
      suspectedSwaps: countKneeSwaps(rec),
    },
    latency: {
      detectP50: percentile(rec.frames.map((f) => f.detectMs), 0.5),
      detectP95: percentile(rec.frames.map((f) => f.detectMs), 0.95),
      pipelineP50: percentile(r.pipelineMs, 0.5),
      pipelineP95: percentile(r.pipelineMs, 0.95),
    },
  };
}

/** Pair annotated and counted reps one-to-one by time overlap (overlap ÷ shorter rep ≥ 30%). */
export function matchReps(ann: Pick<Annotation, "reps">, predicted: readonly RepEvent[]): RepMatch[] {
  const used = new Set<number>();
  return ann.reps.map((a) => {
    let best: RepEvent | null = null;
    let bestOverlap = 0;
    for (const p of predicted) {
      if (used.has(p.repNumber)) continue;
      const overlap = Math.min(a.end, p.endedAt) - Math.max(a.start, p.startedAt);
      const shorter = Math.min(a.end - a.start, p.endedAt - p.startedAt);
      const frac = shorter > 0 ? overlap / shorter : 0;
      if (frac >= OVERLAP_MIN && frac > bestOverlap) {
        best = p;
        bestOverlap = frac;
      }
    }
    if (best) used.add(best.repNumber);
    return {
      annotated: { start: a.start, end: a.end },
      predicted: best ? { start: best.startedAt, end: best.endedAt, repNumber: best.repNumber } : null,
    };
  });
}

/** Frames where the two knees' labels look swapped relative to the previous frame. */
export function countKneeSwaps(rec: Recording): number {
  let swaps = 0;
  for (let i = 1; i < rec.frames.length; i++) {
    const a = rec.frames[i - 1]!.lm;
    const b = rec.frames[i]!.lm;
    if (!a || !b) continue;
    const d = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
    const same = d(b[L.LEFT_KNEE]!, a[L.LEFT_KNEE]!) + d(b[L.RIGHT_KNEE]!, a[L.RIGHT_KNEE]!);
    const crossed = d(b[L.LEFT_KNEE]!, a[L.RIGHT_KNEE]!) + d(b[L.RIGHT_KNEE]!, a[L.LEFT_KNEE]!);
    if (same > 0.05 && crossed < 0.5 * same) swaps += 1;
  }
  return swaps;
}

function nearestFrame(rec: Recording, t: number) {
  let best = rec.frames[0];
  for (const f of rec.frames) if (Math.abs(f.t - t) < Math.abs(best!.t - t)) best = f;
  return best;
}

function mirrorJoint(j: AngleJoint): AngleJoint {
  return (j.startsWith("left") ? j.replace("left", "right") : j.replace("right", "left")) as AngleJoint;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}
