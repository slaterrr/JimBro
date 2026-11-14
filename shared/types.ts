/**
 * Jim Bro shared data contract.
 *
 * Single source of truth for data passed between the CV module, the frontend
 * and the backend (see docs/prompts/00-shared-context.md). Changing a shape
 * here means updating all three.
 */

/** measured = directly observed by the camera; estimated = inferred. */
export type MetricSource = "measured" | "estimated";

export interface Metric {
  value: number;
  /** "deg", "ms", "%", "reps" */
  unit: string;
  source: MetricSource;
  /** 0–1. Required when source === "estimated". */
  confidence?: number;
}

export type SquatPhase = "standing" | "descending" | "bottom" | "ascending";

/** Live, per-frame data. Not persisted. */
export interface PoseFrame {
  timestamp: number;
  phase: SquatPhase;
  /** null when the hip/knee/ankle landmarks are below the confidence threshold. */
  kneeAngle: number | null;
  /** null when the shoulder/hip/knee landmarks are below the confidence threshold. */
  hipAngle: number | null;
  landmarksVisible: boolean;
}

/** Emitted once per completed, valid rep. */
export interface RepEvent {
  repNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Always measured. */
  minKneeAngle: Metric;
  depthReached: boolean;
  formFlags: FormFlag[];
}

export interface FormFlag {
  /** e.g. "SHALLOW_DEPTH", "UNEVEN_TEMPO" */
  code: string;
  message: string;
  source: MetricSource;
}

export interface WorkoutSession {
  id: string;
  exercise: "squat";
  /** ISO 8601 */
  startedAt: string;
  endedAt: string | null;
  reps: RepEvent[];
  summary: {
    totalReps: number;
    avgRepDurationMs: Metric;
    /** Coefficient of variation of rep durations. */
    tempoConsistency: Metric;
    depthConsistency: Metric;
  } | null;
}
