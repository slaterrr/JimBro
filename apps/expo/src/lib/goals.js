// Measurable goals checked against the workouts actually logged on this phone.
// Pure functions: workouts are [{ startedAt, planned?, sets: [{exercise, weight, unit, reps, rpe, source, pr}] }].
import { exerciseName } from './exercises.js';
import { EXERCISE_MUSCLES, MUSCLE_GROUPS } from './muscles.js';
import { toUnit } from './stats.js';
import { estimate1RM } from './tools.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
const round1 = (n) => Math.round(n * 10) / 10;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const pctOf = (cur, target) => (target > 0 ? Math.min(100, Math.round((cur / target) * 100)) : 0);

export const GOAL_TYPES = [
  ['strength', 'Strength'],
  ['consistency', 'Consistency'],
  ['volume', 'Volume'],
  ['reps', 'Reps'],
];

/** Stored goals from older saves: missing or malformed -> []. */
export const migrateGoals = (goals) =>
  Array.isArray(goals) ? goals.filter((g) => g && typeof g.id === 'string' && typeof g.type === 'string') : [];

/** Monday 00:00 UTC of the week containing t (same convention as progress.js). */
function weekStart(t) {
  const d = new Date(t);
  const x = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
}

const flatSets = (workouts) =>
  workouts.flatMap((w) => w.sets.map((s) => ({ ...s, t: new Date(s.loggedAt ?? w.startedAt).getTime() })));

/** Four rolling 7-day windows ending at now, oldest first. */
const windows = (now) => [3, 2, 1, 0].map((k) => ({ x: 3 - k, lo: now - (k + 1) * WEEK, hi: now - k * WEEK }));

/** Least-squares slope (units per week) over [{x, y}]. */
function slope(points) {
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den ? points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / den : 0;
}

/** onTrack/projectedDate from weekly points; honest null with < 2 points. */
function project(points, current, target, now, deadline) {
  if (current >= target) return { onTrack: true, projectedDate: null };
  if (points.length < 2) return { onTrack: null, projectedDate: null };
  const s = slope(points);
  if (s <= 0) return { onTrack: false, projectedDate: null };
  const date = iso(now + Math.ceil(((target - current) / s) * 7) * DAY);
  return { onTrack: deadline ? date <= deadline : true, projectedDate: date };
}

function strength(goal, sets, now) {
  const value = (s) => (goal.metric === 'weight' ? s.weight : estimate1RM(s));
  const mine = sets
    .filter((s) => s.exercise === goal.exercise && s.t <= now)
    .map((s) => ({ ...s, v: value(s) === null ? null : toUnit(value(s), s.unit, goal.unit) }))
    .filter((s) => s.v !== null);
  const name = exerciseName(goal.exercise);
  const label = goal.metric === 'weight' ? 'top set' : 'est. 1RM';
  if (!mine.length) {
    return { current: 0, points: [], evidence: `No ${name.toLowerCase()} sets logged yet.`, nextStep: `Log a ${name.toLowerCase()} set (10 reps or fewer) to get a baseline.` };
  }
  const best = mine.reduce((b, s) => (s.v > b.v ? s : b));
  const points = windows(now)
    .map(({ x, lo, hi }) => {
      const vs = mine.filter((s) => s.t > lo && s.t <= hi).map((s) => s.v);
      return vs.length ? { x, y: Math.max(...vs) } : null;
    })
    .filter(Boolean);
  const gap = round1(goal.target - best.v);
  return {
    current: best.v,
    points,
    evidence: `Best ${label} ${best.v} ${goal.unit} from ${best.weight} ${best.unit} × ${best.reps} on ${iso(best.t)}.`,
    nextStep: gap <= 0
      ? `Goal reached. Set a new target above ${best.v} ${goal.unit}.`
      : `${gap} ${goal.unit} to go: add a small load step after an easy set (RPE 7 or lower) of ${name.toLowerCase()}.`,
  };
}

