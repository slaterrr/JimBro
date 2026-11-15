// Jim on the phone: a port of backend/jimbro/coach.py. Code computes the facts and a
// conservative next-set suggestion; the persona only changes wording; pain short-circuits.
import { exerciseName } from './exercises.js';
import { personaFor } from './personas.js';
import { pick } from './voice.js';

/** Legacy tone ids (old saves); each maps to a persona via personaFor(). */
export const TONES = ['direct', 'friendly', 'silly', 'hard'];
const INCREMENT = { kg: 0.5, lb: 2.5 };
const MAX_STEP = 0.05;
const fmt = (n) => String(Math.round(n * 100) / 100);

export function suggestNext(history) {
  if (!history.length) return null;
  const last = history[history.length - 1];
  const inc = INCREMENT[last.unit];
  const rpe = last.rpe ?? null;
  let { weight, reps } = last;
  let why;
  if (rpe === null) {
    why = 'No RPE logged, so repeat the last set and rate how it felt.';
  } else if (weight === 0) {
    if (rpe <= 8) {
      reps += 1;
      why = `Bodyweight at RPE ${fmt(rpe)}: add one rep.`;
    } else {
      why = `Bodyweight at RPE ${fmt(rpe)}: hold reps and own the form.`;
    }
  } else if (rpe >= 9.5) {
    weight = Math.max(0, Math.ceil((weight * (1 - MAX_STEP)) / inc) * inc);
    why = `Last set was RPE ${fmt(rpe)} - back off slightly and keep reps clean.`;
  } else {
    why = `Last set was RPE ${fmt(rpe)}. Keep the logged load and rep target.`;
  }
  return { exercise: last.exercise, weight: Math.round(weight * 100) / 100, unit: last.unit, reps, rationale: why };
}

export const SAFETY = /\b(sharp pain|chest pain|pain|hurts?|injur(ed|y)|dizz(y|iness)|faint|numb|can'?t breathe|pop(ped)?)\b/i;
export const SAFETY_TEXT =
  'Stop the set now. Pain, dizziness or numbness is a signal to rest, not push through. ' +
  'If it is sharp, persists, or you have chest pain or trouble breathing, get medical help. ' +
  "JimBro can't assess injuries.";

// Wording per persona (see personas.js). Every variant states the same numbers and rationale;
// only emphasis changes. Legacy tone ids map through personaFor().
const CUE = {
  curl: 'keep your elbows pinned.', squat: 'hips back, chest up.', shoulder_press: 'brace your core.',
  bench: 'shoulder blades tight.', deadlift: 'bar close, back flat.', pull_up: 'full hang, chest to bar.',
};
const TEMPLATES = {
  coach: [
    (n, w, u, r, why, c) => `Good work. Next ${n}: ${w} ${u} for ${r} reps. ${why} Form cue: ${c}`,
    (n, w, u, r, why, c) => `Next ${n} set: ${w} ${u} x ${r}. ${why} One form cue: ${c}`,
    (n, w, u, r, why, c) => `Let's build on that: ${w} ${u} for ${r} on ${n}. ${why} Focus on form: ${c}`,
  ],
  hype: [
    (n, w, u, r, why) => `LET'S GO! Next ${n}: ${w} ${u} for ${r}! ${why} Every set feeds the streak!`,
    (n, w, u, r, why) => `You're on fire! ${n} up next: ${w} ${u}, ${r} reps! ${why} Chase that PR!`,
    (n, w, u, r, why) => `Big energy! ${w} ${u} x ${r} on ${n}! ${why} Keep the streak alive!`,
  ],
  drill: [
    (n, w, u, r, why) => `Target: ${n}, ${w} ${u} for ${r} reps. ${why} Stick to the plan.`,
    (n, w, u, r, why) => `Orders for ${n}: ${w} ${u}, ${r} reps. ${why} Every rep, on target.`,
    (n, w, u, r, why) => `Plan says ${n} at ${w} ${u} for ${r}. ${why} Hit the target, then rest.`,
  ],
  zen: [
    (n, w, u, r, why) => `When you're rested, ${n} at ${w} ${u} for ${r} reps. ${why} Slow and controlled, breathe out as you lift.`,
    (n, w, u, r, why) => `Take your time. Next ${n}: ${w} ${u} x ${r}. ${why} Control each rep and stop if anything hurts.`,
    (n, w, u, r, why) => `Breathe, rest, then ${w} ${u} for ${r} on ${n}. ${why} Smooth tempo over speed.`,
  ],
  analyst: [
    (n, w, u, r, why) => `${w} ${u} x ${r} is the next ${n} target. ${why} Log RPE to keep the trend accurate.`,
    (n, w, u, r, why) => `${w} ${u} for ${r} reps on ${n}. ${why} Keep the reps controlled.`,
    (n, w, u, r, why) => `${r} reps at ${w} ${u} for ${n}. ${why} Rate it after so the numbers stay honest.`,
  ],
};
const EMPTY = {
  coach: "Let's get started! Log your first set and I'll suggest the next one with a form cue.",
  hype: "Let's get this streak started! Log a set and watch the wins stack up!",
  drill: 'Nothing logged yet. Log a set and I will give you a target.',
  zen: "No rush. Log a set when you're ready and we'll go from there.",
  analyst: "No data yet. Log a set and I'll run the numbers.",
};
const MENTIONS = [
  ['shoulder_press', /(shoulder|overhead) press/i], ['bench', /bench/i], ['deadlift', /dead\s?lift/i],
  ['pull_up', /pull[\s-]?ups?|chin[\s-]?ups?/i], ['squat', /squat/i], ['lunge', /lunge/i], ['curl', /curl/i],
];

/**
 * history: sets in chronological order ({exercise, weight, unit, reps, rpe}).
 * persona: persona id or legacy tone id. seed picks the wording variant (default: set count).
 */
export function coachReply(message, persona, history, seed = history.length) {
  const id = personaFor(persona).id;
  const base = { tone: persona, persona: id };
  if (SAFETY.test(message)) return { ...base, text: SAFETY_TEXT, source: 'safety', suggestion: null };
  const named = MENTIONS.find(([, re]) => re.test(message))?.[0];
  const focus = named && history.some((s) => s.exercise === named) ? named : history[history.length - 1]?.exercise;
  const suggestion = focus ? suggestNext(history.filter((s) => s.exercise === focus)) : null;
  if (!suggestion) return { ...base, text: EMPTY[id], source: 'coach', suggestion: null };
  const cue = CUE[suggestion.exercise] ?? 'smooth, full range of motion.';
  const text = pick(TEMPLATES[id], seed)(exerciseName(suggestion.exercise).toLowerCase(), fmt(suggestion.weight), suggestion.unit, suggestion.reps, suggestion.rationale, cue);
  return { ...base, text, source: 'coach', suggestion };
}
