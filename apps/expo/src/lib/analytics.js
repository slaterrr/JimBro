// Progress analytics computed from on-phone history. Nothing here is stored:
// records, e1RM and volume are always derived from the sets, so editing or
// deleting history can't leave stale numbers behind.
//
// "Same lift" = same exercise + variation + equipment. Different lifts or
// equipment set-ups are never compared or combined. Weights are converted
// exactly between kg and lb for display; stored values are untouched.
//
// Measured vs estimated: top weight, reps, volume and records of heaviest
// weight / most reps / session volume are measured (what was logged). e1RM is
// an Epley estimate (sets of 10 reps or fewer) and always labelled as such.

import { estimate1RM } from './tools.js';
import { EXERCISE_MUSCLE_SHARES } from './muscles.js';
import { exerciseName } from './exercises.js';

const LB_IN_KG = 0.45359237;
const DAY = 86400000;
const round1 = (n) => Math.round(n * 10) / 10;

export const convert = (value, from, to) => (from === to ? value : from === 'lb' ? value * LB_IN_KG : value / LB_IN_KG);

/** Key and label for "the same lift". */
export const liftKey = (s) => `${s.exercise}|${(s.variation ?? '').trim().toLowerCase()}|${s.equipment ?? ''}`;
export function liftLabel(key) {
  const [exercise, variation, equipment] = key.split('|');
  return [exerciseName(exercise), variation ? `(${variation})` : '', equipment ? `· ${equipment}` : ''].filter(Boolean).join(' ');
}

const completed = (s) => s.completed !== false;
const isBodyweight = (s) => !(s.weight > 0);

/** Sets with their workout's time, oldest first, in `unit`. Only completed sets count for load numbers. */
export function flatSets(workouts, unit) {
  return workouts
    .flatMap((w) =>
      w.sets.map((s) => ({
        ...s,
        workoutId: w.id,
        program: w.program ?? null,
        t: new Date(s.loggedAt ?? w.startedAt).getTime(),
        day: (s.loggedAt ?? w.startedAt).slice(0, 10),
        w: convert(s.weight, s.unit, unit),
      })),
    )
    .sort((a, b) => a.t - b.t);
}

/** Workouts matching a filter: { exercise?, lift?, from?, to?, program? } (dates as ms or ISO). */
export function filterWorkouts(workouts, f = {}) {
  const from = f.from ? new Date(f.from).getTime() : -Infinity;
  const to = f.to ? new Date(f.to).getTime() : Infinity;
  return workouts
    .filter((w) => {
      const t = new Date(w.startedAt).getTime();
      return t >= from && t <= to && (!f.program || (w.program ?? w.name) === f.program);
    })
    .map((w) => ({
      ...w,
      sets: w.sets.filter((s) => (!f.exercise || s.exercise === f.exercise) && (!f.lift || liftKey(s) === f.lift)),
    }))
    .filter((w) => w.sets.length);
}

/** Lifts present in the history (most recently trained first). */
export function lifts(workouts) {
  const last = new Map();
  for (const s of flatSets(workouts, 'kg')) last.set(liftKey(s), s.t);
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => ({ key, label: liftLabel(key) }));
}

/** Estimated 1RM of a set in `unit` (null for >10 reps or no load). */
export const e1rm = (s, unit) => {
  const v = estimate1RM({ weight: s.weight, reps: s.reps, unit: s.unit });
  return v === null ? null : round1(convert(v, s.unit, unit));
};

/**
 * One point per session for a lift: top weight, volume, reps, sets, average
 * weight per rep, best e1RM, completion. Bodyweight sets have no load numbers.
 */
export function liftSessions(workouts, key, unit) {
  const byWorkout = new Map();
  for (const s of flatSets(workouts, unit)) {
    if (liftKey(s) !== key) continue;
    if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, []);
    byWorkout.get(s.workoutId).push(s);
  }
  const planned = new Map(workouts.map((w) => [w.id, w.planned]));
  return [...byWorkout.entries()].map(([workoutId, sets]) => {
    const done = sets.filter(completed);
    const loaded = done.filter((s) => !isBodyweight(s));
    const reps = done.reduce((t, s) => t + s.reps, 0);
    const volume = loaded.reduce((t, s) => t + s.w * s.reps, 0);
    const loadedReps = loaded.reduce((t, s) => t + s.reps, 0);
    const e = loaded.map((s) => e1rm(s, unit)).filter((v) => v !== null);
    // Plan days list items per exercise: { exercise, sets, reps_low, reps_high }.
    const plannedSets = planned.get(workoutId)?.items?.find((i) => i.exercise === sets[0].exercise)?.sets ?? null;
    const tuts = done.flatMap((s) => s.reps_detail ?? []).map((r) => r.concentric_ms + r.peak_pause_ms + r.eccentric_ms);
    return {
      workoutId,
      date: sets[0].day,
      t: sets[0].t,
      sets: sets.length,
      completedSets: done.length,
      plannedSets,
      reps,
      bodyweight: loaded.length === 0,
      topWeight: loaded.length ? round1(Math.max(...loaded.map((s) => s.w))) : null,
      volume: loaded.length ? round1(volume) : null,
      avgWeightPerRep: loadedReps ? round1(volume / loadedReps) : null,
      bestE1RM: e.length ? Math.max(...e) : null,
      avgTutMs: tuts.length ? Math.round(tuts.reduce((a, b) => a + b, 0) / tuts.length) : null,
    };
  });
}

