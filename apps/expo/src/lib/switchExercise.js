// What the Coach screen offers when the camera thinks the user switched exercise.
// Camera-countable suggestion: switch the live counter (logging reps already counted first).
// Anything else (e.g. lunge): offer to log it by hand with +, or keep the current lift.
import { EXERCISES, exerciseName } from './exercises.js';

const plural = (id) => {
  const n = exerciseName(id).toLowerCase();
  return n.endsWith('s') ? `${n}es` : `${n}s`;
};

/** { kind: 'camera'|'manual', logFirst, label, actions: [{ id, label }] } or null. */
export function switchPlan({ current, suggested, counted = 0 } = {}) {
  if (!suggested || suggested === current) return null;
  const camera = EXERCISES.some((e) => e.id === suggested && e.camera);
  const name = exerciseName(suggested);
  const keep = { id: 'keep', label: `Keep ${exerciseName(current)}` };
  return {
    kind: camera ? 'camera' : 'manual',
    logFirst: counted > 0,
    label: `Looks like ${name}. Switch?`,
    actions: camera
      ? [{ id: 'switch', label: `Switch to ${name}` }, keep]
      : [{ id: 'log', label: `Log ${plural(suggested)} with +` }, keep],
  };
}
