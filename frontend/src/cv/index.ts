/**
 * Public entry point of the Jim Bro CV module. The frontend should import from
 * here only; everything else is an implementation detail.
 */

export { ExerciseTracker, initialTrackerState } from "./exercise_tracker";
export type { ExerciseTrackerOptions, TrackerError, TrackerState, TrackerStatus } from "./exercise_tracker";
export { useExerciseTracker } from "./useExerciseTracker";
export type { UseExerciseTracker } from "./useExerciseTracker";

export { EXERCISES, EXERCISE_IDS, getExercise } from "./exercises";
export type { ExerciseDefinition } from "./exercises/types";

export { VoiceCoach, browserSpeaker } from "./voice_coach";
export type { VoiceCoachOptions, Speaker, CoachableTracker } from "./voice_coach";

export { calculateAngle, calculateAngle3D, AngleSmoother } from "./angle_calculator";
export { RepCounter, BaselineDropMeter } from "./rep_counter";
export type { RepCounterConfig, CompletedRep, RejectedRep, RejectionReason, AngleDirection } from "./rep_counter";
export { DEFAULT_FORM_ANALYZER_CONFIG } from "./form_analyzer";
export type { FormAnalyzerConfig, CameraView, CameraViewAssessment } from "./form_analyzer";
export { CameraError, ModelLoadError, DEFAULT_DETECTOR_OPTIONS } from "./pose_detection";
export type { CameraErrorCode, DetectorOptions, BodySide } from "./pose_detection";
