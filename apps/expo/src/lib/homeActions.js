// Home screen copy and the "Start a Workout" choice (pure, so it is unit-tested).
import { programNext } from './program.js';

export const HOME_SUBTITLE = 'Your AI gym bro. Tell me what you want to work on today.';

export const HOME_OPTIONS = [
  { id: 'start', icon: 'play-circle-outline', label: 'Start a\nWorkout' },
  { id: 'plan', icon: 'clipboard-list-outline', label: 'Create a\nNew Plan' },
  { id: 'progress', icon: 'chart-line', label: 'Review My\nProgress' },
];

const PLAN_DAY = /^Plan day (\d+)$/;

/** Next workout to start: the saved plan's day after the last one done, else a quick workout. */
export function nextWorkout(plan, history = []) {
  if (plan?.program) {
    const next = programNext(plan.program, history);
    return next.done ? { name: 'Quick workout', planned: null, blockComplete: true } : { name: next.name, planned: next.planned };
  }
  if (!plan?.days?.length) return { name: 'Quick workout', planned: null };
  let last = 0;
  for (const w of history) {
    const m = PLAN_DAY.exec(w.name ?? '');
    if (m) last = Number(m[1]);
  }
  const i = last % plan.days.length;
  return { name: `Plan day ${plan.days[i].day ?? i + 1}`, planned: plan.days[i] };
}
