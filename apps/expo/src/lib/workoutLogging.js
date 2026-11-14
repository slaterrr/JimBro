// A stale sheet or chat confirmation must never create or switch workouts.
export function appendWorkoutSet(data, set, workoutId) {
  if (!workoutId || data.active?.id !== workoutId) return data;
  return { ...data, active: { ...data.active, sets: [...data.active.sets, set] } };
}
