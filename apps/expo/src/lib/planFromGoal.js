// Rule-based weekly plan from the user's fitness goal, focus muscles, optional photo emphasis
// (muscle groups AI Jim suggested from a reference photo) and logged/imported history. Works
// fully offline; the photo path only changes which muscles come first. Output has the same
// shape as plans.js buildPlan, so savePlan / nextWorkout / the plan card use it unchanged.
import { EXERCISES, exerciseName } from './exercises.js';
import { EXERCISE_MUSCLES, MUSCLE_GROUPS } from './muscles.js';

// [sets, reps_low, reps_high, rest_min]
const SCHEME = { strength: [4, 3, 5, 3], muscle: [4, 8, 12, 1.5], endurance: [3, 12, 20, 1], general: [3, 6, 10, 1.5] };
const LABEL = { strength: 'strength', muscle: 'muscle', endurance: 'endurance', general: 'general' };
const CATEGORIES = [['squat', 'deadlift', 'lunge'], ['bench', 'shoulder_press'], ['pull_up']];
const ORDER = EXERCISES.map((e) => e.id).filter((id) => EXERCISE_MUSCLES[id]);
const MUSCLE_IDS = new Set(MUSCLE_GROUPS.map((m) => m.id));
const MAX_FOCUS = 4;
const MAX_ITEMS = 4;
const MAX_REASON = 200;
const WARMUP_MIN = 5;

// Wording the photo feature must never pass on: body weight, fat, looks or health judgments.
export const JUDGMENT = /\b(weight|overweight|underweight|fat|obese|bmi|attractive|unattractive|sexy|ugly|hot|skinny|thin|chubby|health|healthy|unhealthy|diet|calories?)\b/i;

/** AI emphasis -> [{ muscle, reason }] with known muscles, unique, neutral reasons, at most 4. */
export function validateEmphasis(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    const reason = typeof e?.reason === 'string' ? e.reason.trim() : '';
    if (!MUSCLE_IDS.has(e?.muscle) || out.some((o) => o.muscle === e.muscle)) continue;
    if (!reason || reason.length > MAX_REASON || JUDGMENT.test(reason)) continue;
    out.push({ muscle: e.muscle, reason });
    if (out.length === MAX_FOCUS) break;
  }
  return out;
}

const muscleName = (id) => (MUSCLE_GROUPS.find((m) => m.id === id)?.name ?? id).toLowerCase();

function lastLoads(history = []) {
  const loads = {};
  const ws = [...history].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  for (const w of ws) for (const s of w.sets ?? []) if (typeof s.weight === 'number') loads[s.exercise] = { weight: s.weight, unit: s.unit };
  return loads;
}

/**
 * { fitnessGoal, focusMuscles, emphasis, history, daysPerWeek } -> plan
 * { goal, source: 'photo'|'rules', focus, days[{ day, items[{ exercise, sets, reps_low, reps_high, rest_min, start? }], estimated_minutes }], notes }
 */
export function planFromGoal({ fitnessGoal, focusMuscles = [], emphasis = [], history = [], daysPerWeek = 3 } = {}) {
  const goal = SCHEME[fitnessGoal] ? fitnessGoal : 'general';
  const [sets, lo, hi, rest] = SCHEME[goal];
  const fromPhoto = validateEmphasis(emphasis).map((e) => e.muscle);
  const focus = [...new Set([...fromPhoto, ...(Array.isArray(focusMuscles) ? focusMuscles : [])])].filter((m) => MUSCLE_IDS.has(m)).slice(0, MAX_FOCUS);
  const score = (ex) => focus.reduce((t, m, i) => t + (EXERCISE_MUSCLES[ex].includes(m) ? focus.length - i : 0), 0);
  const priority = ORDER.filter((ex) => score(ex) > 0).sort((a, b) => score(b) - score(a) || ORDER.indexOf(a) - ORDER.indexOf(b));
  const loads = lastLoads(history);
  const item = (exercise, extra) => ({ exercise, sets: sets + (extra ? 1 : 0), reps_low: lo, reps_high: hi, rest_min: rest, ...(loads[exercise] ? { start: loads[exercise] } : {}) });
  const days = [];
  const n = Math.max(1, Math.min(6, Math.round(daysPerWeek) || 3));
  for (let d = 0; d < n; d += 1) {
    const items = [];
    const has = (ex) => items.some((i) => i.exercise === ex);
    if (priority.length) items.push(item(priority[d % priority.length], true));
    if (priority.length > 1 && !has(priority[(d + 1) % priority.length])) items.push(item(priority[(d + 1) % priority.length], true));
    for (const cat of CATEGORIES) {
      if (items.length >= MAX_ITEMS) break;
      if (cat.some(has)) continue;
      items.push(item(cat[d % cat.length], false));
    }
    const minutes = WARMUP_MIN + items.reduce((t, i) => t + i.sets * (1 + i.rest_min), 0);
    days.push({ day: d + 1, items, estimated_minutes: Math.round(minutes) });
  }
  const notes = [];
  if (focus.length) notes.push(`Priority: ${focus.map(muscleName).join(', ')}${fromPhoto.length ? ' (from your reference photo)' : ''}. Those lifts come first with an extra set.`);
  if (Object.keys(loads).length) notes.push('Starting loads come from your logged and imported history; add weight only after an easy set (RPE 7 or less).');
  notes.push('Legs, push and pull are covered each week so nothing gets left behind.');
  return { goal, source: fromPhoto.length ? 'photo' : 'rules', focus, days, notes };
}

/** Plan -> confirm-card intent { type: 'plan', plan, summary }. */
export function planProposal(plan) {
  const names = plan.focus.map(muscleName);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const what = `${plan.days.length}-day ${LABEL[plan.goal]} plan`;
  return { type: 'plan', plan, summary: list ? `Save a ${what} that prioritizes ${list}?` : `Save a ${what}?` };
}

export const describeItem = (i) => `${exerciseName(i.exercise)} ${i.sets}×${i.reps_low}-${i.reps_high}${i.start ? ` @ ${i.start.weight} ${i.start.unit}` : ''}`;
