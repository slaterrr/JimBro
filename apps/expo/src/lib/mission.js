// Workout Mission: Jim's agent loop for one session.
//   understand  parseMission("I have 20 minutes, help me finish chest day")
//   plan        planMission(): a time-boxed session from goal, history and muscle recency,
//               every choice explained, shown as a confirm card (the user stays in control)
//   act/adapt   missionStart / missionStep: a hands-free state machine
//               (position -> set -> check -> rest -> ...), next-set load from the last set's RPE,
//               skip / switch when the camera suggests another lift
//   verify      missionSummary(): planned vs done, time, camera-verified reps, what changes next time
// Pure functions (no React, no storage), so every step is unit-tested.
import { suggestNext } from './coach.js';
import { showSetTarget, workoutTarget } from './workoutTargets.js';
import { EXERCISES, exerciseName } from './exercises.js';
import { fitnessGoalShort, normalizeFitnessGoal } from './fitnessGoal.js';
import { EXERCISE_MUSCLES } from './muscles.js';
import { restFor } from './rest.js';

// ---- understand -------------------------------------------------------------------------

export const FOCUS_LABEL = { chest: 'Chest', legs: 'Legs', back: 'Back', arms: 'Arms', shoulders: 'Shoulders', full: 'Full body' };

// Order matters: "back and biceps" is a back day; "arms" only when no bigger area is named.
const FOCUS_WORDS = [
  ['full', /\b(full[- ]?body|whole body|total body|everything)\b/],
  ['chest', /\b(chest|pecs?|push day)\b/],
  ['legs', /\b(legs?|leg day|lower body|quads?|glutes?)\b/],
  ['back', /\b(back|pull day|lats?)\b/],
  ['shoulders', /\b(shoulders?|delts?)\b/],
  ['arms', /\b(arms?|biceps?|triceps?|guns)\b/],
];
const LOG_LIKE = /\blog\b|\d+\s*[x×]\s*\d+|\bat\s+\d+\s*(lb|lbs|kg|pounds?|kilos?)?\b/;
const SESSION_WORDS = /\b(day|workout|session|train(ing)?|today|finish|help|quick|minutes?|mins?|hour)\b/;

function minutesIn(t) {
  if (/half an hour|half hour|30 minutes/.test(t)) return 30;
  const h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/.exec(t);
  if (h) return Math.round(Number(h[1]) * 60);
  if (/\b(an|one|1)\s*hour\b/.test(t)) return 60;
  const m = /(\d{1,3})\s*(?:-?\s*)(?:minutes?|mins?|m)\b/.exec(t);
  return m ? Number(m[1]) : null;
}

/** "I have 20 minutes; help me finish chest day" -> { minutes: 20, focus: 'chest', recognized: true } */
export function parseMission(text) {
  const t = String(text ?? '').toLowerCase();
  const minutes = minutesIn(t);
  const focus = FOCUS_WORDS.find(([, re]) => re.test(t))?.[0] ?? null;
  const recognized = !LOG_LIKE.test(t) && (minutes !== null || (focus !== null && SESSION_WORDS.test(t)));
  return { minutes, focus, recognized };
}

// ---- plan ------------------------------------------------------------------------------

/** Lifts per focus, best first. Each is checked against muscles in EXERCISE_MUSCLES. */
export const FOCUS_EXERCISES = {
  chest: ['bench', 'push_up', 'shoulder_press'],
  legs: ['squat', 'lunge', 'deadlift'],
  back: ['pull_up', 'deadlift'],
  arms: ['hammer_curl', 'shoulder_press', 'push_up'],
  shoulders: ['shoulder_press', 'push_up', 'bench'],
  full: ['squat', 'bench', 'pull_up', 'shoulder_press'],
};
const AREA_MUSCLES = { chest: ['chest'], legs: ['quads', 'glutes', 'hamstrings'], back: ['lats', 'lower_back'], arms: ['biceps', 'triceps'], shoulders: ['shoulders'] };
const BODYWEIGHT = new Set(['push_up', 'pull_up', 'lunge']);
// [sets, reps] per fitness goal (same intent as planFromGoal's schemes).
const SCHEME = { strength: [4, 5], muscle: [3, 10], endurance: [3, 15], general: [3, 8] };
const WARMUP_S = 180;
const SEC_PER_REP = 4;
const SET_SETUP_S = 20;
const MIN_SETS = 2;
const DAY = 86400000;

const isCamera = (exercise) => Boolean(EXERCISES.find((e) => e.id === exercise)?.camera);
const lower = (id) => exerciseName(id).toLowerCase();
/** ['a', 'b', 'c'] -> 'a, b and c' */
export const listText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