/** Latest session vs the one before it, for one lift. Differences are latest − previous. */
export function compareLatest(workouts, key, unit) {
  const s = liftSessions(workouts, key, unit);
  if (s.length < 2) return null;
  const [prev, cur] = s.slice(-2);
  const diff = (k) => (cur[k] === null || prev[k] === null ? null : round1(cur[k] - prev[k]));
  return { previous: prev, latest: cur, change: { topWeight: diff('topWeight'), volume: diff('volume'), reps: diff('reps'), bestE1RM: diff('bestE1RM') } };
}

// ---- volume ---------------------------------------------------------------------

/** Monday 00:00 UTC of the ISO week containing `t`. */
export function weekStart(t) {
  const d = new Date(t);
  const x = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
}
const monthStart = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/** Buckets from `from` to `now`, oldest first: { label, start, end }. */
export function buckets(period, from, now) {
  const out = [];
  if (period === 'week') {
    for (let s = weekStart(from); s <= now; s += 7 * DAY) out.push({ start: s, end: s + 7 * DAY, label: new Date(s).toISOString().slice(5, 10) });
  } else {
    let s = monthStart(from);
    while (s <= now) {
      const d = new Date(s);
      const e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      out.push({ start: s, end: e, label: d.toISOString().slice(0, 7) });
      s = e;
    }
  }
  return out;
}

/** Volume (Σ reps × weight of completed, loaded sets) per week or month, in `unit`. */
export function periodVolume(workouts, unit, period, from, now = Date.now()) {
  const sets = flatSets(workouts, unit).filter((s) => completed(s) && !isBodyweight(s));
  return buckets(period, from, now).map((b) => ({
    label: b.label,
    start: b.start,
    volume: round1(sets.filter((s) => s.t >= b.start && s.t < b.end).reduce((v, s) => v + s.w * s.reps, 0)),
  }));
}

/** Volume and set count per lift, largest first. */
export function volumeByLift(workouts, unit) {
  const m = new Map();
  for (const s of flatSets(workouts, unit)) {
    if (!completed(s)) continue;
    const k = liftKey(s);
    const cur = m.get(k) ?? { key: k, label: liftLabel(k), volume: 0, sets: 0, reps: 0 };
    cur.sets += 1;
    cur.reps += s.reps;
    if (!isBodyweight(s)) cur.volume += s.w * s.reps;
    m.set(k, cur);
  }
  return [...m.values()].map((x) => ({ ...x, volume: round1(x.volume) })).sort((a, b) => b.volume - a.volume || b.sets - a.sets);
}

/**
 * Training load per muscle group. Allocation (documented in muscles.js): each
 * set's volume and set count go 100% to the exercise's primary muscles and
 * 50% to its secondary muscles. Relative training load, not muscle "work".
 */
export function volumeByMuscle(workouts, unit) {
  const m = {};
  for (const s of flatSets(workouts, unit)) {
    if (!completed(s)) continue;
    const shares = EXERCISE_MUSCLE_SHARES[s.exercise];
    if (!shares) continue;
    for (const [muscle, share] of Object.entries(shares)) {
      const cur = (m[muscle] ??= { muscle, volume: 0, sets: 0 });
      cur.sets += share;
      if (!isBodyweight(s)) cur.volume += s.w * s.reps * share;
    }
  }
  return Object.values(m)
    .map((x) => ({ ...x, volume: round1(x.volume), sets: round1(x.sets) }))
    .sort((a, b) => b.sets - a.sets);
}

// ---- consistency ------------------------------------------------------------------

/** Workouts per ISO week from `from` to `now`, plus average sessions per week. */
export function frequency(workouts, from, now = Date.now()) {
  const weeks = buckets('week', from, now).map((b) => ({
    label: b.label,
    start: b.start,
    workouts: workouts.filter((w) => {
      const t = new Date(w.startedAt).getTime();
      return t >= b.start && t < b.end;
    }).length,
  }));
  const total = weeks.reduce((t, w) => t + w.workouts, 0);
  return { weeks, perWeek: weeks.length ? round1(total / weeks.length) : 0 };
}

