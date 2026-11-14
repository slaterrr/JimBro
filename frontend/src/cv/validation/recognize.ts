/**
 * Experimental exercise recognition from landmarks alone, so recognition
 * accuracy can be *measured* on annotated recordings. The app doesn't use it
 * (the user picks the exercise); it exists to find out whether automatic
 * recognition would be good enough.
 *
 * Rules over the whole clip, from which joints move and how the body is placed:
 *   torso mostly horizontal → push-up
 *   elbows move, legs don't → press if the hands go well above the shoulders, else curl
 *   legs move → lunge if the feet split apart, deadlift if the hips move much
 *               more than the knees, else squat
 */

import type { ExerciseId } from "../../../../shared/types";
import { calculateAngle } from "../angle_calculator";
import { POSE_LANDMARKS as L, vis, type LandmarkLike } from "../pose_detection";

export interface Recognition {
  exercise: ExerciseId | null;
  /** The measurements the rules used, for auditing. */
  evidence: Record<string, number>;
}

const range = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
const p90 = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
};

export function recognizeExercise(frames: readonly (readonly LandmarkLike[] | undefined)[], aspectRatio: number): Recognition {
  const knee: number[] = [];
  const hip: number[] = [];
  const elbow: number[] = [];
  const handsUp: number[] = [];
  const split: number[] = [];
  let horizontal = 0;
  let seen = 0;

  for (const lm of frames) {
    if (!lm || lm.length < 33) continue;
    const ok = (...i: number[]) => i.every((k) => vis(lm[k]) >= 0.5);
    const best = (a: number[], b: number[]) => (ok(...a) ? a : ok(...b) ? b : null);
    seen += 1;

    const k = best([L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE], [L.RIGHT_HIP, L.RIGHT_KNEE, L.RIGHT_ANKLE]);
    if (k) {
      const a = calculateAngle(lm[k[0]!]!, lm[k[1]!]!, lm[k[2]!]!, aspectRatio);
      if (a !== null) knee.push(a);
    }
    const h = best([L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE], [L.RIGHT_SHOULDER, L.RIGHT_HIP, L.RIGHT_KNEE]);
    if (h) {
      const a = calculateAngle(lm[h[0]!]!, lm[h[1]!]!, lm[h[2]!]!, aspectRatio);
      if (a !== null) hip.push(a);
    }
    const e = best([L.LEFT_SHOULDER, L.LEFT_ELBOW, L.LEFT_WRIST], [L.RIGHT_SHOULDER, L.RIGHT_ELBOW, L.RIGHT_WRIST]);
    if (e) {
      const a = calculateAngle(lm[e[0]!]!, lm[e[1]!]!, lm[e[2]!]!, aspectRatio);
      if (a !== null) elbow.push(a);
      const sh = lm[e[0]!]!;
      const wr = lm[e[2]!]!;
      const el = lm[e[1]!]!;
      const arm = Math.hypot((sh.x - el.x) * aspectRatio, sh.y - el.y) + Math.hypot((el.x - wr.x) * aspectRatio, el.y - wr.y);
      if (arm > 1e-6) handsUp.push((sh.y - wr.y) / arm);
    }
    if (ok(L.LEFT_ANKLE, L.RIGHT_ANKLE, L.LEFT_HIP, L.LEFT_KNEE)) {
      const leg = Math.hypot((lm[L.LEFT_HIP]!.x - lm[L.LEFT_ANKLE]!.x) * aspectRatio, lm[L.LEFT_HIP]!.y - lm[L.LEFT_ANKLE]!.y);
      if (leg > 1e-6) split.push((Math.abs(lm[L.LEFT_ANKLE]!.x - lm[L.RIGHT_ANKLE]!.x) * aspectRatio) / leg);
    }
    const s = lm[L.LEFT_SHOULDER]!;
    const a = lm[L.LEFT_ANKLE]!;
    if (ok(L.LEFT_SHOULDER, L.LEFT_ANKLE) && Math.abs(a.y - s.y) < Math.abs((a.x - s.x) * aspectRatio)) horizontal += 1;
  }

  const evidence = {
    framesSeen: seen,
    horizontalFraction: seen ? horizontal / seen : 0,
    kneeRange: range(knee),
    hipRange: range(hip),
    elbowRange: range(elbow),
    handsUpP90: p90(handsUp),
    splitP90: p90(split),
  };
  if (seen < 10) return { exercise: null, evidence };

  let exercise: ExerciseId | null = null;
  if (evidence.horizontalFraction > 0.6) exercise = "pushup";
  else if (evidence.elbowRange >= 50 && evidence.kneeRange < 30) exercise = evidence.handsUpP90 > 0.6 ? "shoulder_press" : "bicep_curl";
  else if (evidence.kneeRange >= 30 || evidence.hipRange >= 40) {
    if (evidence.splitP90 > 0.45) exercise = "lunge";
    else if (evidence.hipRange > evidence.kneeRange + 25) exercise = "deadlift";
    else exercise = "squat";
  }
  return { exercise, evidence };
}
