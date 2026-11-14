/**
 * Front/back leg identification for split-stance exercises (lunges), side view.
 *
 * Why not just pick a knee: in a side view the leg with the most confident
 * landmarks is simply the one nearest the camera, which can be the front OR
 * the back leg and changes between alternating reps. And image-left isn't
 * "front": that depends on which way the user faces.
 *
 * How roles are decided, each frame:
 *  1. Both legs must be visible (hip, knee, ankle), or the result is
 *     "uncertain". There's no guessing from one leg.
 *  2. Joints are re-paired into legs by bone length. MediaPipe sometimes swaps
 *     the left/right labels of a knee or ankle in side views; the pairing whose
 *     thigh and shin lengths best match each leg's standing lengths wins.
 *  3. Facing direction comes from votes: each foot's heel→toe direction and
 *     the nose relative to the shoulders, smoothed over frames. Without a clear
 *     facing direction, "front" is meaningless and the result is uncertain.
 *  4. Feet closer than `minSplit` leg lengths apart = "together" (standing or
 *     stepping): no roles. Once split, the leg whose ankle is further in the
 *     facing direction is the front leg, and that assignment is **locked** and
 *     followed by ankle position (not label) until the feet come together
 *     again, so a label swap mid-rep can't flip the roles. Each new rep of an
 *     alternating lunge gets a fresh decision.
 */

import { calculateAngle } from "./angle_calculator";
import { POSE_LANDMARKS as L, distance, vis, type BodySide, type LandmarkLike } from "./pose_detection";

export interface LegChain {
  /** MediaPipe label of the knee in this chain (after re-pairing). */
  label: BodySide;
  hip: LandmarkLike;
  knee: LandmarkLike;
  ankle: LandmarkLike;
  kneeAngle: number;
  /** Landmark indices, for highlighting. */
  indices: readonly number[];
}

export type LegRoles =
  | { status: "together"; legs: [LegChain, LegChain]; split: number }
  | { status: "split"; front: LegChain; back: LegChain; split: number; facing: 1 | -1 }
  | { status: "uncertain"; reason: string };

export interface LegRoleOptions {
  minVisibility: number;
  aspectRatio: number;
  /** Ankle gap (fraction of leg length) above which the stance counts as split. */
  minSplit: number;
  /** Facing votes must agree at least this much (0–1, smoothed) to be trusted. */
  minFacingConfidence: number;
}

export const DEFAULT_LEG_ROLE_OPTIONS: Readonly<Omit<LegRoleOptions, "minVisibility" | "aspectRatio">> = Object.freeze({
  minSplit: 0.3,
  minFacingConfidence: 0.4,
});

const IDX = {
  left: { hip: L.LEFT_HIP, knee: L.LEFT_KNEE, ankle: L.LEFT_ANKLE, heel: L.LEFT_HEEL, toe: L.LEFT_FOOT_INDEX },
  right: { hip: L.RIGHT_HIP, knee: L.RIGHT_KNEE, ankle: L.RIGHT_ANKLE, heel: L.RIGHT_HEEL, toe: L.RIGHT_FOOT_INDEX },
} as const;

/** Far-side joints are often a little less confident; accept a bit lower. */
const FAR_LEG_VIS_FACTOR = 0.8;

export class LegRoleTracker {
  private facingScore = 0;
  private facingSeen = false;
  private bones: Record<BodySide, { thigh: number; shin: number } | null> = { left: null, right: null };
  /** Ankle position (x, aspect-corrected) of the locked front leg, while split. */
  private lockedFrontX: number | null = null;
  private lockedFacing: 1 | -1 | null = null;

  update(landmarks: readonly LandmarkLike[] | undefined, opts: Partial<LegRoleOptions> & Pick<LegRoleOptions, "minVisibility" | "aspectRatio">): LegRoles {
    const o = { ...DEFAULT_LEG_ROLE_OPTIONS, ...opts };
    if (!landmarks || landmarks.length < 33) return this.uncertain("No body detected.");
    const ar = o.aspectRatio;
    const minVis = o.minVisibility * FAR_LEG_VIS_FACTOR;

    for (const side of ["left", "right"] as const) {
      const i = IDX[side];
      if ([i.hip, i.knee, i.ankle].some((k) => vis(landmarks[k]) < minVis)) {
        return this.uncertain("Both legs need to be in view to tell which one is in front.");
      }
    }

    const legs = this.pairLegs(landmarks, ar);
    if (!legs) return this.uncertain("Couldn't read the knee angles.");
    const legLen = (distance(legs[0].hip, legs[0].ankle, ar) + distance(legs[1].hip, legs[1].ankle, ar)) / 2;
    if (legLen < 1e-6) return this.uncertain("Couldn't measure the legs.");
    const split = (Math.abs(legs[0].ankle.x - legs[1].ankle.x) * ar) / legLen;

    this.updateFacing(landmarks, o.minVisibility);

    if (split < o.minSplit) {
      // Feet together: learn standing bone lengths, release the role lock.
      this.lockedFrontX = null;
      this.lockedFacing = null;
      if (legs[0].kneeAngle > 160 && legs[1].kneeAngle > 160) this.learnBones(legs, ar);
      return { status: "together", legs, split };
    }

    const ax = (leg: LegChain) => leg.ankle.x * ar;
    let front: LegChain;
    let back: LegChain;
    let facing: 1 | -1;
    if (this.lockedFrontX !== null && this.lockedFacing !== null) {
      // Locked: follow the front ankle by position, whatever its label now says.
      const d0 = Math.abs(ax(legs[0]) - this.lockedFrontX);
      const d1 = Math.abs(ax(legs[1]) - this.lockedFrontX);
      [front, back] = d0 <= d1 ? [legs[0], legs[1]] : [legs[1], legs[0]];
      facing = this.lockedFacing;
    } else {
      if (Math.abs(this.facingScore) < o.minFacingConfidence) {
        return this.uncertain("Can't tell which way you're facing. Stand side on with your feet in view.");
      }
      facing = this.facingScore > 0 ? 1 : -1;
      [front, back] = ax(legs[0]) * facing >= ax(legs[1]) * facing ? [legs[0], legs[1]] : [legs[1], legs[0]];
      this.lockedFacing = facing;
    }
    this.lockedFrontX = ax(front);
    return { status: "split", front, back, split, facing };
  }

