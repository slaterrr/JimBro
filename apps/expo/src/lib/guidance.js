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

export function cameraGuidance(issue, hint, movement) {
  switch (issue) {
    case 'tracking': return `Tracking paused. ${PART[hint] ?? PART.body}`;
    case 'framing': return movement === 'squat'
      ? 'Step back — your shoulders, hips and feet need to be in frame to count reps.'
      : 'Step back — your shoulders and hips need to be in frame to count reps.';
    case 'implausible_motion': return 'Tracking jumped — rep paused. Hold steady with only you in frame.';
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
