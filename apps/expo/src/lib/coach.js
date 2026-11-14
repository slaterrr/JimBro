// Jim on the phone: a port of backend/jimbro/coach.py. Code computes the facts and a
// bounded (<=5%) next-set suggestion; tone only changes wording; pain short-circuits.
import { exerciseName } from './exercises.js';

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
  } else if (rpe <= 7) {
    const up = Math.floor((weight * (1 + MAX_STEP)) / inc) * inc;
    weight = up > weight ? up : weight + inc;
    why = `Last set was RPE ${fmt(rpe)} - room to add a little load.`;
  } else if (rpe >= 9.5) {
    weight = Math.max(0, Math.ceil((weight * (1 - MAX_STEP)) / inc) * inc);
    why = `Last set was RPE ${fmt(rpe)} - back off slightly and keep reps clean.`;
  } else {
    reps += 1;
    why = `RPE ${fmt(rpe)} is a good working effort: same load, one more rep.`;
  }
  return { exercise: last.exercise, weight: Math.round(weight * 100) / 100, unit: last.unit, reps, rationale: why };
}

const SAFETY = /\b(sharp pain|chest pain|pain|hurts?|injur(ed|y)|dizz(y|iness)|faint|numb|can'?t breathe|pop(ped)?)\b/i;
export const SAFETY_TEXT =
  'Stop the set now. Pain, dizziness or numbness is a signal to rest, not push through. ' +
  'If it is sharp, persists, or you have chest pain or trouble breathing, get medical help. ' +
  "JimBro can't assess injuries.";

const TEMPLATES = {
  direct: (n, w, u, r, why) => `Next ${n}: ${w} ${u} x ${r}. ${why}`,
  friendly: (n, w, u, r, why) => `Great work! For your next ${n} set try ${w} ${u} for ${r} reps. ${why}`,
  silly: (n, w, u, r, why) => `Beep boop, Jim's gains computer says: ${n}, ${w} ${u}, ${r} reps. ${why} Your muscles have been notified.`,
  hard: (n, w, u, r, why) => `No excuses. ${n}: ${w} ${u}, ${r} reps, every one clean. ${why} Move.`,
};
const EMPTY = {
  direct: 'No sets logged yet. Log one and I will plan the next.',
  friendly: "Let's get started! Log your first set and I'll suggest the next.",
  silly: 'My crystal dumbbell is empty. Log a set so I can see the future!',
  hard: 'Nothing logged. Nothing earned. Log a set.',
};
const MENTIONS = [
  ['shoulder_press', /(shoulder|overhead) press/i], ['bench', /bench/i], ['deadlift', /dead\s?lift/i],
  ['pull_up', /pull[\s-]?ups?|chin[\s-]?ups?/i], ['squat', /squat/i], ['curl', /curl/i],
];

/** history: sets in chronological order ({exercise, weight, unit, reps, rpe}). */
export function coachReply(message, tone, history) {
  if (SAFETY.test(message)) return { text: SAFETY_TEXT, tone, source: 'safety', suggestion: null };
  const named = MENTIONS.find(([, re]) => re.test(message))?.[0];
  const focus = named && history.some((s) => s.exercise === named) ? named : history[history.length - 1]?.exercise;
  const suggestion = focus ? suggestNext(history.filter((s) => s.exercise === focus)) : null;
  if (!suggestion) return { text: EMPTY[tone] ?? EMPTY.friendly, tone, source: 'coach', suggestion: null };
  const t = TEMPLATES[tone] ?? TEMPLATES.friendly;
  const text = t(exerciseName(suggestion.exercise).toLowerCase(), fmt(suggestion.weight), suggestion.unit, suggestion.reps, suggestion.rationale);
  return { text, tone, source: 'coach', suggestion };
}
