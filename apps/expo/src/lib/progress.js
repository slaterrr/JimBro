// Progress from on-phone history. Units are never mixed; % change uses the first
// comparable session as the denominator and is undefined when that value is zero.
// workouts: [{ startedAt, sets: [{exercise, weight, unit, reps, rpe, reps_detail?}] }]

export const percentChange = (first, last) =>
  first === null || first === undefined || last === null || last === undefined || first === 0
    ? null
    : Math.round(((last - first) / first) * 1000) / 10;

const tutOf = (s) =>
  s.reps_detail?.length
    ? s.reps_detail.reduce((t, r) => t + r.concentric_ms + r.peak_pause_ms + r.eccentric_ms, 0) / s.reps_detail.length
    : null;

export function trend(workouts, exercise) {
  const byUnit = {};
  for (const w of [...workouts].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const sets = w.sets.filter((s) => s.exercise === exercise && s.reps > 0 && Number.isFinite(s.weight) && s.weight >= 0);
    for (const unit of new Set(sets.map((s) => s.unit))) {
      const u = sets.filter((s) => s.unit === unit);
      const tuts = u.map(tutOf).filter((x) => x !== null);
      (byUnit[unit] ??= []).push({
        date: w.startedAt.slice(0, 10),
        top_weight: Math.max(...u.map((s) => s.weight)),
        volume: u.reduce((t, s) => t + s.weight * s.reps, 0),
        reps: u.reduce((t, s) => t + s.reps, 0),
        avg_tut_ms: tuts.length ? Math.round(tuts.reduce((a, b) => a + b, 0) / tuts.length) : null,
      });
    }
  }
  const out = {};
  for (const [unit, points] of Object.entries(byUnit)) {
    const [a, b] = [points[0], points[points.length - 1]];
    const many = points.length > 1;
    out[unit] = {
      points,
      best_logged_weight: points.reduce((best, point) => Math.max(best, point.top_weight), 0),
      top_weight_change_pct: many ? percentChange(a.top_weight, b.top_weight) : null,
      volume_change_pct: many ? percentChange(a.volume, b.volume) : null,
      tut_change_pct: many ? percentChange(a.avg_tut_ms, b.avg_tut_ms) : null,
    };
  }
  return out;
}

/** Records per (exercise, unit). With `candidate`, also says whether it beats them. */
export function personalRecords(workouts, candidate = null) {
  const groups = new Map();
  for (const s of workouts.flatMap((w) => w.sets)) {
    const key = `${s.exercise}|${s.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const [key, sets] of groups) {
    const [exercise, unit] = key.split('|');
    const heaviest = sets.reduce((b, s) => (s.weight > b.weight || (s.weight === b.weight && s.reps > b.reps) ? s : b));
    const most_reps = sets.reduce((b, s) => (s.reps > b.reps ? s : b));
    const best_set_volume = Math.max(...sets.map((s) => s.weight * s.reps));
    const rec = { exercise, unit, heaviest, most_reps, best_set_volume };
    if (candidate && candidate.exercise === exercise && candidate.unit === unit) {
      rec.is_new_heaviest = candidate.weight > heaviest.weight;
      rec.is_new_volume = candidate.weight * candidate.reps > best_set_volume;
    }
    out.push(rec);
  }
  return out;
}

/** Monday 00:00 UTC of the ISO week containing `d`. */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.getTime();
}
const WEEK = 7 * 24 * 3600 * 1000;

/** Consecutive weeks with at least one workout, counting back from this week (or last). */
export function streak(workouts, now = new Date()) {
  const weeks = new Set(workouts.map((w) => weekStart(new Date(w.startedAt))));
  let cur = weekStart(now);
  if (!weeks.has(cur)) cur -= WEEK; // this week isn't over yet
  let n = 0;
  while (weeks.has(cur)) {
    n += 1;
    cur -= WEEK;
  }
  return n;
}

export function weeklyProgress(workouts, goal, now = new Date()) {
  const start = weekStart(now);
  const done = workouts.filter((w) => {
    const t = new Date(w.startedAt).getTime();
    return t >= start && t < start + WEEK;
  }).length;
  return { done, goal };
}