/** Days since each area was last trained (Infinity if never). */
function areaRecency(history, now) {
  const last = {};
  for (const w of history ?? []) {
    const d = Math.floor((now.getTime() - new Date(w.startedAt).getTime()) / DAY);
    for (const s of w.sets ?? []) for (const m of EXERCISE_MUSCLES[s.exercise] ?? []) if (last[m] === undefined || d < last[m]) last[m] = d;
  }
  return Object.fromEntries(Object.entries(AREA_MUSCLES).map(([area, ms]) => [area, Math.min(...ms.map((m) => last[m] ?? Infinity))]));
}

/** Sets of one exercise in one unit, oldest first. */
function setsOf(history, exercise, unit) {
  return [...(history ?? [])]
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
    .flatMap((w) => w.sets ?? [])
    .filter((s) => s.exercise === exercise && s.unit === unit);
}

function itemFor(exercise, { history, unit, sets, reps, goal }) {
  const past = setsOf(history, exercise, unit);
  const sug = past.length ? suggestNext(past) : null;
  let weight;
  let why;
  if (sug) {
    weight = sug.weight;
    const last = past.at(-1);
    why = `Last time ${last.weight > 0 ? `${last.weight} ${unit} × ${last.reps}` : `${last.reps} reps, bodyweight`}. ${sug.rationale}`;
  } else if (BODYWEIGHT.has(exercise)) {
    weight = 0;
    why = 'Bodyweight to start; rate the first set and Jim adjusts.';
  } else {
    weight = null;
    why = 'No history yet: start light, rate the first set, and Jim adjusts from there.';
  }
  const r = sug && sug.weight > 0 ? sug.reps : reps;
  const rest = restFor({ exercise, reps: r, fitnessGoal: goal }).seconds;
  return { exercise, sets, reps: r, weight, unit, rest_s: rest, camera: isCamera(exercise), why: `${why}${isCamera(exercise) ? ' The camera counts it.' : ''}` };
}

const itemSeconds = (i) => i.sets * (i.reps * SEC_PER_REP + SET_SETUP_S + i.rest_s);
const totalSeconds = (items) => (items.length ? WARMUP_S + items.reduce((t, i) => t + itemSeconds(i), 0) - items.at(-1).rest_s : 0);

/**
 * { minutes, focus, history, settings, now } -> mission
 * { title, minutes, estMinutes, focus, items[{ exercise, sets, reps, weight, unit, rest_s, camera, why }], reasons[] }
 */
export function planMission({ minutes, focus, history = [], settings = {}, now = new Date() } = {}) {
  const budget = Math.max(10, Math.min(120, minutes ?? 30));
  const goal = normalizeFitnessGoal(settings.fitnessGoal);
  const unit = settings.unit === 'kg' ? 'kg' : 'lb';
  const [schemeSets, schemeReps] = SCHEME[goal];
  const reasons = [];

  let area = FOCUS_EXERCISES[focus] ? focus : null;
  if (!area) {
    const rec = areaRecency(history, now);
    const [oldest, days] = Object.entries(rec).sort((a, b) => b[1] - a[1])[0];
    area = oldest;
    reasons.push(days === Infinity
      ? `You haven't trained ${FOCUS_LABEL[area].toLowerCase()} yet, so that's today's focus.`
      : `${FOCUS_LABEL[area]} has rested longest (${days} days), so that's today's focus.`);
  } else {
    reasons.push(`Focus: ${FOCUS_LABEL[area].toLowerCase()}, as you asked.`);
  }

  // Add lifts in priority order while they fit the budget, trimming sets (never below 2).
  const items = [];
  for (const exercise of FOCUS_EXERCISES[area]) {
    for (let sets = schemeSets; sets >= MIN_SETS; sets -= 1) {
      const item = itemFor(exercise, { history, unit, sets, reps: schemeReps, goal });
      if (totalSeconds([...items, item]) <= budget * 60) {
        items.push(item);
        break;
      }
    }
  }
  if (!items.length) items.push(itemFor(FOCUS_EXERCISES[area][0], { history, unit, sets: MIN_SETS, reps: schemeReps, goal }));
  // Spare time: add a set to the first lifts.
  for (const item of items) {
    if (totalSeconds(items) + itemSeconds({ ...item, sets: 1 }) <= budget * 60 && item.sets < schemeSets + 1) item.sets += 1;
  }

  const estMinutes = Math.round(totalSeconds(items) / 60);
  reasons.unshift(`Fits your ${budget} min: about ${estMinutes} min including a ${WARMUP_S / 60}-min warm-up and rests.`);
  reasons.push(`${fitnessGoalShort(goal)} goal: about ${schemeSets} × ${schemeReps}, rests from your goal and each lift.`);
  const cam = items.filter((i) => i.camera).map((i) => lower(i.exercise));
  const manual = items.filter((i) => !i.camera).map((i) => lower(i.exercise));
  if (cam.length) reasons.push(`The camera counts ${listText(cam)}${manual.length ? `; tap to count ${listText(manual)}` : ''}.`);
  else reasons.push(`Tap to count ${listText(manual)} (the camera can't track ${manual.length > 1 ? 'these' : 'this'} yet).`);

  return { title: FOCUS_LABEL[area], minutes: budget, estMinutes, focus: area, items, reasons };
}

