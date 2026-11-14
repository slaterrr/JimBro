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

/** Suggested rest after a set: { seconds, goal, text }. */
export function restFor({ exercise, reps, rpe } = {}) {
  const [b, goal] = base(exercise, reps);
  const hard = rpe >= 9;
  const seconds = b + (hard ? 30 : 0);
  const what = reps >= 1 ? `${exerciseName(exercise)} · ${reps} reps` : exerciseName(exercise);
  const text = `${what}: ${clock(seconds)} rest for ${goal}${hard ? ` (+0:30 for RPE ${rpe})` : ''}`;
  return { seconds, goal, text };
}
