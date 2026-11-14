/**
 * Jim Bro shared data contract.
 *
 * Single source of truth for data passed between the CV module, the frontend
 * and the backend. Changing a shape here means updating all three.
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

export type ExerciseId = "squat" | "pushup" | "bicep_curl" | "shoulder_press" | "deadlift" | "lunge";

/** The joint whose angle drives rep counting for an exercise. */
export type PrimaryJoint = "knee" | "elbow" | "hip";

/**
 * Generic rep phases:
 *   start → toward_peak → peak → returning → start
 * e.g. squat: standing → descending → bottom → ascending.
 * Each exercise supplies human-readable labels (ExerciseDefinition.phaseLabels).
 */
export type RepPhase = "start" | "toward_peak" | "peak" | "returning";

/** Live, per-frame data. Not persisted. */
export interface PoseFrame {
  timestamp: number;
  exercise: ExerciseId;
  phase: RepPhase;
  /** Smoothed primary joint angle (knee or elbow), degrees. null if not visible enough. */
  primaryAngle: number | null;
  /**
   * Exercise-specific progress signal, as a fraction of a body length
   * (squat: hip drop; push-up: chest drop; press: hands above shoulders).
   * null if not measured.
   */
  progress: number | null;
  landmarksVisible: boolean;
}

/** Emitted once per completed, valid rep. */
export interface RepEvent {
  exercise: ExerciseId;
  repNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  primaryJoint: PrimaryJoint;
  /**
   * Most extreme primary angle reached (lowest knee for squats and lunges,
   * lowest elbow for push-ups and curls, highest elbow for presses, highest hip
   * angle at a deadlift lockout). Always measured.
   */
  peakAngle: Metric;
  /** Full range of motion reached (always true for counted reps). */
  fullRange: boolean;
  formFlags: FormFlag[];
  /** Camera view the rep was measured from. Front-view angles are less precise. */
  view: "side" | "front";
  /**
   * Learned movement-quality score, when the exercise has a model and the rep
   * had enough clean data: probability (%) that the rep resembles the reference
   * dataset's incorrect examples. Always estimated. null when not judged.
   */
  movementQuality: Metric | null;
  /**
   * Exercise-specific measurements for this rep, e.g. { backKneeMin, frontKneeMin }
   * for lunges or { elbowDriftMax } for curls. Measurements only, not judgements.
   */
  metrics: Record<string, Metric>;
}

export interface FormFlag {
  /** e.g. "SHALLOW_DEPTH", "UNEVEN_TEMPO" */
  code: string;
  message: string;
  source: MetricSource;
}

export interface WorkoutSession {
  id: string;
  exercise: ExerciseId;
  /** ISO 8601 */
  startedAt: string;
  endedAt: string | null;
  reps: RepEvent[];
  summary: {
    totalReps: number;
    avgRepDurationMs: Metric;
    /** Coefficient of variation of rep durations. */
    tempoConsistency: Metric;
    /** Standard deviation of the peak angle across reps. */
    rangeConsistency: Metric;
    /**
     * Session-level observations, e.g. "Your squat depth was inconsistent" or
     * "Your range of motion dropped over the set". Only raised with enough reps.
     */
    insights: FormFlag[];
  } | null;
}