/** Mission -> a plan day, so the started workout and the Coach screen's plan lookup see it. */
export function missionPlanned(mission) {
  return {
    mission: true,
    items: mission.items.map((i) => ({ exercise: i.exercise, sets: i.sets, reps_low: i.reps, reps_high: i.reps, rest_min: i.rest_s / 60 })),
  };
}

// ---- act / adapt ---------------------------------------------------------------------------

/** New guided-session state. */
export function missionStart(mission) {
  const first = mission.items[0];
  return { mission, i: 0, setNo: 1, phase: first ? 'position' : 'done', cur: first ? { weight: first.weight, reps: first.reps } : null, pending: null, log: [], changes: [], note: null };
}

/** What to do now: { exercise, setNo, sets, reps, weight, unit, camera, rest_s } or null when done. */
export function currentTarget(s) {
  const item = s.mission.items[s.i];
  if (!item || s.phase === 'done') return null;
  return { exercise: item.exercise, setNo: s.setNo, sets: item.sets, reps: s.cur.reps, weight: s.cur.weight, unit: item.unit, camera: item.camera, rest_s: s.cur.rest_s ?? item.rest_s };
}

function nextItem(s, note) {
  const i = s.i + 1;
  const item = s.mission.items[i];
  if (!item) return { ...s, phase: 'done', note };
  return { ...s, i, setNo: 1, cur: { weight: item.weight, reps: item.reps }, note: note ?? `Next: ${exerciseName(item.exercise)}.` };
}

/**
 * Advance the session. Events: ready, set_done {reps, reps_detail?}, confirm {rpe},
 * rest_done, skip, switch {exercise}, end. Events that don't fit the phase are ignored
 * (the same state object is returned).
 */
export function missionStep(s, e) {
  const item = s.mission.items[s.i];
  switch (e.type) {
    case 'adjust_targets': {
      if (!item || item.exercise !== e.exercise || s.phase === 'check' || s.phase === 'done') return s;
      const reps = e.reps == null ? s.cur.reps : workoutTarget('reps', e.reps);
      const sets = e.sets == null || !showSetTarget(item.exercise)
        ? item.sets
        : Math.max(s.setNo, workoutTarget('sets', e.sets));
      if (reps === s.cur.reps && sets === item.sets) return s;
      const items = s.mission.items.map((entry, index) => (
        index === s.i ? { ...entry, reps, sets } : entry
      ));
      return { ...s, mission: { ...s.mission, items }, cur: { ...s.cur, reps } };
    }
    case 'ready':
      return s.phase === 'position' ? { ...s, phase: 'set' } : s;
    case 'set_done':
      return s.phase === 'set' ? { ...s, phase: 'check', pending: { reps: Math.max(0, e.reps | 0), reps_detail: e.reps_detail ?? [] } } : s;
    case 'confirm': {
      if (s.phase !== 'check') return s;
      const rpe = e.rpe ?? null;
      // A weight entered at the check (first set with no history, or a change) wins over the plan.
      const used = Number.isFinite(e.weight) && e.weight >= 0 ? e.weight : s.cur.weight;
      // Jim's suggestion (lib/recommend.js) changes the next set only if the user accepted it.
      const rec = e.rec && e.rec.action !== 'none'
        ? { action: e.rec.action, weight: e.rec.weight ?? used, reps: e.rec.reps ?? s.cur.reps, accepted: Boolean(e.accepted), ...(e.rec.extraRestS ? { extraRestS: e.rec.extraRestS } : {}) }
        : null;
      const entry = { exercise: item.exercise, reps: s.pending.reps, target: s.cur.reps, weight: used, unit: item.unit, rpe, camera: item.camera, reps_detail: s.pending.reps_detail, rec };
      const log = [...s.log, entry];
      const done = { ...s, log, pending: null };
      if (s.setNo < item.sets) {
        const take = rec?.accepted;
        const cur = {
          weight: take ? rec.weight : used,
          reps: take ? rec.reps : s.cur.reps,
          rest_s: take && rec.extraRestS ? item.rest_s + rec.extraRestS : null,
        };
        const why = e.rec?.reasons?.join(' ') ?? '';
        const note = used === null
          ? 'Pick your weight for this set; rate it and Jim can suggest the next one.'
          : take ? why : rec ? `Keeping ${used} ${item.unit}, as planned.` : `Keeping ${used} ${item.unit}.`;
        return { ...done, setNo: s.setNo + 1, cur, phase: 'rest', note };
      }
      const after = nextItem(done, null);
      return after.phase === 'done' ? after : { ...after, phase: 'rest' };
    }
    case 'rest_done':
      return s.phase === 'rest' ? { ...s, phase: 'position', note: null } : s;
    case 'skip': {
      if (s.phase === 'done' || !item) return s;
      const after = nextItem({ ...s, changes: [...s.changes, `Skipped ${exerciseName(item.exercise)}.`] }, null);
      return after.phase === 'done' ? after : { ...after, phase: 'position' };
    }
    case 'switch': {
      if (s.phase === 'done' || !item || !e.exercise || e.exercise === item.exercise) return s;
      const swapped = { ...item, exercise: e.exercise, camera: isCamera(e.exercise), weight: BODYWEIGHT.has(e.exercise) ? 0 : null };
      const items = s.mission.items.map((x, k) => (k === s.i ? swapped : x));
      return {
        ...s,
        mission: { ...s.mission, items },
        cur: { ...s.cur, weight: swapped.weight },
        phase: 'position',
        changes: [...s.changes, `Switched ${exerciseName(item.exercise)} to ${exerciseName(e.exercise)}.`],
      };
    }
    case 'end':
      return s.phase === 'done' ? s : { ...s, phase: 'done', changes: s.log.length < s.mission.items.reduce((t, x) => t + x.sets, 0) ? [...s.changes, 'Ended early.'] : s.changes };
    default:
      return s;
  }
}

