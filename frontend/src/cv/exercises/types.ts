/**
 * What an exercise has to provide so the generic tracker can count it.
 *
 * Adding an exercise = one new file implementing ExerciseDefinition plus an
 * entry in exercises/index.ts. No changes to the tracker, counter or UI.
 */

import type { ExerciseId, FormFlag, Metric, PrimaryJoint, RepEvent, RepPhase } from "../../../../shared/types";
import type { CameraView } from "../form_analyzer";
import type { BodySide, LandmarkLike, WorldLandmarkLike } from "../pose_detection";
import type { QualityModel } from "../ml/quality_model";
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
  /** Camera view the angles were measured from (front-view squats use the model's 3D estimate). */
  view: "side" | "front";
}

export interface ReadOptions {
  aspectRatio: number;
  minVisibility: number;
  preferredSide: BodySide | null;
  /** The model's 3D landmarks (metres, hip-centred), when available. */
  world?: readonly WorldLandmarkLike[];
  /** Current (smoothed) camera-view estimate. */
  view?: CameraView;
  /** Time of this frame (ms), for stateful readers that need durations. */
  t?: number;
}

/**
 * Min / max of each form signal over one rep. The tracker also records each
 * signal per phase under "<signal>@<phase>", e.g. "kneeRatio@returning".
 * `coverage` is the fraction of the rep's frames where the signal was seen;
 * signals below the evidence threshold are dropped before checks run, so
 * checks never judge from a few frames.
 */
export type FormStats = Record<string, { min: number; max: number; coverage: number }>;

/** The smoothed form signals of every frame of one rep, in order. */
export type FormSeries = ReadonlyArray<{ t: number; phase: RepPhase; form: Readonly<Record<string, number | null>> }>;

/**
 * A check against the user's own earlier reps instead of a universal angle.
 * Used where anatomy, exercise variation or camera position makes a fixed
 * threshold unreliable (e.g. how far the torso leans in a squat).
 */
export interface PersonalCheck {
  /** Form signal key (may be phase-suffixed). */
  signal: string;
  /** Which number per rep to compare: its min, max, or max − min. */
  stat: "min" | "max" | "range";
  /** Which direction is worse. */
  worse: "higher" | "lower";
  /** How far past the personal median before flagging (same unit as the signal). */
  tolerance: number;
  code: string;
  message: (delta: number) => string;
}

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
  /** Camera position the measurements rely on (the one to ask for). */
  cameraView: "side" | "front";
  /** Other views that also work, with fewer or different checks (e.g. front-on squats for knee tracking). */
  otherViews?: readonly ("side" | "front")[];
  /** What "range" means for this exercise in feedback, e.g. "squat depth". */
  rangeNoun: string;
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
  /**
   * For exercises whose reading needs memory across frames (e.g. which leg is
   * in front during a lunge): returns a fresh stateful reader per session.
   * The tracker uses it instead of `read` when present.
   */
  createReader?: () => (landmarks: readonly LandmarkLike[] | undefined, options: ReadOptions) => ExerciseReading;
  /**
   * Exercise-specific per-rep measurements from the recorded form signals
   * (e.g. back-knee depth for lunges). Reported as numbers, not judged.
   */
  repMetrics?: (stats: FormStats, series: FormSeries) => Record<string, Metric>;
  /** Exercise-specific set-level observations from the counted reps (e.g. curl style). */
  sessionInsights?: (reps: readonly RepEvent[]) => FormFlag[];
  /** Exercise-specific wording for PARTIAL_RANGE and PROGRESS_NOT_MET. */
  rejections: Partial<Record<RejectionReason, RejectionText>>;
  /** Exercise-specific per-rep form flags from the recorded form signals. */
  formChecks(rep: CompletedRep, stats: FormStats, view?: "side" | "front"): FormFlag[];
  /** Comparisons against the user's own earlier reps (after a few reps). */
  personalChecks: readonly PersonalCheck[];
  /** Spoken versions of this exercise's form-flag codes. */
  spoken: Record<string, string>;
  /**
   * Optional learned movement-quality check (see cv/ml). Runs on each counted
   * rep from the given views; flags `code` when the model's probability is
   * above its threshold.
   */
  quality?: {
    model: QualityModel;
    views: readonly ("side" | "front")[];
    code: string;
    message: string;
    /**
     * Raise `code` as a form flag above the threshold. When false the score is
     * still recorded on each rep (RepEvent.movementQuality) but never shown to
     * the user as feedback: for models not yet validated on this app's users.
     */
    raiseFlag: boolean;
  };
}
