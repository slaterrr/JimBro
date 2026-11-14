// Lifter tools that run on the phone.
import { EXERCISES } from './exercises.js';
import { chronologicalHistory } from './historyOrder.js';

const STEP = { kg: 0.5, lb: 2.5 };

/** Epley estimate, only from sets of 1-10 reps (higher reps are unreliable). */
export function estimate1RM({ weight, reps, unit }) {
  if (!(weight > 0) || !(reps >= 1) || reps > 10) return null;
  if (reps === 1) return weight;
  const step = STEP[unit] ?? 0.5;
  return Math.round((weight * (1 + reps / 30)) / step) * step;
}

const PLATES = { lb: [45, 35, 25, 10, 5, 2.5], kg: [25, 20, 15, 10, 5, 2.5, 1.25] };
const BAR = { lb: 45, kg: 20 };

/** Plates per side for a barbell load; null if lighter than an empty bar. */
export function plateBreakdown(total, unit) {
  const bar = BAR[unit];
  if (total < bar) return null;
  let side = (total - bar) / 2;
  const perSide = [];
  for (const p of PLATES[unit]) {
    while (side + 1e-9 >= p) {
      perSide.push(p);
      side -= p;
    }
  }
  return { bar, perSide, remainder: Math.round(side * 2 * 100) / 100 };
}

const IDS = new Set(EXERCISES.map((e) => e.id));
const validSet = (s) =>
  s && IDS.has(s.exercise) && ['kg', 'lb'].includes(s.unit) &&
  Number.isFinite(s.weight) && s.weight >= 0 && Number.isInteger(s.reps) && s.reps >= 0 &&
  (s.rpe === null || s.rpe === undefined || (s.rpe >= 1 && s.rpe <= 10));

/** Validate a file produced by Export; throws with a human reason. */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That is not a JimBro export (not valid JSON).');
  }
  if (data?.format !== 'jimbro-phone-export-v1' || !Array.isArray(data.history)) {
    throw new Error('That is not a JimBro export.');
  }
  data.history.forEach((w, i) => {
    if (!w?.id || !w.startedAt || !Array.isArray(w.sets) || !w.sets.every(validSet)) {
      throw new Error(`The export is damaged: workout ${i + 1} has an invalid set.`);
    }
  });
  return { history: data.history, plan: data.plan ?? null, settings: data.settings ?? {} };
}

/** Union of workouts by id, oldest first. */
export function mergeHistory(current, incoming) {
  const byId = new Map(current.map((w) => [w.id, w]));
  for (const w of incoming) if (!byId.has(w.id)) byId.set(w.id, w);
  return chronologicalHistory([...byId.values()]);
}

/** A past workout as a plan-day checklist (same exercises, set counts and rep range). */
export function repeatPlan(workout) {
  const order = [];
  const by = new Map();
  for (const s of workout.sets) {
    if (!by.has(s.exercise)) {
      by.set(s.exercise, []);
      order.push(s.exercise);
    }
    by.get(s.exercise).push(s.reps);
  }
  return {
    day: null,
    items: order.map((exercise) => {
      const reps = by.get(exercise);
      return { exercise, sets: reps.length, reps_low: Math.min(...reps), reps_high: Math.max(...reps) };
    }),
  };
}
