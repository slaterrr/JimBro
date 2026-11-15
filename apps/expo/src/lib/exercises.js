// The exercise library. `camera` comes from the analyzer registry (lib/analyzers.js), which also
// says how well each camera analyzer has been tested; manual exercises are logged by tapping.
// Metadata for planning and substitutions:
//   pattern  movement pattern (squat, hinge, lunge, horizontal_push, vertical_push, dip,
//            horizontal_pull, vertical_pull, elbow_flexion, elbow_extension, shoulder_abduction)
//   needs    equipment: every group must be satisfied by one of its items ('bodyweight' = none)
//   level    1 beginner-friendly, 2 intermediate, 3 needs strength or skill
// Muscles trained live in lib/muscles.js (EXERCISE_MUSCLES).
import { countsWithCamera } from './analyzers.js';

const LIBRARY = [
  { id: 'squat', name: 'Squat', pattern: 'squat', needs: [['barbell', 'bodyweight']], level: 2 },
  { id: 'bench', name: 'Bench press', pattern: 'horizontal_push', needs: [['barbell'], ['bench']], level: 2 },
  { id: 'deadlift', name: 'Deadlift', pattern: 'hinge', needs: [['barbell']], level: 3 },
  { id: 'shoulder_press', name: 'Shoulder press', pattern: 'vertical_push', needs: [['barbell', 'dumbbells']], level: 2 },
  { id: 'pull_up', name: 'Pull-up', pattern: 'vertical_pull', needs: [['pullup_bar']], level: 3 },
  { id: 'lunge', name: 'Lunge', pattern: 'lunge', needs: [['bodyweight', 'dumbbells']], level: 1 },
  { id: 'push_up', name: 'Push-up', pattern: 'horizontal_push', needs: [['bodyweight']], level: 1 },
  { id: 'dumbbell_bench', name: 'Dumbbell bench press', pattern: 'horizontal_push', needs: [['dumbbells'], ['bench']], level: 1 },
  { id: 'goblet_squat', name: 'Goblet squat', pattern: 'squat', needs: [['dumbbells', 'kettlebell']], level: 1 },
  { id: 'romanian_deadlift', name: 'Romanian deadlift', pattern: 'hinge', needs: [['barbell', 'dumbbells']], level: 2 },
  { id: 'bent_over_row', name: 'Bent-over row', pattern: 'horizontal_pull', needs: [['barbell', 'dumbbells']], level: 2 },
  { id: 'seated_cable_row', name: 'Seated cable row', pattern: 'horizontal_pull', needs: [['cable']], level: 1 },
  { id: 'lat_pulldown', name: 'Lat pulldown', pattern: 'vertical_pull', needs: [['cable', 'machine']], level: 1 },
  { id: 'chin_up', name: 'Chin-up', pattern: 'vertical_pull', needs: [['pullup_bar']], level: 2 },
  { id: 'dips', name: 'Dips', pattern: 'dip', needs: [['dip_bars']], level: 2 },
  { id: 'hammer_curl', name: 'Hammer curl', pattern: 'elbow_flexion', needs: [['dumbbells']], level: 1 },
  { id: 'lateral_raise', name: 'Lateral raise', pattern: 'shoulder_abduction', needs: [['dumbbells', 'cable']], level: 1 },
  { id: 'tricep_pushdown', name: 'Tricep pushdown', pattern: 'elbow_extension', needs: [['cable']], level: 1 },
];

export const EXERCISES = LIBRARY.map(({ id, name }) => ({ id, name, camera: countsWithCamera(id) }));

const INFO = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));
/** Library metadata for an exercise, or null. */
export const exerciseInfo = (id) => INFO[id] ?? null;

/** True when `equipment` (ids the user has) covers every equipment group the exercise needs. */
export const canDo = (id, equipment = []) => {
  const info = INFO[id];
  if (!info) return false;
  const have = new Set(['bodyweight', ...equipment]);
  return info.needs.every((group) => group.some((x) => have.has(x)));
};

export const exerciseName = (id) => id === 'curl' || id === 'bicep_curl' ? 'Bicep curl' : EXERCISES.find((e) => e.id === id)?.name ?? id;
