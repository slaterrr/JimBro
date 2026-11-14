// TypeScript view of the JimBro event contract (runtime: ./events.js, docs: docs/engines/EVENTS.md).
// Discriminated on `type`. Schema version 1.0.

export type Source = 'vision' | 'coach' | 'user' | 'ai';
export type Validation = 'tested_real' | 'tested_sim' | 'experimental' | 'user_reported' | 'computed' | 'unvalidated';
export type ExerciseId = 'curl' | 'squat' | 'shoulder_press' | 'push_up' | 'pull_up' | 'deadlift' | 'bench' | 'lunge' | string;

interface Envelope<T extends string, D> {
  schemaVersion: '1.0';
  eventId: string;
  type: T;
  sessionId: string;
  exerciseId: ExerciseId | null;
  /** ms: epoch for live/coach events, frame time for vision events */
  timestamp: number;
  source: Source;
  /** 0..1, or null when not applicable */
  confidence: number | null;
  validation: Validation;
  /** unit per numeric data field, e.g. { lift_ms: 'ms', rom_deg: 'deg' } */
  units: Record<string, string>;
  data: D;
}

export type ExerciseDetected = Envelope<'ExerciseDetected', { view: 'side' | 'front'; side: 'left' | 'right' }>;
export type ExerciseMismatch = Envelope<'ExerciseMismatch', { expected: ExerciseId; observed: ExerciseId | 'unknown'; reason: string; guidance: string | null }>;
export type RepStarted = Envelope<'RepStarted', { repIndex: number }>;
export type RepCompleted = Envelope<'RepCompleted', {
  repIndex: number; count: number; lift_ms: number; lower_ms: number; pause_ms: number; rom_deg: number | null;
  /** lifting-phase joint angular speed from the angle trace (relative, deg/s; not bar speed) */
  peak_dps: number | null; mean_dps: number | null; variant?: 'standard' | 'knee' | 'incline' | null;
}>;
export type RepRejected = Envelope<'RepRejected', { reason: 'arm_swing' | 'framing' | 'implausible_motion' | 'tracking' | string; words: string }>;
export type TrackingStatus = Envelope<'TrackingStatus', { status: 'ok' | 'low' | 'lost'; hint: string | null; guidance: string | null }>;
export type SetCompleted = Envelope<'SetCompleted', {
  count: number; target: number | null; reps: RepCompleted['data'][]; partials: number; partialAfterLastRep: boolean; trackingPct: number | null;
}>;
export type FormObservation = Envelope<'FormObservation', { repIndex: number; fault: string; why: string; fix: string; cue: string }>;
export type PerformanceMeasurement = Envelope<'PerformanceMeasurement', {
  /** always false today: no m/s, displacement, force or power fields may appear */
  calibrated: false;
  meanLiftMs: number | null; velocityLossPct: number | null; romLossPct: number | null; consistencyCv: number | null;
  omitted: { metric: string; why: string }[];
}>;
export type FatigueAssessment = Envelope<'FatigueAssessment', {
  level: 'normal' | 'possible_fatigue' | 'increasing_difficulty' | 'incomplete_rep' | 'failed_attempt' | 'uncertain';
  signals: string[]; text: string;
}>;
export type LoadRecommendation = Envelope<'LoadRecommendation', {
  action: 'increase' | 'same' | 'decrease' | 'more_rest' | 'fewer_reps' | 'none';
  weight: number | null; unit: 'lb' | 'kg'; reps: number | null; extraRestS: number; reasons: string[]; needsApproval: true;
}>;
export type CoachResponse = Envelope<'CoachResponse', {
  text: string; kind: 'count' | 'cue' | 'after_set' | 'answer' | 'summary'; speak: boolean; question?: string | null;
}>;
export type WorkoutSummary = Envelope<'WorkoutSummary', { setsDone: number; repsDone: number; setsPlanned?: number; minutes?: number; lines?: string[] }>;
export type CameraPerformance = Envelope<'CameraPerformance', { fps: number; inferenceMs: number; droppedPct: number | null; device: string | null }>;

export type JimEvent =
  | ExerciseDetected | ExerciseMismatch | RepStarted | RepCompleted | RepRejected | TrackingStatus
  | SetCompleted | FormObservation | PerformanceMeasurement | FatigueAssessment | LoadRecommendation
  | CoachResponse | WorkoutSummary | CameraPerformance;

export declare const SCHEMA_VERSION: '1.0';
export declare const EVENT_TYPES: readonly JimEvent['type'][];
export declare function validateEvent(e: unknown): { ok: boolean; errors: string[] };
