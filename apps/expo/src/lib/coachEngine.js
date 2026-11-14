// System B — coaching engine API. Consumes vision events (lib/events.js) and produces coaching
// events: CoachResponse (count / cue / after_set / answer), FatigueAssessment, LoadRecommendation
// and WorkoutSummary. Deterministic and low-latency: no AI call per frame or per rep. Questions it
// can answer from records come back as a CoachResponse; anything else returns null so the caller
// can hand it to the AI proxy (lib/jimAI.js).
import { analyzerFor } from './analyzers.js';
import { answerContext } from './coachQA.js';
import { makeEvent } from './events.js';
import { assessFatigue } from './performance.js';
import { afterSetLines, answerPerformance, liveSlowdownCue } from './perfCoach.js';
import { recommendNext } from './recommend.js';

export const FREQUENCIES = ['off', 'minimal', 'normal']; // off: silent; minimal: no rep counts; normal: counts + cues

/** Start a coach for one workout session. */
export function createCoach({ sessionId, frequency = 'normal', onEvent = () => {} }) {
  let set = null; // per-set state
  const resetSet = (exerciseId) => { set = { exerciseId, reps: [], said: new Set(), slowCued: false, summary: null, perf: null }; };
  const emit = (type, data, extra = {}) => {
    const e = makeEvent(type, { sessionId, exerciseId: set?.exerciseId ?? null, source: 'coach', validation: 'computed', data, ...extra });
    onEvent(e);
    return e;
  };
  const respond = (kind, text, { question = null, speak = true } = {}) => {
    if (!text) return null;
    const audible = frequency !== 'off' && speak && !(kind === 'count' && frequency !== 'normal');
    return emit('CoachResponse', { text, kind, speak: audible, question });
  };
  const cueOnce = (text) => {
    if (!text || set.said.has(text)) return null;
    set.said.add(text);
    return respond('cue', text);
  };
  const detail = (exerciseId, r) => {
    const phase = analyzerFor(exerciseId)?.liftPhase ?? 'concentric_ms';
    const other = phase === 'concentric_ms' ? 'eccentric_ms' : 'concentric_ms';
    return { index: r.repIndex, [phase]: r.lift_ms, [other]: r.lower_ms, peak_pause_ms: r.pause_ms, ...(r.rom_deg ? { rom_deg: r.rom_deg } : {}) };
  };

  return {
    frequency,

    /** Feed one vision event. */
    handle(e) {
      if (!set || (e.exerciseId && e.exerciseId !== set.exerciseId)) resetSet(e.exerciseId);
      switch (e.type) {
        case 'RepCompleted': {
          set.reps.push(e.data);
          respond('count', String(e.data.count));
          const line = liveSlowdownCue(e.exerciseId, set.reps.map((r) => detail(e.exerciseId, r)), set.slowCued);
          if (line) { set.slowCued = true; cueOnce(line); }
          break;
        }
        case 'RepRejected': cueOnce(`Not counted — ${e.data.words}.`); break;
        case 'ExerciseMismatch': cueOnce(e.data.guidance); break;
        case 'TrackingStatus': if (e.data.status !== 'ok') cueOnce(e.data.guidance); break;
        case 'FormObservation': if (!set.said.has(e.data.fault)) { set.said.add(e.data.fault); respond('cue', `Rep ${e.data.repIndex}: ${e.data.cue}`, { speak: false }); } break;
        case 'SetCompleted': set.summary = e.data; break;
        case 'PerformanceMeasurement': set.perf = e.data; break;
        default: break;
      }
    },

    /**
     * After the user confirms the set (weight, and optionally completed reps, RPE or RIR).
     * Emits FatigueAssessment, LoadRecommendation (needs approval) and one after_set CoachResponse.
     */
    completeSet({ weight = null, unit = 'lb', completed, rpe = null, rir = null, history = [], setNo = null, sets = null } = {}) {
      const s = set ?? { exerciseId: null, reps: [] };
      const exerciseId = s.exerciseId;
      const n = completed ?? s.summary?.count ?? s.reps.length;
      const target = s.summary?.target ?? null;
      const reps = s.reps.map((r) => detail(exerciseId, r));
      const fatigue = assessFatigue({
        movement: exerciseId, reps, target, completed: n, partials: s.summary?.partials ?? 0,
        partialAfterLastRep: s.summary?.partialAfterLastRep ?? false, rpe, rir, weight, unit, history,
      });
      emit('FatigueAssessment', { level: fatigue.level, signals: fatigue.signals, text: fatigue.text }, { validation: 'unvalidated', confidence: fatigue.confidence === 'medium' ? 0.6 : 0.3 });
      const rec = recommendNext({ exercise: exerciseId, unit, weight, target: target ?? n, completed: n, rpe, rir, fatigue, setNo, sets, history, metrics: s.perf ?? fatigue.metrics });
      emit('LoadRecommendation', { action: rec.action, weight: rec.weight, unit, reps: rec.reps, extraRestS: rec.extraRestS, reasons: rec.reasons, needsApproval: true, agreement: rec.agreement, evidence: rec.evidence }, { units: { weight: unit, extraRestS: 's' }, confidence: rec.confidence === 'higher' ? 0.7 : 0.4 });
      const lines = afterSetLines({ completed: n, target: target ?? n, fatigue, rec });
      respond('after_set', lines.say, { question: lines.ask });
      const result = { fatigue, rec };
      resetSet(exerciseId);
      return result;
    },

    /** A question in text or transcribed speech. Returns a CoachResponse event, or null for the AI. */
    ask(text, ctx = {}) {
      const answer = answerPerformance(text, ctx) ?? answerContext(text, ctx);
      return answer ? respond('answer', answer) : null;
    },

    /** Workout summary (e.g. from missionSummary). */
    summarize({ setsDone, repsDone, setsPlanned, minutes, lines = [] }) {
      const e = emit('WorkoutSummary', { setsDone, repsDone, setsPlanned, minutes, lines }, { units: { minutes: 'min' } });
      respond('summary', lines.join(' '));
      return e;
    },
  };
}
