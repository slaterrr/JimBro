export const EXERCISES = [
  { id: 'curl', name: 'Bicep curl', camera: true },
  { id: 'squat', name: 'Squat', camera: true },
  { id: 'bench', name: 'Bench press', camera: false },
  { id: 'deadlift', name: 'Deadlift', camera: false },
  { id: 'shoulder_press', name: 'Shoulder press', camera: true },
  { id: 'pull_up', name: 'Pull-up', camera: false },
  { id: 'lunge', name: 'Lunge', camera: false },
  { id: 'push_up', name: 'Push-up', camera: true },
];

export const exerciseName = (id) => EXERCISES.find((e) => e.id === id)?.name ?? id;
