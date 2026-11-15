import { exerciseName } from './exercises.js';
import { EXERCISE_MUSCLES } from './muscles.js';
import { toUnit } from './stats.js';

// One point per workout. Never add different exercises or loaded/unweighted sets together.
export function muscleProgress(workouts, group, unit = 'lb') {
  const series = new Map();
  const ordered = [...workouts].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  for (const w of ordered) {
    const best = new Map();
    for (const s of w.sets ?? []) {
      if (!(EXERCISE_MUSCLES[s.exercise] ?? []).includes(group)) continue;
      if (!Number.isFinite(s.reps) || s.reps <= 0 || !Number.isFinite(s.weight) || s.weight < 0) continue;
      const loaded = s.weight > 0;
      if (loaded && !['lb', 'kg'].includes(s.unit)) continue;
      const key = `${s.exercise}:${loaded ? 'loaded' : 'unweighted'}`;
      const value = loaded ? Math.round(toUnit(s.weight, s.unit, unit) * s.reps) : s.reps;
      if (!series.has(key)) series.set(key, {
        key, exercise: s.exercise, name: exerciseName(s.exercise),
        metric: loaded ? `Best set volume (${unit} × reps)` : 'Most reps in one unweighted set',
        points: [],
      });
      best.set(key, Math.max(best.get(key) ?? 0, value));
    }
    for (const [key, value] of best) series.get(key).points.push({
      label: new Date(w.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      date: w.startedAt, workoutId: w.id, value,
    });
  }
  return [...series.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
