// Progression numbers for the Progress screen, computed from on-phone history.
// Cross-lift totals need one unit, so loads are converted to the user's display unit.
import { percentChange } from './progress.js';
import { estimate1RM } from './tools.js';

const KG_TO_LB = 2.20462;
const round1 = (n) => Math.round(n * 10) / 10;
const DAY = 86400000;

export const toUnit = (value, from, to) =>
  from === to ? value : round1(from === 'kg' ? value * KG_TO_LB : value / KG_TO_LB);

/** Rolling 7-day windows, oldest first: W1 ends 21 days ago ... Wn ends now. */
function windows(now, n) {
  const end = now.getTime();
  return Array.from({ length: n }, (_, i) => {
    const hi = end - (n - 1 - i) * 7 * DAY;
    return { label: `W${i + 1}`, lo: hi - 7 * DAY, hi };
  });
}

const sortedSets = (workouts) =>
  workouts
    .flatMap((w) => w.sets.map((s) => ({ ...s, t: new Date(w.startedAt).getTime() })))
    .sort((a, b) => a.t - b.t);

/** Best estimated 1RM per lift as of time `t` (inclusive), in `unit`. */
function bestByLift(sets, unit, t) {
  const best = {};
  for (const s of sets) {
    if (s.t > t) break;
    const e = estimate1RM(s);
    if (e === null) continue;
    const v = toUnit(e, s.unit, unit);
    if (!(best[s.exercise] >= v)) best[s.exercise] = v;
  }
  return best;
}
const sum = (o) => round1(Object.values(o).reduce((a, b) => a + b, 0));

/** "Total strength": sum of each lift's best e1RM to date, at the end of each week. */
export function weeklyStrength(workouts, unit, now = new Date(), n = 4) {
  const sets = sortedSets(workouts);
  return windows(now, n).map(({ label, hi }) => ({ label, total: sum(bestByLift(sets, unit, hi)) }));
}

export function weeklyVolume(workouts, unit, now = new Date(), n = 4) {
  const sets = sortedSets(workouts);
  return windows(now, n).map(({ label, lo, hi }) => ({
    label,
    volume: round1(sets.filter((s) => s.t > lo && s.t <= hi).reduce((v, s) => v + toUnit(s.weight * s.reps, s.unit, unit), 0)),
  }));
}

export function overview(workouts, unit, now = new Date()) {
  const sets = sortedSets(workouts);
  const win = windows(now, 4);
  const start = bestByLift(sets, unit, win[0].hi);
  const current = bestByLift(sets, unit, now.getTime());
  const strength = weeklyStrength(workouts, unit, now, 4);

  const top = Object.entries(current).sort((a, b) => b[1] - a[1])[0];
  const topLift = top ? { exercise: top[0], e1rm: top[1], delta: round1(top[1] - (start[top[0]] ?? top[1])) } : null;

  const vol = (lo, hi) => sets.filter((s) => s.t > lo && s.t <= hi).reduce((v, s) => v + toUnit(s.weight * s.reps, s.unit, unit), 0);
  const t = now.getTime();
  const volumeChangePct = percentChange(vol(t - 56 * DAY, t - 28 * DAY) || null, vol(t - 28 * DAY, t));

  const active = win.filter(({ lo, hi }) => sets.some((s) => s.t > lo && s.t <= hi)).length;
  const prSets = sets.filter((s) => s.pr && s.t > t - 28 * DAY);

  return {
    strength,
    strengthChangePct: strength[0].total ? percentChange(strength[0].total, strength[3].total) : null,
    topLift,
    volumeChangePct,
    consistency: { weeks: active, of: 4, pct: Math.round((active / 4) * 100) },
    prs: { count: prSets.length, newThisWeek: prSets.filter((s) => s.t > t - 7 * DAY).length },
  };
}
