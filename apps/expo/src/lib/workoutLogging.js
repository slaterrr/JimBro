// A stale sheet or chat confirmation must never create or switch workouts.
import { isRetiredExercise } from './retiredExercises.js';
export function appendWorkoutSet(data, set, workoutId) {
  if (!workoutId || data.active?.id !== workoutId || isRetiredExercise(set?.exercise)) return data;
  return { ...data, active: { ...data.active, sets: [...data.active.sets, set] } };
}