/** Hands-free set end: target reached and a 2 s pause, or any reps and a 6 s pause. */
export function shouldEndSet({ count, target, msSinceLastRep }) {
  if (!(count > 0)) return false;
  return (count >= target && msSinceLastRep >= 2000) || msSinceLastRep >= 6000;
}

// ---- verify --------------------------------------------------------------------------------

/** Planned vs done, time, camera-verified reps and what changes next time. */
export function missionSummary(mission, log, { startedAt, endedAt } = {}) {
  const setsPlanned = mission.items.reduce((t, i) => t + i.sets, 0);
  const setsDone = log.length;
  const repsDone = log.reduce((t, x) => t + x.reps, 0);
  const repsTarget = log.reduce((t, x) => t + x.target, 0);
  const cameraReps = log.filter((x) => x.camera).reduce((t, x) => t + x.reps, 0);
  const minutes = startedAt != null && endedAt != null ? Math.round((endedAt - startedAt) / 60000) : null;
  const onTime = minutes === null ? null : minutes <= mission.minutes;
  const lines = [
    `${setsDone} of ${setsPlanned} planned sets, ${repsDone} of ${repsTarget} target reps.`,
    minutes === null ? null : `${minutes} of your ${mission.minutes} min${onTime ? ', on time' : ', a bit over'}.`,
    cameraReps ? `${cameraReps} reps counted by the camera.` : null,
  ].filter(Boolean);
  const nextTime = [];
  const seen = new Set();
  for (const x of [...log].reverse()) {
    if (seen.has(x.exercise)) continue;
    seen.add(x.exercise);
    if (x.weight === null) continue;
    const sug = suggestNext([{ exercise: x.exercise, weight: x.weight, reps: x.reps, rpe: x.rpe, unit: x.unit }]);
    const load = sug.weight > 0 ? `${sug.weight} ${sug.unit} × ${sug.reps}` : `${sug.reps} reps`;
    nextTime.push(`${exerciseName(x.exercise)}: ${load}. ${sug.rationale}`);
  }
  return { setsPlanned, setsDone, repsDone, repsTarget, cameraReps, minutes, onTime, lines, nextTime: nextTime.reverse() };
}

// Camera-counted stand-ins for lifts the camera can't track yet (same main muscles).
const CAMERA_SWAP = { bench: 'push_up', deadlift: 'squat', lunge: 'squat', hammer_curl: 'pull_up' };
/** A camera-counted alternative for `exercise`, or null when it is already camera-counted. */
export const cameraSwap = (exercise) => CAMERA_SWAP[exercise] ?? null;
