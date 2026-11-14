// Shared, versioned event contract between the vision engine and the coaching engine.
// Types for TypeScript consumers: ./events.d.ts. Docs: docs/engines/EVENTS.md.
// Every event: schemaVersion, eventId, type, sessionId, exerciseId, timestamp (ms), source,
// confidence (0..1 or null), validation (how well the producing logic has been tested), units
// (per numeric field) and data.

export const SCHEMA_VERSION = '1.0';

export const EVENT_TYPES = Object.freeze([
  'ExerciseDetected', 'ExerciseMismatch', 'RepStarted', 'RepCompleted', 'RepRejected', 'TrackingStatus',
  'SetCompleted', 'FormObservation', 'PerformanceMeasurement', 'FatigueAssessment', 'LoadRecommendation',
  'CoachResponse', 'WorkoutSummary', 'CameraPerformance',
]);
export const SOURCES = Object.freeze(['vision', 'coach', 'user', 'ai']);
// tested_real / tested_sim / experimental mirror lib/analyzers.js; user_reported = what the user
// said; computed = deterministic arithmetic on other events; unvalidated = heuristic, not yet tested.
export const VALIDATION = Object.freeze(['tested_real', 'tested_sim', 'experimental', 'user_reported', 'computed', 'unvalidated']);

const REQUIRED = {
  ExerciseDetected: ['view', 'side'],
  ExerciseMismatch: ['expected', 'observed', 'reason'],
  RepStarted: ['repIndex'],
  RepCompleted: ['repIndex', 'count'],
  RepRejected: ['reason'],
  TrackingStatus: ['status'],
  SetCompleted: ['count', 'target', 'reps', 'partials'],
  FormObservation: ['repIndex', 'fault', 'cue'],
  PerformanceMeasurement: ['calibrated'],
  FatigueAssessment: ['level', 'signals', 'text'],
  LoadRecommendation: ['action', 'needsApproval', 'reasons'],
  CoachResponse: ['text', 'kind', 'speak'],
  WorkoutSummary: ['setsDone', 'repsDone'],
  CameraPerformance: ['fps', 'inferenceMs'],
};

const UNITS = {
  RepCompleted: { lift_ms: 'ms', lower_ms: 'ms', pause_ms: 'ms', rom_deg: 'deg' },
  SetCompleted: { trackingPct: '%' },
  PerformanceMeasurement: { meanLiftMs: 'ms', velocityLossPct: '%', romLossPct: '%', consistencyCv: 'ratio', speed_dps: 'deg/s' },
  LoadRecommendation: { extraRestS: 's' },
  WorkoutSummary: { minutes: 'min' },
  CameraPerformance: { fps: '1/s', inferenceMs: 'ms', droppedPct: '%' },
};
// Physical quantities that need calibration; never present when calibrated is false.
const CALIBRATED_ONLY = ['velocity_mps', 'displacement_m', 'acceleration_mps2', 'force_n', 'power_w'];

let seq = 0;

/** Build an event. `t` (ms) defaults to now; units are filled in per type. */
export function makeEvent(type, { sessionId, exerciseId = null, t, source, confidence = null, validation, data = {}, units = {} }) {
  seq += 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: `${sessionId}-${seq}`,
    type,
    sessionId,
    exerciseId,
    timestamp: Number.isFinite(t) ? t : Date.now(),
    source,
    confidence,
    validation,
    units: { ...(UNITS[type] ?? {}), ...units },
    data,
  };
}

/** { ok, errors[] } — checks the envelope and the type's required data fields. */
export function validateEvent(e) {
  const errors = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: ['not an object'] };
  if (!EVENT_TYPES.includes(e.type)) errors.push(`unknown type ${e.type}`);
  if (e.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion');
  if (!e.eventId) errors.push('eventId');
  if (!e.sessionId) errors.push('sessionId');
  if (!Number.isFinite(e.timestamp)) errors.push('timestamp');
  if (!SOURCES.includes(e.source)) errors.push(`source ${e.source}`);
  if (!VALIDATION.includes(e.validation)) errors.push(`validation ${e.validation}`);
  if (e.confidence !== null && !(typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 1)) errors.push('confidence');
  if (!e.units || typeof e.units !== 'object') errors.push('units');
  const data = e.data ?? {};
  for (const k of REQUIRED[e.type] ?? []) if (data[k] === undefined) errors.push(`data.${k} missing (${k === 'count' ? 'count' : k})`);
  if (e.type === 'PerformanceMeasurement' && data.calibrated === false) {
    for (const k of CALIBRATED_ONLY) if (k in data) errors.push(`data.${k} not allowed without calibration`);
  }
  return { ok: errors.length === 0, errors };
}
