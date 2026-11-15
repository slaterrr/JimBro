const TARGETS = {
  reps: { max: 25, initial: 12 },
  sets: { max: 10, initial: 4 },
};
const NO_SET_TARGET = new Set(['deadlift', 'shoulder_press', 'pull_up']);

export const showSetTarget = (exercise) => !NO_SET_TARGET.has(exercise);
export const targetMaximum = (kind) => TARGETS[kind].max;

export function workoutTarget(kind, value) {
  const { max, initial } = TARGETS[kind];
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : initial;
}

export function valueAt(position, width, max) {
  const fraction = Math.min(1, Math.max(0, position / width));
  return 1 + Math.round(fraction * (max - 1));
}
