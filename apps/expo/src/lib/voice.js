// Persona wording helpers. Callers compute the facts; these only choose words and emphasis,
// so every persona states the same numbers. Variants are picked deterministically by seed.
import { exerciseName } from './exercises.js';
import { personaFor } from './personas.js';

/** Deterministic variant: same seed, same line (no Math.random, so tests stay stable). */
export function pick(variants, seed = 0) {
  const n = variants.length;
  const i = Number.isFinite(seed) ? ((Math.trunc(seed) % n) + n) % n : 0;
  return variants[i];
}

/** Persona-specific table lookup, falling back to the default persona. */
export function byPersona(table, persona) {
  return table[personaFor(persona).id];
}

const LOGGED = {
  coach: {
    pr: [(b) => `New record! ${b}. Same clean form next set.`, (b) => `That's a best: ${b}. Keep the form exactly like that.`, (b) => `Record set: ${b}. Nice technique.`],
    set: [(b) => `${b} logged. Good set, keep the form tight.`, (b) => `Logged ${b}. Smooth reps, build on it.`, (b) => `Got it: ${b}. Same form next time.`],
  },
  hype: {
    pr: [(b) => `NEW PR! ${b}! Let's go!`, (b) => `Record smashed! ${b}! You're on fire!`, (b) => `PR alert! ${b}! The streak loves this!`],
    set: [(b) => `Boom! ${b} in the books!`, (b) => `Yes! ${b} logged! Keep it rolling!`, (b) => `Let's go! ${b} done!`],
  },
  drill: {
    pr: [(b) => `New record. ${b}. Now hold that standard.`, (b) => `Record logged: ${b}. Next set, same standard.`, (b) => `${b}. Record. Back to the plan.`],
    set: [(b) => `${b} logged. Next set on the plan.`, (b) => `Logged: ${b}. Stay on target.`, (b) => `${b}. Recorded. Rest, then next set.`],
  },
  zen: {
    pr: [(b) => `A new record, ${b}. Breathe and enjoy it.`, (b) => `${b}, a personal best. Rest well before the next one.`, (b) => `New record: ${b}. Calm and controlled, nicely done.`],
    set: [(b) => `${b} logged. Take a slow breath and rest.`, (b) => `Logged ${b}. Rest as long as you need.`, (b) => `${b}, noted. Recover before the next set.`],
  },
  analyst: {
    pr: [(b) => `${b}: new personal record, logged.`, (b) => `Record: ${b}. Best on file for this lift.`, (b) => `${b}. New high mark in your history.`],
    set: [(b) => `${b} logged. Data point added.`, (b) => `${b} recorded to history.`, (b) => `Logged: ${b}. Trend updated.`],
  },
};

/** What Jim says when a set is saved. Same numbers for every persona. */
export function loggedText(persona, { exercise, reps, weight, unit, isPR }, seed = 0) {
  const name = exerciseName(exercise).toLowerCase();
  const base = weight > 0 ? `${reps} ${name} at ${weight} ${unit}` : `${reps} ${name}`;
  return pick(byPersona(LOGGED, persona)[isPR ? 'pr' : 'set'], seed)(base);
}

const REST = {
  coach: [(s) => `Rest ${s} seconds, then set up with good form.`, (s) => `${s} seconds of rest. Think about your next cue.`, (s) => `Take ${s} seconds. Reset your grip and stance.`],
  hype: [(s) => `${s} seconds to recharge! Then we go again!`, (s) => `Quick ${s} second breather! Next set is yours!`, (s) => `Rest ${s} seconds! Stay hyped!`],
  drill: [(s) => `Rest ${s} seconds. Then back on the plan.`, (s) => `${s} seconds. Not more. Next set waits.`, (s) => `You have ${s} seconds. Be ready.`],
  zen: [(s) => `Rest ${s} seconds, or longer if you need it. Breathe slowly.`, (s) => `${s} seconds to recover. Let your breathing settle.`, (s) => `Ease into ${s} seconds of rest. Listen to your body.`],
  analyst: [(s) => `${s} seconds rest. Consistent rest keeps the data comparable.`, (s) => `Rest interval: ${s} seconds.`, (s) => `${s} second rest logged as your standard.`],
};

/** Line shown/spoken with the rest timer. */
export function restText(persona, seconds, seed = 0) {
  return pick(byPersona(REST, persona), seed)(seconds);
}
