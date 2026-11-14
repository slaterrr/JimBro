// History comparisons for the Progress screen: session vs previous session of a lift,
// and month-to-month / year-to-year totals. All loads are shown in the user's unit.
// Bodyweight sets (weight 0) add no volume and have no e1RM; that is reported, not guessed.
import { exerciseName } from './exercises.js';
import { percentChange } from './progress.js';
import { toUnit } from './stats.js';
import { estimate1RM } from './tools.js';

const round1 = (n) => Math.round(n * 10) / 10;
const time = (w) => new Date(w.startedAt).getTime();
const shortDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const signedPct = (v) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${v}%`);

export const historyNewestFirst = (workouts) => [...workouts].sort((a, b) => time(b) - time(a));

const volumeOf = (sets, unit) => round1(sets.reduce((v, s) => v + toUnit(s.weight * s.reps, s.unit, unit), 0));
const bestE1rm = (sets, unit) => {
  const vals = sets.map((s) => {
    const e = estimate1RM(s);
    return e === null ? null : toUnit(e, s.unit, unit);
  }).filter((v) => v !== null);
  return vals.length ? Math.max(...vals) : null;
};

export const workoutVolume = (w, unit) => volumeOf(w.sets, unit);

function sessionStats(w, exercise, unit) {
  const sets = w.sets.filter((s) => s.exercise === exercise);
  return {
    id: w.id,
    date: w.startedAt,
    label: shortDate(w.startedAt),
    sets: sets.length,
    topWeight: Math.max(...sets.map((s) => toUnit(s.weight, s.unit, unit))),
    e1rm: bestE1rm(sets, unit),
    volume: volumeOf(sets, unit),
  };
}

/** Latest session of `exercise` vs the session before it; null if never logged. */
export function compareSessions(workouts, exercise, unit = 'lb') {
  const withLift = historyNewestFirst(workouts).filter((w) => w.sets.some((s) => s.exercise === exercise));
  if (!withLift.length) return null;
  const current = sessionStats(withLift[0], exercise, unit);
  const name = exerciseName(exercise);
  if (withLift.length < 2) {
    return { exercise, current, previous: null, change: null, text: `${name} ${current.label}: first session logged, nothing to compare yet.` };
  }
  const previous = sessionStats(withLift[1], exercise, unit);
  const change = {
    topWeightPct: percentChange(previous.topWeight || null, current.topWeight),
    e1rmPct: percentChange(previous.e1rm, current.e1rm),
    volumePct: percentChange(previous.volume || null, current.volume),
  };
  const parts = [
    change.topWeightPct !== null ? `${signedPct(change.topWeightPct)} weight` : null,
    change.e1rmPct !== null ? `${signedPct(change.e1rmPct)} est. 1RM` : null,
    change.volumePct !== null ? `${signedPct(change.volumePct)} volume` : null,
  ].filter(Boolean);
  const text = `${name} ${current.label} vs ${previous.label}: ${parts.length ? parts.join(', ') : 'bodyweight sets, compare reps in the history list'}`;
  return { exercise, current, previous, change, text };
}

function periodBounds(period, d) {
  if (period === 'year') {
    const y = d.getFullYear();
    return { lo: new Date(y, 0, 1).getTime(), hi: new Date(y + 1, 0, 1).getTime(), label: String(y) };
  }
  const lo = new Date(d.getFullYear(), d.getMonth(), 1);
  return {
    lo: lo.getTime(),
    hi: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    label: lo.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  };
}

function periodStats(workouts, bounds, unit) {
  const ws = workouts.filter((w) => time(w) >= bounds.lo && time(w) < bounds.hi);
  if (!ws.length) return null;
  const sets = ws.flatMap((w) => w.sets);
  const lifts = [...new Set(sets.map((s) => s.exercise))];
  const perLift = Object.fromEntries(lifts.map((ex) => {
    const exSets = sets.filter((s) => s.exercise === ex);
    return [ex, {
      bestE1rm: bestE1rm(exSets, unit),
      volume: volumeOf(exSets, unit),
      sessions: ws.filter((w) => w.sets.some((s) => s.exercise === ex)).length,
    }];
  }));
  const strength = Object.values(perLift).reduce((t, p) => t + (p.bestE1rm ?? 0), 0);
  return { label: bounds.label, sessions: ws.length, volume: volumeOf(sets, unit), bestE1rmTotal: round1(strength), perLift };
}

/**
 * Period containing `now` vs the one before (period: 'month' | 'year').
 * previous/change are null when the earlier period has no workouts.
 */
export function comparePeriods(workouts, { period = 'month', now = new Date(), unit = 'lb' } = {}) {
  const cur = periodBounds(period, now);
  const prevAnchor = period === 'year' ? new Date(now.getFullYear() - 1, 0, 1) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = periodBounds(period, prevAnchor);
  const current = periodStats(workouts, cur, unit) ?? { label: cur.label, sessions: 0, volume: 0, bestE1rmTotal: 0, perLift: {} };
  const previous = periodStats(workouts, prev, unit);

  const lifts = [...new Set([...Object.keys(current.perLift), ...Object.keys(previous?.perLift ?? {})])];
  const exercises = lifts.map((ex) => {
    const c = current.perLift[ex] ?? null;
    const p = previous?.perLift[ex] ?? null;
    return {
      exercise: ex,
      current: c,
      previous: p,
      change: c && p ? { e1rmPct: percentChange(p.bestE1rm, c.bestE1rm), volumePct: percentChange(p.volume || null, c.volume) } : null,
    };
  });

  if (!previous) {
    return { period, current, previous: null, change: null, exercises, text: `No data for ${prev.label} to compare against.` };
  }
  const change = {
    volumePct: percentChange(previous.volume || null, current.volume),
    e1rmPct: percentChange(previous.bestE1rmTotal || null, current.bestE1rmTotal),
    sessionsPct: percentChange(previous.sessions, current.sessions),
  };
  const text = `${current.label} vs ${previous.label}: ${current.sessions} vs ${previous.sessions} sessions, volume ${signedPct(change.volumePct)}`;
  return { period, current, previous, change, exercises, text };
}
