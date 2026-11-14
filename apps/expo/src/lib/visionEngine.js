// System A — vision engine API. Wraps the tested camera pipeline (LiveSession: pose quality gates,
// exercise checks, rep state machine, form review) and emits versioned events (lib/events.js).
// Live camera frames and prerecorded frames go through exactly the same code.
// Callers never need MediaPipe details: feed { t (ms), pose (33 landmarks | null) } frames.
import { analyzerFor } from './analyzers.js';
import { makeEvent } from './events.js';
import { cameraGuidance } from './guidance.js';
import { LiveSession } from './live.js';
import { repMetrics } from './performance.js';

const WORDS = { arm_swing: 'arm swing', framing: 'step back into frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/**
 * Start a camera-analysis session for one exercise.
 * Throws for exercises the camera can't analyze (analyzer status 'manual'), with the reason.
 * Returns { frame(t, pose), finishSet({ target }), count, analyzer }.
 */
export function createVisionSession({ exerciseId, sessionId, onEvent }) {
  const analyzer = analyzerFor(exerciseId);
  const session = new LiveSession(exerciseId); // throws "No camera counting for …: … Tap to count."
  const validation = analyzer?.status ?? 'unvalidated';
  const phase = analyzer?.liftPhase ?? 'concentric_ms';
  let lastT = 0;
  let tracking = null;
  let detected = false;
  let inMismatch = false;
  let prevState = 'rest';
  const emit = (type, t, data, extra = {}) => onEvent(makeEvent(type, { sessionId, exerciseId, t, source: 'vision', validation, data, ...extra }));

  return {
    analyzer,
    get count() { return session.count; },

    /** Feed one frame. Returns the raw snapshot (for overlays); events go to onEvent. */
    frame(t, pose) {
      lastT = t;
      const out = session.frame(t, pose);
      const status = out.tracking?.status ?? 'lost';
      if (status !== tracking) {
        tracking = status;
        emit('TrackingStatus', t, { status, hint: out.hint ?? null, guidance: status === 'ok' ? null : cameraGuidance('tracking', out.hint, exerciseId) }, { confidence: round2(out.tracking?.confidence ?? 0) });
      }
      if (!detected && status === 'ok' && session.side) {
        detected = true;
        emit('ExerciseDetected', t, { view: session.view ?? 'side', side: session.side }, { confidence: round2(out.tracking.confidence) });
      }
      if (out.issue === 'exercise_change') {
        if (!inMismatch) {
          inMismatch = true;
          const observed = out.suggested ?? (['upright', 'hang'].includes(out.hint) ? 'unknown' : out.hint ?? 'unknown');
          emit('ExerciseMismatch', t, { expected: exerciseId, observed, reason: 'Body shape does not match the selected exercise.', guidance: cameraGuidance('exercise_change', out.hint, exerciseId) });
        }
      } else if (!out.issue) {
        inMismatch = false;
      }
      if (out.blocked) emit('RepRejected', t, { reason: out.blocked.reason, words: WORDS[out.blocked.reason] ?? 'lost tracking' });
      if (prevState === 'rest' && out.state && out.state !== 'rest' && !out.issue) emit('RepStarted', t, { repIndex: session.count + 1 });
      prevState = out.state ?? prevState;
      if (out.rep) {
        const d = session.repsDetail().at(-1);
        emit('RepCompleted', t, {
          repIndex: d.index, count: out.count,
          lift_ms: d[phase], lower_ms: d[phase === 'concentric_ms' ? 'eccentric_ms' : 'concentric_ms'], pause_ms: d.peak_pause_ms,
          rom_deg: d.rom_deg ?? null, peak_dps: d.peak_dps ?? null, mean_dps: d.mean_dps ?? null,
          ...(d.variant !== undefined ? { variant: d.variant } : {}),
        }, { confidence: round2(out.tracking.confidence) });
      }
      return out;
    },

    /** End the set: form observations, the set summary and relative performance measurements. */
    finishSet({ target = null } = {}) {
      const reps = session.repsDetail();
      const q = session.quality();
      const m = repMetrics(exerciseId, reps);
      for (const clip of session.clips) {
        for (const f of clip.analysis.faults ?? []) {
          emit('FormObservation', lastT, { repIndex: clip.index, fault: f.id, why: f.why, fix: f.fix, cue: f.cue, severity: f.severity, measured: f.measured, threshold: f.threshold }, { units: { measured: f.unit, threshold: f.unit }, validation: 'unvalidated' });
        }
      }
      emit('SetCompleted', lastT, {
        count: session.count, target, partials: q.partials, partialAfterLastRep: q.partialAfterLastRep,
        trackingPct: q.frames ? Math.round((100 * q.okFrames) / q.frames) : null,
        reps: m.reps.map((r) => ({ repIndex: r.index, lift_ms: r.lift_ms, lower_ms: r.lower_ms, pause_ms: r.pause_ms, rom_deg: r.rom_deg })),
      });
      emit('PerformanceMeasurement', lastT, {
        calibrated: false, meanLiftMs: m.meanLiftMs, velocityLossPct: m.velocityLossPct, romLossPct: m.romLossPct,
        consistencyCv: m.consistencyCv, omitted: m.omitted,
      }, { validation: validation === 'tested_real' ? 'computed' : validation });
      return { count: session.count, reps, quality: q, metrics: m };
    },
  };
}

/**
 * Analyze prerecorded frames (e.g. extracted by tools/vision-lab from an MP4) with the same logic
 * as live: returns { events, count, reps, quality, metrics }.
 */
export function analyzeRecording(frames, { exerciseId, target = null, sessionId = 'recording' }) {
  const events = [];
  const v = createVisionSession({ exerciseId, sessionId, onEvent: (e) => events.push(e) });
  for (const f of frames) v.frame(f.t, f.pose);
  return { events, ...v.finishSet({ target }) };
}
