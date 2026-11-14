// Which muscle groups each lift trains, and how recently each group was worked.
export const MUSCLE_GROUPS = [
  { id: 'chest', name: 'Chest' },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'biceps', name: 'Biceps' },
  { id: 'triceps', name: 'Triceps' },
  { id: 'forearms', name: 'Forearms' },
  { id: 'abs', name: 'Abs' },
  { id: 'lats', name: 'Lats' },
  { id: 'traps', name: 'Traps' },
  { id: 'lower_back', name: 'Lower back' },
  { id: 'glutes', name: 'Glutes' },
  { id: 'quads', name: 'Quads' },
  { id: 'hamstrings', name: 'Hamstrings' },
  { id: 'calves', name: 'Calves' },
];

export const EXERCISE_MUSCLES = {
  curl: ['biceps', 'forearms'],
  squat: ['quads', 'glutes', 'hamstrings'],
  bench: ['chest', 'shoulders', 'triceps'],
  deadlift: ['hamstrings', 'glutes', 'lower_back', 'traps', 'forearms'],
  shoulder_press: ['shoulders', 'triceps', 'traps'],
  pull_up: ['lats', 'biceps', 'forearms'],
};

/**
 * Volume-by-muscle allocation (used by analytics.volumeByMuscle). Each set's
 * volume and set count go 100% to the exercise's PRIMARY muscles and 50% to
 * its SECONDARY muscles. A simple, documented convention for relative
 * training load, the common "fractional sets" approach; it is not a
 * measurement of how hard each muscle worked.
 */
export const EXERCISE_MUSCLE_SHARES = {
  curl: { biceps: 1, forearms: 0.5 },
  squat: { quads: 1, glutes: 1, hamstrings: 0.5 },
  bench: { chest: 1, shoulders: 0.5, triceps: 0.5 },
  deadlift: { hamstrings: 1, glutes: 1, lower_back: 1, traps: 0.5, forearms: 0.5 },
  shoulder_press: { shoulders: 1, triceps: 0.5, traps: 0.5 },
  pull_up: { lats: 1, biceps: 0.5, forearms: 0.5 },
};

const DAY = 86400000;
const daysSince = (iso, now) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);

/** For every group: 'trained' (<=3 days), 'recent' (4-7 days) or 'rest' (8+ days / never). */
export function muscleStatus(workouts, now = new Date()) {
  const last = {};
  for (const w of workouts) {
    const d = daysSince(w.startedAt, now);
    for (const s of w.sets) {
      for (const m of EXERCISE_MUSCLES[s.exercise] ?? []) {
        if (last[m] === undefined || d < last[m]) last[m] = d;
      }
    }
  }
  return Object.fromEntries(
    MUSCLE_GROUPS.map(({ id }) => {
      const d = last[id];
      return [id, d === undefined || d >= 8 ? 'rest' : d <= 3 ? 'trained' : 'recent'];
    }),
  );
}

export function muscleDetail(workouts, group, now = new Date()) {
  let days = null;
  let setsThisWeek = 0;
  const exercises = new Set();
  for (const w of workouts) {
    const d = daysSince(w.startedAt, now);
    for (const s of w.sets) {
      if (!(EXERCISE_MUSCLES[s.exercise] ?? []).includes(group)) continue;
      exercises.add(s.exercise);
      if (days === null || d < days) days = d;
      if (d < 7) setsThisWeek += 1;
    }
  }
  const trainers = Object.entries(EXERCISE_MUSCLES).filter(([, ms]) => ms.includes(group)).map(([e]) => e);
  return { days, setsThisWeek, exercises: [...exercises], trainers };
}
