// The exercise library. `camera` comes from the analyzer registry (lib/analyzers.js), which also
// says how well each camera analyzer has been tested; manual exercises are logged by tapping.
import { countsWithCamera } from './analyzers.js';

const LIBRARY = [
  { id: 'curl', name: 'Bicep curl' },
  { id: 'squat', name: 'Squat' },
  { id: 'bench', name: 'Bench press' },
  { id: 'deadlift', name: 'Deadlift' },
  { id: 'shoulder_press', name: 'Shoulder press' },
  { id: 'pull_up', name: 'Pull-up' },
  { id: 'lunge', name: 'Lunge' },
  { id: 'push_up', name: 'Push-up' },
];

export const EXERCISES = LIBRARY.map((e) => ({ ...e, camera: countsWithCamera(e.id) }));

export const exerciseName = (id) => EXERCISES.find((e) => e.id === id)?.name ?? id;
