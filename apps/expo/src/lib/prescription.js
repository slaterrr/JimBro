// A started workout, prepared: each planned exercise with its prescribed sets, target reps,
// rest and (when history supports it) weight, filled in automatically. Nothing is recorded
// until the user taps a set: one tap records the target; edits record what actually happened.
import { exerciseInfo, exerciseName } from './exercises.js';
import { exerciseSessions, recommendNext } from './progression.js';

const BODYWEIGHT = new Set(['push_up', 'pull_up', 'chin_up', 'dips']);
export const isBodyweightLift = (id) => BODYWEIGHT.has(id) || Boolean(exerciseInfo(id)?.needs.every((g) => g.length === 1 && g[0] === 'bodyweight'));
const mmdd = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

export function prepareWorkout(planned, { history = [], unit = 'lb' } = {}) {
  return {
    name: planned?.name ?? 'Workout',
    exercises: (planned?.items ?? []).map((item) => {
      const bodyweight = isBodyweightLift(item.exercise);
      const reps_low = item.reps_low ?? item.reps ?? 8;
      const reps_high = item.reps_high ?? reps_low;
      const rec = recommendNext(history, item.exercise, { reps_low, reps_high, unit });
      const last = exerciseSessions(history, item.exercise, unit).at(-1);
      const target = {
        reps: rec.reps, reps_low, reps_high, unit,
        weight: bodyweight ? null : rec.weight,
        rest_sec: Math.round((item.rest_min ?? 1.5) * 60),
        rpe_low: item.rpe_low ?? null, rpe_high: item.rpe_high ?? null,
      };
      const previous = last ? { date: last.date, text: `Last time (${mmdd(last.date)}): ${last.sets.map((s) => s.reps).join(', ')}${last.top.weight > 0 ? ` × ${last.top.weight} ${unit}` : ' reps'}` } : null;
      return { exercise: item.exercise, name: exerciseName(item.exercise), sets: item.sets, target, previous, recommendation: rec, bodyweight, needsWeight: !bodyweight && target.weight == null };
    }),
  };
}

/** The set to save for a tap on set `setIndex`, or null when it can't be recorded honestly. */
export function setFromTap(ex, setIndex, edits = {}) {
  const reps = edits.reps ?? ex.target.reps;
  const weight = edits.weight ?? (ex.bodyweight ? 0 : ex.target.weight);
  if (weight == null || !Number.isFinite(Number(weight)) || Number(weight) < 0 || Number(weight) > 2000) return null;
  if (!Number.isInteger(Number(reps)) || Number(reps) < 0 || Number(reps) > 100) return null;
  return { exercise: ex.exercise, reps: Number(reps), weight: Number(weight), unit: ex.target.unit, rpe: null, source: 'manual', target: ex.target.reps, set_index: setIndex, prescribed: true, reps_detail: [] };
}

/** Sets of this exercise the user has confirmed in the active workout. */
export const loggedFor = (active, exercise) => (active?.sets ?? []).filter((s) => s.exercise === exercise && s.prescribed);
