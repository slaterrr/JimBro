/**
 * Public entry point of the Jim Bro CV module. The frontend should import from
 * here only; everything else is an implementation detail.
 */

export { SquatTracker, initialTrackerState } from "./squat_tracker";
export type { SquatTrackerOptions, TrackerError, TrackerState, TrackerStatus } from "./squat_tracker";
export { useSquatTracker } from "./useSquatTracker";
export type { UseSquatTracker } from "./useSquatTracker";

export { calculateAngle, calculateAngle3D, AngleSmoother } from "./angle_calculator";
export { SquatRepCounter, DEFAULT_REP_COUNTER_CONFIG } from "./rep_counter";
export type { RepCounterConfig, CompletedRep, RejectedRep, RejectionReason } from "./rep_counter";
export { DEFAULT_FORM_ANALYZER_CONFIG } from "./form_analyzer";
export type { FormAnalyzerConfig, CameraView, CameraViewAssessment } from "./form_analyzer";
export { CameraError, ModelLoadError, DEFAULT_DETECTOR_OPTIONS } from "./pose_detection";
export type { CameraErrorCode, DetectorOptions, BodySide } from "./pose_detection";
