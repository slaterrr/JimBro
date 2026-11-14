// What Jim says about performance, built only from recorded data. During a set: at most one short
// line, and only for a clear slowdown. After a set: one statement and one question. In chat:
// answers about the last set, the next weight, and how past suggestions turned out.
import { coachingStyle, recoveryQuestion } from './coachingPrinciples.js';
import { EXERCISES, exerciseName } from './exercises.js';
import { assessFatigue, repMetrics } from './performance.js';
import { evaluateRecommendations, recommendNext } from './recommend.js';

const LIVE_MIN_REPS = 6;
const LIVE_SLOW_RATIO = 0.75; // last three reps at <= 75% of the first three reps' speed

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One short cue during a set, or null. `said`: already cued this set (never repeat). */
export function liveSlowdownCue(movement, reps, said = false) {
  if (said || reps.length < LIVE_MIN_REPS) return null;
  const rows = repMetrics(movement, reps).reps;
  const speed = rows.map((r) => r.speed_dps ?? (r.lift_ms > 0 ? 1000 / r.lift_ms : null));
  if (speed.some((x) => x == null)) return null;
  return mean(speed.slice(-3)) <= LIVE_SLOW_RATIO * mean(speed.slice(0, 3)) ? 'Your last three reps were noticeably slower.' : null;
}

/** After a set: { say, ask }. */
export function afterSetLines({ completed, target, fatigue = null, rec = null }) {
  const slow = fatigue?.level === 'possible_fatigue' ? ' Your last reps were noticeably slower.' : '';
  if (target && completed < target) {
    const lower = rec && (rec.action === 'decrease' || rec.action === 'fewer_reps');
    return {
      say: `You did ${completed} of ${target} reps.${slow}`,
      ask: recoveryQuestion({ fatigue }) ?? (lower ? 'You missed your rep target. Would you like to reduce the weight for your next set?' : 'How hard was that?'),
    };
  }
  if (!completed) return { say: 'No reps counted for that set.', ask: 'Want to log it by hand?' };
  return {
    say: `You completed all ${completed} rep${completed === 1 ? '' : 's'}.${slow}`,
    ask: 'How many more do you think you could have done?',
  };
}

/** One optional line per recommendation; null when there is nothing to suggest. */
export function recLine(rec, { history = false } = {}) {
  if (!rec) return null;
  switch (rec.action) {
    case 'increase': return `A small increase to ${rec.weight} ${rec.unit} may be appropriate. Want to use it?`;
    case 'same': return `Based on ${history ? 'your recent workouts' : 'this set'}, keeping this weight may be appropriate.`;
    case 'decrease': return `Want to drop to ${rec.weight} ${rec.unit} for the next set?`;
    case 'more_rest': return `Take an extra minute of rest before the next set${rec.extraRestS && rec.extraRestS !== 60 ? ` (${rec.extraRestS} s)` : ''}.`;
    case 'fewer_reps': return `Aim for ${rec.reps} reps next set?`;
    default: return null;
  }
}

const SUGGESTIONS = /\b(suggestions?|recommendations?)\b.*\b(work|working|worked|right|good|doing)\b|\bhow (are|have) your (suggestions|recommendations)/i;
const HEAVIER = /\b(should|can) i (go )?(heavier|lighter|up in weight)\b|\b(increase|add|more|lower|reduce) (the )?weight\b|\bgo (heavier|lighter)\b/i;
const LAST_SET = /\b(how (was|did) (my |that )?(last )?set|my last set|was i (slow|slowing|tired|fatigued)|how did i do)\b/i;

const allSets = (history, active) => [...history.flatMap((w) => w.sets ?? []), ...(active?.sets ?? [])];

function mentioned(message) {
  const m = message.toLowerCase();
  return EXERCISES.find((e) => m.includes(e.id.replace('_', ' ')) || m.includes(e.name.toLowerCase().split(' ').pop().replace(/s$/, '')))?.id ?? null;
}

/** Chat answer about performance, or null when the message isn't about that. */
export function answerPerformance(message, { history = [], active = null } = {}) {
  const kind = SUGGESTIONS.test(message) ? 'suggestions' : HEAVIER.test(message) ? 'heavier' : LAST_SET.test(message) ? 'last' : null;
  if (!kind) return null;
  const sets = allSets(history, active);
  if (kind === 'suggestions') return evaluateRecommendations(sets).text;
  const ex = mentioned(message);
  const pool = ex ? sets.filter((s) => s.exercise === ex) : sets;
  const last = pool[pool.length - 1];
  if (!last) return `I don't have a set${ex ? ` of ${exerciseName(ex).toLowerCase()}` : ''} to look at yet. Log one, or do one on the Coach tab.`;
  const prior = sets.slice(0, sets.lastIndexOf(last));
  const fatigue = assessFatigue({
    movement: last.exercise, reps: last.reps_detail ?? [], target: last.target ?? null, completed: last.reps,
    rpe: last.rpe ?? null, weight: last.weight, unit: last.unit, history: prior,
  });
  const name = exerciseName(last.exercise).toLowerCase();
  const load = last.weight > 0 ? `${last.weight} ${last.unit}` : 'bodyweight';
  if (kind === 'heavier') {
    const rec = recommendNext({
      exercise: last.exercise, unit: last.unit, weight: last.weight, target: last.target ?? last.reps, completed: last.reps,
      rpe: last.rpe ?? null, fatigue, history: prior,
    });
    const style = coachingStyle({ sessions: history.filter((w) => (w.sets ?? []).length).length });
    return style.askUserFirst ? `${style.prompt} For reference: ${rec.reasons.join(' ')}` : `${rec.reasons.join(' ')} It's your call.`;
  }
  return `Your last ${name} set: ${last.reps}${last.target ? ` of ${last.target}` : ''} reps at ${load}. ${fatigue.text}`;
}
