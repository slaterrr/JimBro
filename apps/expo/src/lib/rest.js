// Rest between sets, curated per exercise instead of one global setting.
//
// Rationale (general strength-training guidance, e.g. ACSM's progression-model position
// stand and NSCA rest-interval recommendations; these are rules of thumb, not prescriptions):
// - Heavy multi-joint lifts (squat, deadlift, bench) at strength rep ranges (about 6 or fewer)
//   recover best with long rests, roughly 2-5 min; we use 3:00.
// - Moderate-rep compound work (about 6-12 reps, hypertrophy) is usually given 1-3 min;
//   heavy compounds get the upper end (2:00-2:30), lighter compounds a bit less.
// - Single-joint / isolation work (curls) recovers faster: about 60-90 s.
// - Core / abs work is short: about 30-60 s; we use 45 s.
// - A harder set (RPE 9 or more, near failure) needs more recovery, so we add 30 s.
// The timer still lets the user add 30 s or skip.
import { exerciseName } from './exercises.js';
import { fitnessGoalShort, normalizeFitnessGoal } from './fitnessGoal.js';

const HEAVY = new Set(['squat', 'deadlift', 'bench']);
const COMPOUND = new Set(['shoulder_press', 'pull_up', 'row', 'lunge', 'dip']);
const ISOLATION = new Set(['curl', 'tricep_extension', 'lateral_raise', 'leg_extension', 'leg_curl']);
const CORE = new Set(['plank', 'crunch', 'sit_up', 'ab_wheel', 'leg_raise', 'core', 'abs']);

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function base(exercise, reps) {
  const r = reps >= 1 ? reps : 8; // unknown reps: assume a moderate set
  if (CORE.has(exercise)) return [45, 'core work'];
  if (HEAVY.has(exercise)) {
    if (r <= 6) return [180, 'strength'];
    if (r <= 8) return [150, 'strength'];
    return [120, 'muscle growth'];
  }
  if (COMPOUND.has(exercise)) {
    if (r <= 6) return [150, 'strength'];
    if (r <= 10) return [120, 'muscle growth'];
    return [90, 'muscle growth'];
  }
  if (ISOLATION.has(exercise)) return r <= 8 ? [90, 'muscle growth'] : [75, 'muscle growth'];
  return [90, 'recovery'];
}

// Goal-personalized rest (settings.fitnessGoal). Same sources; ranges are rules of thumb:
// - strength: long rests on compounds (2-5 min) so the next heavy set is as strong as possible.
// - muscle (hypertrophy): about 60-120 s.
// - endurance: about 30-60 s (muscular-endurance work keeps rests short on purpose).
// - general (default, and old saves): the moderate per-exercise rules in base() above.
// Beginners/comeback users and sedentary users get +15 s while they ease in.
const GOAL_REST = {
  //          heavy compound isolation core other
  strength: [180, 150, 90, 60, 120],
  muscle: [120, 90, 60, 45, 75],
  endurance: [60, 45, 30, 30, 45],
};
const KIND = ['heavy lift', 'compound lift', 'isolation lift', 'core work', 'this lift'];
const kindOf = (e) => (HEAVY.has(e) ? 0 : COMPOUND.has(e) ? 1 : ISOLATION.has(e) ? 2 : CORE.has(e) ? 3 : 4);
const EASY_EXPERIENCE = new Set(['new', 'returning']);

/**
 * Suggested rest after a set: { seconds, goal, text }. `text` says why, e.g.
 * "Squat · 5 reps: 3:00 rest. Strength goal + heavy lift".
 */
export function restFor({ exercise, reps, rpe, fitnessGoal, experience, activityLevel } = {}) {
  const goalId = normalizeFitnessGoal(fitnessGoal);
  const table = GOAL_REST[goalId];
  const k = kindOf(exercise);
  const [b, goal] = table ? [table[k], fitnessGoalShort(goalId).toLowerCase()] : base(exercise, reps);
  const hard = rpe >= 9;
  const easy = EASY_EXPERIENCE.has(experience) || activityLevel === 'sedentary';
  const seconds = b + (hard ? 30 : 0) + (easy ? 15 : 0);
  const what = reps >= 1 ? `${exerciseName(exercise)} · ${reps} reps` : exerciseName(exercise);
  const why = table ? `rest. ${fitnessGoalShort(goalId)} goal + ${KIND[k]}` : `rest for ${goal}`;
  const extras = `${hard ? ` (+0:30 for RPE ${rpe})` : ''}${easy ? ' (+0:15, easing in)' : ''}`;
  return { seconds, goal, text: `${what}: ${clock(seconds)} ${why}${extras}` };
}

/** Seconds only (plans, older callers). Same rules as restFor with the general goal. */
export function restSeconds(exercise, reps = 8) {
  return restFor({ exercise, reps }).seconds;
}
