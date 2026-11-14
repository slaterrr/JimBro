// Suggested recovery between sets; users can extend or skip the timer.
export function restSeconds(exercise, reps = 8) {
  if (['squat', 'bench', 'deadlift'].includes(exercise)) return reps <= 5 ? 180 : 150;
  if (['shoulder_press', 'pull_up'].includes(exercise)) return reps <= 5 ? 150 : 120;
  return reps <= 5 ? 90 : 60;
}