  reset(): void {
    this.facingScore = 0;
    this.facingSeen = false;
    this.bones = { left: null, right: null };
    this.lockedFrontX = null;
    this.lockedFacing = null;
  }

  private uncertain(reason: string): LegRoles {
    // Losing sight of a leg also loses track of which one was in front.
    this.lockedFrontX = null;
    this.lockedFacing = null;
    return { status: "uncertain", reason };
  }

  /**
   * Build the two leg chains. With learned bone lengths, try the label pairing
   * and the knee-swapped / ankle-swapped pairings and keep the one whose thigh
   * and shin lengths best match; without them, trust the labels.
   */
  private pairLegs(lm: readonly LandmarkLike[], ar: number): [LegChain, LegChain] | null {
    const pairings: Array<[BodySide, BodySide, BodySide, BodySide]> = [
      // [left knee from, left ankle from, right knee from, right ankle from]
      ["left", "left", "right", "right"],
      ["right", "left", "left", "right"],
      ["left", "right", "right", "left"],
      ["right", "right", "left", "left"],
    ];
    const build = (hipSide: BodySide, kneeSide: BodySide, ankleSide: BodySide): LegChain | null => {
      const hip = lm[IDX[hipSide].hip]!;
      const knee = lm[IDX[kneeSide].knee]!;
      const ankle = lm[IDX[ankleSide].ankle]!;
      const kneeAngle = calculateAngle(hip, knee, ankle, ar);
      if (kneeAngle === null) return null;
      return { label: kneeSide, hip, knee, ankle, kneeAngle, indices: [IDX[hipSide].hip, IDX[kneeSide].knee, IDX[ankleSide].ankle] };
    };
    const haveBones = this.bones.left !== null && this.bones.right !== null;
    let best: [LegChain, LegChain] | null = null;
    let bestErr = Infinity;
    for (const [lk, la, rk, ra] of haveBones ? pairings : pairings.slice(0, 1)) {
      const a = build("left", lk, la);
      const b = build("right", rk, ra);
      if (!a || !b) continue;
      const err = haveBones ? this.boneError(a, "left", ar) + this.boneError(b, "right", ar) : 0;
      // Prefer the labels unless a re-pairing is clearly better.
      const penalty = lk === "left" && la === "left" ? 0 : 0.15;
      if (err + penalty < bestErr) {
        bestErr = err + penalty;
        best = [a, b];
      }
    }
    return best;
  }

  private boneError(leg: LegChain, side: BodySide, ar: number): number {
    const b = this.bones[side]!;
    const thigh = distance(leg.hip, leg.knee, ar);
    const shin = distance(leg.knee, leg.ankle, ar);
    return Math.abs(thigh - b.thigh) / b.thigh + Math.abs(shin - b.shin) / b.shin;
  }

  private learnBones(legs: [LegChain, LegChain], ar: number): void {
    for (const [leg, side] of [
      [legs[0], "left"],
      [legs[1], "right"],
    ] as const) {
      const thigh = distance(leg.hip, leg.knee, ar);
      const shin = distance(leg.knee, leg.ankle, ar);
      const prev = this.bones[side];
      this.bones[side] = prev ? { thigh: 0.9 * prev.thigh + 0.1 * thigh, shin: 0.9 * prev.shin + 0.1 * shin } : { thigh, shin };
    }
  }

  /** Facing votes: each visible foot's heel→toe, and the nose ahead of the shoulders. */
  private updateFacing(lm: readonly LandmarkLike[], minVisibility: number): void {
    let votes = 0;
    let n = 0;
    for (const side of ["left", "right"] as const) {
      const heel = lm[IDX[side].heel];
      const toe = lm[IDX[side].toe];
      if (heel && toe && vis(heel) >= minVisibility * 0.6 && vis(toe) >= minVisibility * 0.6 && Math.abs(toe.x - heel.x) > 0.005) {
        votes += Math.sign(toe.x - heel.x);
        n += 1;
      }
    }
    const nose = lm[L.NOSE];
    const ls = lm[L.LEFT_SHOULDER];
    const rs = lm[L.RIGHT_SHOULDER];
    if (nose && ls && rs && vis(nose) >= minVisibility * 0.6) {
      const dx = nose.x - (ls.x + rs.x) / 2;
      if (Math.abs(dx) > 0.01) {
        votes += Math.sign(dx);
        n += 1;
      }
    }
    if (n === 0) return;
    // First vote sets the score; later votes are smoothed so one odd frame can't flip it.
    this.facingScore = this.facingSeen ? 0.8 * this.facingScore + 0.2 * (votes / n) : votes / n;
    this.facingSeen = true;
  }
}
