// Session-to-session progression from the user's own history (deterministic, no AI).
// Double progression inside the prescribed rep range:
//   every set at the working weight reached the top of the range -> add the smallest step
//   two drops in a row                                           -> reduce ~10% and check recovery
//   the same result three sessions running                      -> hold, aim for one more rep
//   otherwise                                                    -> same weight, one more rep
// History is only read, never changed.
import { completedWorkouts } from './attendance.js';
import { exerciseInfo, exerciseName } from './exercises.js';

const LOWER = new Set(['squat', 'hinge', 'lunge']);
const STEP = { lb: [5, 10], kg: [2.5, 5] }; // [upper body, lower body]
export const stepFor = (exercise, unit = 'lb') => (STEP[unit] ?? STEP.lb)[LOWER.has(exerciseInfo(exercise)?.pattern) ? 1 : 0];
const e1rm = (s) => (s.weight > 0 ? s.weight * (1 + s.reps / 30) : s.reps);
const roundDown = (x, step) => Math.max(0, Math.floor(x / step + 1e-9) * step);

/** Completed sessions of one exercise in one unit, oldest first. */
export function exerciseSessions(history, exercise, unit = 'lb') {
  return completedWorkouts(history)
    .map((w) => ({ w, sets: w.sets.filter((s) => s.exercise === exercise && (s.unit ?? unit) === unit && s.reps > 0) }))
    .filter((x) => x.sets.length)
    .sort((a, b) => String(a.w.startedAt).localeCompare(String(b.w.startedAt)))
    .map(({ w, sets }) => {
      const weight = Math.max(...sets.map((s) => s.weight ?? 0));
      const atTop = sets.filter((s) => (s.weight ?? 0) === weight);
      return {
        date: String(w.startedAt).slice(0, 10), workoutId: w.id,
        sets: sets.map((s) => ({ reps: s.reps, weight: s.weight ?? 0, rpe: s.rpe ?? null })),
        top: { weight, reps: Math.max(...atTop.map((s) => s.reps)) },
        minRepsAtTop: Math.min(...atTop.map((s) => s.reps)),
        best: Math.max(...sets.map((s) => e1rm({ weight: s.weight ?? 0, reps: s.reps }))),
      };
    });
}

/** 'new' | 'steady' | 'improving' | 'plateau' | 'declining' */
export function trendOf(sessions) {
  if (!sessions.length) return 'new';
  if (sessions.length < 2) return 'steady';
  const [a, b, c] = sessions.slice(-3);
  if (c && a.best > b.best && b.best > c.best) return 'declining';
  if (c && a.top.weight === b.top.weight && b.top.weight === c.top.weight && a.top.reps === b.top.reps && b.top.reps === c.top.reps) return 'plateau';
  const [p, l] = sessions.slice(-2);
  return l.best > p.best ? 'improving' : 'steady';
}

/** Next session's target for one exercise: { action, weight|null, reps, trend, why, basedOn }. */
export function recommendNext(history, exercise, { reps_low, reps_high, unit = 'lb' }) {
  const name = exerciseName(exercise).toLowerCase();
  const sessions = exerciseSessions(history, exercise, unit);
  const trend = trendOf(sessions);
  if (!sessions.length) {
    return { action: 'start', weight: null, reps: reps_low, trend, basedOn: [], why: `No ${name} history yet: use a weight you can lift for ${reps_low}–${reps_high} reps with 2–3 reps left. No max testing.` };
  }
  const last = sessions.at(-1);
  const W = last.top.weight;
  const repsText = last.sets.filter((s) => s.weight === W).map((s) => s.reps).join(', ');
  const load = W > 0 ? ` × ${W} ${unit}` : ' reps';
  const basedOn = sessions.slice(-3).map((s) => s.workoutId);
  const step = stepFor(exercise, unit);
  if (trend === 'declining') {
    const tops = sessions.slice(-3).map((s) => (s.top.weight > 0 ? `${s.top.reps} × ${s.top.weight}` : `${s.top.reps}`)).join(' → ');
    const weight = W > 0 ? roundDown(W * 0.9, step) : null;
    return { action: 'reduce', weight, reps: reps_low, trend, basedOn, why: `Your ${name} dropped two sessions in a row (${tops}). ${weight != null ? `Go down to ${weight} ${unit}` : 'Go easier'} for ${reps_low}+ reps and check your recovery: sleep, food and rest days.` };
  }
  if (last.minRepsAtTop >= reps_high) {
    if (W === 0) return { action: 'add_rep', weight: null, reps: last.minRepsAtTop + 1, trend, basedOn, why: `Every set hit ${reps_high}+ reps. Add a rep or try a harder variation.` };
    const weight = W + step;
    return { action: 'increase', weight, reps: reps_low, trend, basedOn, why: `Every set at ${W} ${unit} reached ${reps_high} reps (${repsText}), the top of your ${reps_low}–${reps_high} range${trend === 'improving' ? ', and you have improved each session' : ''}. Add ${step} ${unit}: ${weight} ${unit} for ${reps_low}+ reps.` };
  }
  const target = Math.min(reps_high, Math.max(reps_low, last.minRepsAtTop + 1));
  if (trend === 'plateau') {
    return { action: 'hold', weight: W > 0 ? W : null, reps: target, trend, basedOn, why: `Same result three sessions in a row (${last.top.reps}${load}). Keep the weight and aim for ${target} on every set; if it stays stuck, take a lighter week and sleep well.` };
  }
  return { action: 'add_rep', weight: W > 0 ? W : null, reps: target, trend, basedOn, why: `Last time: ${repsText}${load}.${trend === 'improving' ? ' You are improving.' : ''} Same weight, aim for ${target} reps on every set.` };
}