function weekCounts(workouts) {
  const counts = new Map();
  for (const w of workouts) {
    const k = weekStart(new Date(w.startedAt).getTime());
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function consistency(goal, workouts, now) {
  const counts = weekCounts(workouts.filter((w) => new Date(w.startedAt).getTime() <= now));
  const thisWeek = weekStart(now);
  const n = (k) => counts.get(k) ?? 0;
  let cur = n(thisWeek) >= goal.perWeek ? thisWeek : thisWeek - WEEK; // this week isn't over yet
  let streak = 0;
  while (n(cur) >= goal.perWeek) { streak += 1; cur -= WEEK; }
  const left = Math.max(0, goal.perWeek - n(thisWeek));
  const weeksWithData = [...counts.keys()].filter((k) => k > thisWeek - 4 * WEEK).length;
  let onTrack = null;
  if (streak >= goal.weeks) onTrack = true;
  else if (weeksWithData >= 2) onTrack = n(thisWeek) >= goal.perWeek || n(thisWeek - WEEK) >= goal.perWeek;
  return {
    current: Math.min(streak, goal.weeks),
    target: goal.weeks,
    onTrack,
    projectedDate: onTrack && streak < goal.weeks ? iso(thisWeek + (goal.weeks - streak + (n(thisWeek) >= goal.perWeek ? 0 : 1)) * WEEK - DAY) : null,
    evidence: counts.size
      ? `${n(thisWeek)} workouts this week, ${n(thisWeek - WEEK)} last week; ${streak} week streak at ${goal.perWeek}+/week.`
      : 'No workouts logged yet.',
    nextStep: left ? `${left} more workout${left > 1 ? 's' : ''} this week keeps the streak going.` : 'This week is done. Rest, then keep the rhythm next week.',
  };
}

function volume(goal, sets, now) {
  const hits = (s) => (goal.muscle ? (EXERCISE_MUSCLES[s.exercise] ?? []).includes(goal.muscle) : s.exercise === goal.exercise);
  const mine = sets.filter((s) => hits(s) && s.t <= now);
  const vol = (lo, hi) => round1(mine.filter((s) => s.t > lo && s.t <= hi).reduce((v, s) => v + toUnit(s.weight * s.reps, s.unit, goal.unit), 0));
  const current = vol(now - WEEK, now);
  const points = windows(now).filter(({ lo, hi }) => mine.some((s) => s.t > lo && s.t <= hi)).map(({ x, lo, hi }) => ({ x, y: vol(lo, hi) }));
  const what = goal.muscle ? (MUSCLE_GROUPS.find((m) => m.id === goal.muscle)?.name ?? goal.muscle) : exerciseName(goal.exercise);
  const nSets = mine.filter((s) => s.t > now - WEEK).length;
  const gap = round1(goal.target - current);
  return {
    current,
    points,
    evidence: `${what}: ${current} ${goal.unit} over the last 7 days from ${nSets} set${nSets === 1 ? '' : 's'}.`,
    nextStep: gap <= 0 ? `Weekly target hit. Hold it, don't chase more.` : `${gap} ${goal.unit} short: add 1-2 working sets for ${what.toLowerCase()} this week.`,
  };
}

function reps(goal, sets, now) {
  const mine = sets.filter((s) => s.exercise === goal.exercise && s.t <= now && (!goal.cameraOnly || s.source === 'camera'));
  const name = exerciseName(goal.exercise).toLowerCase();
  const kind = goal.cameraOnly ? 'camera-verified ' : '';
  const points = windows(now)
    .map(({ x, lo, hi }) => {
      const r = mine.filter((s) => s.t > lo && s.t <= hi).map((s) => s.reps);
      return r.length ? { x, y: Math.max(...r) } : null;
    })
    .filter(Boolean);
  if (!mine.length) {
    return { current: 0, points, evidence: `No ${kind}${name} sets yet.`, nextStep: goal.cameraOnly ? `Do a ${name} set with the camera on so reps are counted.` : `Log a ${name} set.` };
  }
  const best = mine.reduce((b, s) => (s.reps > b.reps ? s : b));
  const cams = mine.filter((s) => s.source === 'camera').length;
  const gap = goal.target - best.reps;
  return {
    current: best.reps,
    points,
    evidence: `Best ${kind}set: ${best.reps} reps @ ${best.weight} ${best.unit} on ${iso(best.t)} (${cams} of ${mine.length} sets camera-counted).`,
    nextStep: gap <= 0 ? 'Goal reached. Raise the target or the weight.' : `${gap} reps to go: aim for ${Math.min(goal.target, best.reps + 2)} clean reps next ${name} set.`,
  };
}

/** Progress for one goal: { pct, current, target, onTrack, projectedDate, evidence, nextStep }. */
export function goalProgress(goal, workouts, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : now;
  if (goal.type === 'consistency') {
    const r = consistency(goal, workouts, t);
    return { pct: pctOf(r.current, r.target), ...r };
  }
  const sets = flatSets(workouts);
  const fn = { strength, volume, reps }[goal.type];
  if (!fn) return { pct: 0, current: 0, target: goal.target ?? 0, onTrack: null, projectedDate: null, evidence: 'Unknown goal type.', nextStep: 'Remove this goal.' };
  const r = fn(goal, sets, t);
  const { onTrack, projectedDate } = project(r.points, r.current, goal.target, t, goal.deadline);
  return { pct: pctOf(r.current, goal.target), current: r.current, target: goal.target, onTrack, projectedDate, evidence: r.evidence, nextStep: r.nextStep };
}

const thisWeekOf = (workouts, t) => {
  const s = weekStart(t);
  return workouts.filter((w) => { const x = new Date(w.startedAt).getTime(); return x >= s && x < s + WEEK && x <= t; });
};

/** Saved weekly plan vs this (Mon-Sun UTC) week's workouts. null without a plan. */
export function planAdherence(plan, workouts, now = new Date()) {
  if (!plan?.days?.length) return null;
  const t = now instanceof Date ? now.getTime() : now;
  const week = thisWeekOf(workouts, t).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const assigned = new Map(); // day number -> workout
  for (const w of week) {
    let day = w.planned?.day && !assigned.has(w.planned.day) ? w.planned.day : null;
    if (!day) {
      const ex = new Set(w.sets.map((s) => s.exercise));
      let best = 0;
      for (const d of plan.days) {
        if (assigned.has(d.day)) continue;
        const overlap = d.items.filter((i) => ex.has(i.exercise)).length;
        if (overlap > best) { best = overlap; day = d.day; }
      }
    }
    if (day) assigned.set(day, w);
  }
  const done = [];
  const missed = [];
  const days = plan.days.map((d) => {
    const w = assigned.get(d.day);
    const items = d.items.map((i) => {
      const logged = w ? w.sets.filter((s) => s.exercise === i.exercise).length : 0;
      const item = { day: d.day, exercise: i.exercise, plannedSets: i.sets, loggedSets: logged, done: logged >= i.sets };
      (item.done ? done : missed).push(item);
      return item;
    });
    return { day: d.day, done: Boolean(w), workoutId: w?.id ?? null, items };
  });
  return { planned: plan.days.length, completed: assigned.size, extra: week.length - assigned.size, days, done, missed };
}

/** Short, data-only weekly summary: { hasData, wins, misses, suggestion, adherence }. */
export function weeklyCheckIn(state, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : now;
  const workouts = [...(state.history ?? []), ...(state.active?.sets?.length ? [state.active] : [])];
  const adherence = planAdherence(state.plan, workouts, t);
  if (!workouts.length) {
    return { hasData: false, wins: [], misses: [], suggestion: 'Log your first workout to start your check-in.', adherence };
  }
  const week = thisWeekOf(workouts, t);
  const sets = week.flatMap((w) => w.sets);
  const wins = [];
  const misses = [];
  if (week.length) wins.push(`${week.length} workout${week.length > 1 ? 's' : ''} and ${sets.length} sets this week.`);
  else misses.push('No workouts logged yet this week.');
  const prs = sets.filter((s) => s.pr).length;
  if (prs) wins.push(`${prs} personal record${prs > 1 ? 's' : ''} set.`);
  const cam = sets.filter((s) => s.source === 'camera');
  if (cam.length) wins.push(`${cam.reduce((a, s) => a + s.reps, 0)} camera-verified reps across ${cam.length} sets.`);
  if (adherence) {
    if (adherence.completed >= adherence.planned) wins.push(`All ${adherence.planned} planned sessions done.`);
    else misses.push(`${adherence.completed} of ${adherence.planned} planned sessions done.`);
  }
  const progress = migrateGoals(state.goals).map((g) => ({ g, p: goalProgress(g, workouts, t) }));
  for (const { g, p } of progress) {
    if (p.pct >= 100) wins.push(`Goal reached: ${describeGoal(g)}.`);
    else if (p.onTrack === false) misses.push(`Off track: ${describeGoal(g)} (${p.pct}%).`);
  }
  const off = progress.find(({ p }) => p.onTrack === false) ?? progress.find(({ p }) => p.pct < 100);
  const nextMissed = adherence?.missed[0];
  const suggestion = off
    ? off.p.nextStep
    : nextMissed
      ? `Next planned: day ${nextMissed.day}, ${exerciseName(nextMissed.exercise).toLowerCase()} ${nextMissed.plannedSets} sets.`
      : week.length
        ? 'Keep the same rhythm next week.'
        : 'Log a workout this week to keep your streak.';
  return { hasData: true, wins, misses, suggestion, adherence };
}

/** Human label for a goal. */
export function describeGoal(g) {
  switch (g.type) {
    case 'strength': return `${exerciseName(g.exercise)} ${g.metric === 'weight' ? 'top set' : 'est. 1RM'} ${g.target} ${g.unit}${g.deadline ? ` by ${g.deadline}` : ''}`;
    case 'consistency': return `${g.perWeek} workouts/week for ${g.weeks} weeks`;
    case 'volume': return `${g.muscle ? (MUSCLE_GROUPS.find((m) => m.id === g.muscle)?.name ?? g.muscle) : exerciseName(g.exercise)} ${g.target} ${g.unit}/week`;
    case 'reps': return `${g.target} ${g.cameraOnly ? 'camera-verified ' : ''}${exerciseName(g.exercise).toLowerCase()} reps in one set`;
    default: return 'Goal';
  }
}
