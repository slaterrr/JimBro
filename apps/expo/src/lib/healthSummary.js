// One-line weekly health summary for Home, built only from what was logged on this phone.
import { weeklyCheckIn } from './goals.js';

const DAY = 86400000;
const EMPTY_TEXT = 'No workouts yet this week — start one below';

/** Monday 00:00 UTC of the week containing t (same convention as goals.js/progress.js). */
function weekStart(t) {
  const d = new Date(t);
  const x = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
}

/** { empty, sessions, cameraReps, consistency: {done, perWeek} | null, nextStep, text } */
export function healthSummary(state = {}, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : now;
  const lo = weekStart(t);
  const workouts = [...(state.history ?? []), ...(state.active?.sets?.length ? [state.active] : [])];
  const week = workouts.filter((w) => { const x = new Date(w.startedAt).getTime(); return x >= lo && x <= t; });
  const sessions = week.length;
  const cameraReps = week.flatMap((w) => w.sets).filter((s) => s.source === 'camera').reduce((a, s) => a + s.reps, 0);
  const goal = (state.goals ?? []).find((g) => g?.type === 'consistency');
  const consistency = goal ? { done: sessions, perWeek: goal.perWeek } : null;
  if (!sessions) return { empty: true, sessions, cameraReps, consistency, nextStep: null, text: EMPTY_TEXT };
  const nextStep = weeklyCheckIn(state, t).suggestion;
  const parts = [
    `${sessions} session${sessions === 1 ? '' : 's'}`,
    `${cameraReps} camera-verified reps`,
    ...(consistency ? [`consistency goal ${consistency.done}/${consistency.perWeek}`] : []),
    `next step: ${nextStep}`,
  ];
  return { empty: false, sessions, cameraReps, consistency, nextStep, text: `This week: ${parts.join(' · ')}` };
}
