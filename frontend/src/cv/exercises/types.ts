/**
 * What an exercise has to provide so the generic tracker can count it.
 *
 * Adding an exercise = one new file implementing ExerciseDefinition plus an
 * entry in exercises/index.ts. No changes to the tracker, counter or UI.
 */

import type { ExerciseId, FormFlag, PrimaryJoint, RepPhase } from "../../../../shared/types";
import type { BodySide, LandmarkLike } from "../pose_detection";
import type { CompletedRep, RejectionReason, RepCounterConfig } from "../rep_counter";

/** How the progress signal is measured each frame. */
export type ProgressInput =
  /** Drop from the start-position height of `y`, as a fraction of `refLength` (baseline learned at start). */
  | { kind: "drop"; y: number; refLength: number }
  /** Already a fraction of body length; used as is. */
  | { kind: "absolute"; value: number };

/** One frame's worth of exercise-specific measurements (raw, unsmoothed). */
export interface ExerciseReading {
  /** True when the joints needed for counting are visible and the user is in position. */
  visible: boolean;
  primaryAngle: number | null;
  progress: ProgressInput | null;
  /** Per-frame form signals (degrees); the tracker records each one's min/max per rep. */
  form: Record<string, number | null>;
  /** Limb(s) used. */
  side: BodySide | "both" | null;
  /** Landmarks to draw in the accent colour. */
  highlight: readonly number[];
  /** Set when the user is visible but not in the right position, e.g. standing during push-ups. */
  positionHint: string | null;
}

export interface ReadOptions {
  aspectRatio: number;
  minVisibility: number;
  preferredSide: BodySide | null;
}

/** Min / max of each form signal over one rep. */
export type FormStats = Record<string, { min: number; max: number }>;

export interface RejectionText {
  code: string;
  message: string;
  /** Short version for the voice coach. */
  spoken: string;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  name: string;
  primaryJoint: PrimaryJoint;
  /** Camera position the measurements rely on. */
  cameraView: "side" | "front";
  /** Spoken and shown when tracking starts. */
  setupInstructions: string;
  /** Said until the counter is armed, e.g. "Stand up tall to begin." */
  startPrompt: string;
  /** Said once armed. */
  readyPrompt: string;
  phaseLabels: Record<RepPhase, string>;
  counter: RepCounterConfig;
  /** Which part of the rep is the lowering (eccentric) phase, for the "too fast" tip. */
  loweringPhase: "toPeak" | "return";
  /** Label for the progress signal, or null when the exercise has none. */
  progress: { label: string; hint: string } | null;
  /** Calibration guide shown next to the sliders. */
  calibrationGuide: string;

  read(landmarks: readonly LandmarkLike[] | undefined, options: ReadOptions): ExerciseReading;
  /** Exercise-specific wording for PARTIAL_RANGE and PROGRESS_NOT_MET. */
  rejections: Partial<Record<RejectionReason, RejectionText>>;
  /** Exercise-specific per-rep form flags from the recorded form signals. */
  formChecks(rep: CompletedRep, stats: FormStats): FormFlag[];
  /** Spoken versions of this exercise's form-flag codes. */
  spoken: Record<string, string>;
}