/** Days of a month with workouts: { 'YYYY-MM-DD': count }. `month` = 'YYYY-MM'. */
export function calendar(workouts, month) {
  const out = {};
  for (const w of workouts) {
    const day = w.startedAt.slice(0, 10);
    if (day.startsWith(month)) out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/** Workout duration in minutes, or null if it isn't finished. */
export const durationMin = (w) => (w.finishedAt ? Math.max(0, Math.round((new Date(w.finishedAt) - new Date(w.startedAt)) / 60000)) : null);

// ---- personal records ------------------------------------------------------------

/**
 * Personal-record history per lift, recomputed from scratch, oldest first.
 * Types: 'heaviest' (measured), 'reps_at_weight' (measured; per weight),
 * 'session_volume' (measured), 'e1rm' (estimated). A record must strictly
 * beat the previous best; ties and repeats aren't new records. The first value
 * of each type is kept as a baseline with `first: true`. Weights are
 * compared after exact unit conversion; records are reported in `unit`.
 */
export function recordHistory(workouts, unit) {
  const events = [];
  const best = new Map(); // `${lift}|${type}|${extra}` -> value
  /** false = not a record; otherwise whether it's the first value (a baseline, not an improvement). */
  const beat = (k, v) => {
    const prev = best.get(k);
    if (prev !== undefined && !(v > prev + 1e-9)) return false;
    best.set(k, v);
    return { first: prev === undefined };
  };
  const sessionVolume = new Map();
  const sets = flatSets(workouts, unit).filter((s) => completed(s) && !isBodyweight(s));
  for (const s of sets) {
    const lift = liftKey(s);
    const base = { lift, label: liftLabel(lift), date: s.day, t: s.t, setId: s.id, workoutId: s.workoutId, unit };
    // Weight in the set's own unit, rounded, so 100 kg logged twice is one weight.
    const w = round1(s.w);
    const h = beat(`${lift}|heaviest`, w);
    if (h) events.push({ ...base, type: 'heaviest', source: 'measured', weight: w, reps: s.reps, first: h.first });
    if (beat(`${lift}|reps|${w}`, s.reps)) {
      // Only a record at a weight already lifted before; the first time is just a first.
      if ([...best.keys()].some((k) => k.startsWith(`${lift}|repsseen|${w}`))) {
        events.push({ ...base, type: 'reps_at_weight', source: 'measured', weight: w, reps: s.reps, first: false });
      }
    }
    best.set(`${lift}|repsseen|${w}`, 1);
    const e = e1rm(s, unit);
    const eb = e !== null ? beat(`${lift}|e1rm`, e) : false;
    if (eb) events.push({ ...base, type: 'e1rm', source: 'estimated', value: e, weight: w, reps: s.reps, first: eb.first });
    const sv = `${lift}|${s.workoutId}`;
    sessionVolume.set(sv, (sessionVolume.get(sv) ?? 0) + s.w * s.reps);
  }
  // Session volume, in session order.
  const sessions = [...sessionVolume.entries()]
    .map(([k, v]) => {
      const [exercise, variation, equipment, workoutId] = k.split('|');
      const first = sets.find((s) => s.workoutId === workoutId);
      return { lift: `${exercise}|${variation}|${equipment}`, workoutId, v: round1(v), t: first.t, day: first.day };
    })
    .sort((a, b) => a.t - b.t);
  for (const x of sessions) {
    const vb = beat(`${x.lift}|volume`, x.v);
    if (vb) {
      events.push({ lift: x.lift, label: liftLabel(x.lift), date: x.day, t: x.t, workoutId: x.workoutId, unit, type: 'session_volume', source: 'measured', value: x.v, first: vb.first });
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

/** Current best of each record type per lift (the last event of each). */
export function currentRecords(workouts, unit) {
  const out = new Map();
  for (const e of recordHistory(workouts, unit)) {
    const cur = out.get(e.lift) ?? { lift: e.lift, label: e.label };
    if (e.type === 'reps_at_weight') (cur.repsAtWeight ??= {})[e.weight] = e;
    else cur[e.type] = e;
    out.set(e.lift, cur);
  }
  return [...out.values()];
}

/**
 * IDs of sets that beat a previous measured record (for the 🏆 marker), from
 * current history. A lift's first-ever set is a baseline, not a record.
 */
export function recordSetIds(workouts) {
  return new Set(recordHistory(workouts, 'kg').filter((e) => e.setId && e.type !== 'e1rm' && !e.first).map((e) => e.setId));
}

/** Rest before each set, from log times within a workout (null over 10 minutes or for the first set). */
export function restBefore(workout) {
  const sets = [...workout.sets].filter((s) => s.loggedAt).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const out = {};
  for (let i = 1; i < sets.length; i++) {
    const sec = Math.round((new Date(sets[i].loggedAt) - new Date(sets[i - 1].loggedAt)) / 1000);
    out[sets[i].id] = sec > 0 && sec <= 600 ? sec : null;
  }
  return out;
}
