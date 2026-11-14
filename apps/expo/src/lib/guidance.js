// What Jim tells the user when the camera can't count. Every issue LiveSession can raise has a
// specific, actionable line, so counting never pauses silently. Neutral wording: the camera is
// uncertain, the user did nothing wrong.
const PART = {
  feet: 'Step back so your feet are in frame.',
  knees: 'Step back so your knees and feet are in frame.',
  hips: 'Step back so your hips are in frame.',
  arm: 'Turn so your working arm is visible to the camera.',
  body: 'Step back so your whole body is in frame, in good light.',
};

const NAME = { curl: 'curls', squat: 'squats', shoulder_press: 'shoulder presses', push_up: 'push-ups', pull_up: 'pull-ups', deadlift: 'deadlifts' };
const SINGULAR = { curls: 'curl', squats: 'squat', 'shoulder presses': 'shoulder press', 'push-ups': 'push-up', 'pull-ups': 'pull-up', deadlifts: 'deadlift' };

export function cameraGuidance(issue, hint, movement) {
  switch (issue) {
    case 'tracking': return `Tracking paused. ${PART[hint] ?? PART.body}`;
    case 'framing': return movement === 'squat'
      ? 'Step back — your shoulders, hips and feet need to be in frame to count reps.'
      : 'Step back — your shoulders and hips need to be in frame to count reps.';
    case 'implausible_motion': return 'Tracking jumped — rep paused. Hold steady with only you in frame.';
    case 'exercise_change':
      if (movement === 'push_up') {
        if (hint === 'upright') return 'Push-up counting is paused. Get into a plank with your hands on the floor to count push-ups.';
        if (NAME[hint]) return `Looks like ${NAME[hint]}, so push-up counting is paused. Switch to ${NAME[hint]} to count them.`;
        return 'Looks like a different exercise, so push-up counting is paused.';
      }
      if (movement === 'pull_up' && hint === 'hang') return 'Pull-up counting is paused. Hang from the bar facing the camera, arms overhead.';
      if ((movement === 'pull_up' || movement === 'deadlift') && NAME[hint]) {
        return `Looks like ${NAME[hint]}, so ${SINGULAR[NAME[movement]]} counting is paused. Switch to ${NAME[hint]} to count them.`;
      }
      if (hint === 'push_up') return `Looks like push-ups, so ${SINGULAR[NAME[movement]] ?? 'rep'} counting is paused. Switch to push-ups to count them.`;
      if (hint === 'lunge') return 'Looks like lunges, so squat counting is paused. Switch to lunges (experimental) to count them, or go back to squats.';
      if (hint === 'shoulder_press') return 'Looks like shoulder presses, so curl counting is paused. Switch to shoulder press to count them.';
      if (hint === 'curl') return 'Looks like curls, so shoulder press counting is paused. Switch to curls to count them.';
      return `Looks like a different exercise, so ${SINGULAR[NAME[movement]] ?? 'rep'} counting is paused.`;
    case 'arm_swing': return 'Upper arm moved too far — rep not counted. Keep your elbow near your side.';
    default: return null;
  }
}

/** Returns a function (key, tMs) → true when this guidance should be spoken now. */
export function guidanceThrottle(gapMs = 8000) {
  const last = new Map();
  return (key, t) => {
    const prev = last.get(key);
    if (prev !== undefined && t - prev < gapMs) return false;
    last.set(key, t);
    return true;
  };
}
