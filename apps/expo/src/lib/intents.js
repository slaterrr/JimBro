// Deterministic intent layer for the Jim chat: turns typed or dictated text into a
// proposed change to the user's real data. Nothing here mutates anything; the UI shows
// `summary` and only applies the intent after the user confirms. Rule-based on purpose,
// so an LLM tool-call layer can later emit the same intent objects.
import { SAFETY } from './coach.js';
import { exerciseName } from './exercises.js';
import { EXERCISE_PATTERNS, normalise, parseSetUtterance } from './parse.js';

const UNIT = String.raw`(kg|kgs|kilos?|kilograms?|lb|lbs|pounds?)`;
const toUnit = (u) => (u.startsWith('k') ? 'kg' : 'lb');
const DELETE = /\b(delete|remove|undo|scratch|erase)\b/;
const CORRECT = /\b(actually|change|correct|fix|edit|meant|should(?: have)? been|that (?:last )?(?:set )?was|make (?:it|that))\b/;
const MAX_SETS = 10;

const name = (ex) => exerciseName(ex).toLowerCase();
const fmtSet = (s) => `${s.reps} × ${s.weight} ${s.unit}`;
const question = () => ({ type: 'question' });
const clarify = (q) => ({ type: 'clarify', question: q });

/** Exercises mentioned in the text, in the order they appear. */
function mentions(text) {
  return EXERCISE_PATTERNS
    .map(([ex, re]) => ({ ex, at: text.search(re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.ex);
}

/** Most recent set (active workout first, then history), optionally of one exercise. */
function lastSet({ history = [], active = null }, exercise) {
  const sets = [...history, ...(active ? [active] : [])].flatMap((w) => w.sets ?? []);
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    if (!exercise || sets[i].exercise === exercise) return sets[i];
  }
  return null;
}

function noSet(exercise) {
  return clarify(exercise ? `I can't find a ${name(exercise)} set to change. Which set do you mean?` : "You haven't logged any sets yet. Want to log one?");
}

function parseDelete(text, ctx) {
  const [ex] = mentions(text);
  const target = lastSet(ctx, ex);
  if (!target) return noSet(ex);
  return { type: 'delete', target: { setId: target.id }, summary: `Delete your last ${name(target.exercise)} (${fmtSet(target)})?` };
}

function parseCorrect(text, ctx) {
  const changes = {};
  let rest = text;
  let targetEx;
  const exes = mentions(text);

  const notIdx = text.indexOf(' not ');
  if (exes.length === 2 && notIdx > 0) {
    // "bench not squat": the one after "not" is what was logged.
    const after = mentions(text.slice(notIdx));
    targetEx = after[0];
    changes.exercise = exes.find((e) => e !== targetEx);
  } else if (exes.length === 2) {
    [targetEx, changes.exercise] = exes; // "change my last squat to bench"
  } else {
    [targetEx] = exes;
  }

  const unitSwap = rest.match(new RegExp(String.raw`\b${UNIT}\s+not\s+${UNIT}\b`));
  if (unitSwap) {
    changes.unit = toUnit(unitSwap[1]);
    rest = rest.replace(unitSwap[0], ' ');
  }
  const w = rest.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${UNIT}\b`));
  if (w) {
    changes.weight = Number(w[1]);
    changes.unit = toUnit(w[2]);
    rest = rest.replace(w[0], ' ');
  }
  const r = rest.match(/(\d+)\s*(?:reps?|times)\b/);
  if (r) {
    changes.reps = Number(r[1]);
    rest = rest.replace(r[0], ' ');
  }
  if (changes.weight === undefined) {
    const to = rest.match(/\bto\s+(\d+(?:\.\d+)?)\b/);
    if (to) {
      changes.weight = Number(to[1]);
      rest = rest.replace(to[0], ' ');
    }
  }
  const stray = rest.match(/\d+(?:\.\d+)?/);
  if (stray) return clarify(`Did you mean ${stray[0]} reps or ${stray[0]} ${ctx.unit ?? 'lb'}?`);
  if (!changes.unit) {
    const bareUnit = rest.match(new RegExp(String.raw`\b(?:in\s+)${UNIT}\b`));
    if (bareUnit) changes.unit = toUnit(bareUnit[1]);
  }
  if (!Object.keys(changes).length) return null;

  const target = lastSet(ctx, targetEx);
  if (!target) return noSet(targetEx);
  const next = { ...target, ...changes };
  const exPart = changes.exercise ? `${name(changes.exercise)} ` : '';
  return {
    type: 'correct',
    target: { setId: target.id },
    changes,
    summary: `Change your last ${name(target.exercise)} (${fmtSet(target)}) to ${exPart}${fmtSet(next)}?`,
  };
}

function parseLog(text, ctx) {
  let count = 1;
  let body = text;
  const multi = text.match(/\b(\d+)\s*sets?\s+of\s+/);
  if (multi) {
    count = Number(multi[1]);
    body = text.replace(multi[0], ' ');
    if (count < 1 || count > MAX_SETS) return clarify(`${count} sets? Tell me up to ${MAX_SETS} at a time.`);
  }
  const parsed = parseSetUtterance(body);
  if (!parsed) return null;
  const set = { ...parsed, unit: parsed.unit ?? ctx.unit ?? 'lb' };
  const sets = Array.from({ length: count }, () => ({ ...set }));
  const desc = `${set.reps} × ${name(set.exercise)} at ${set.weight} ${set.unit}${set.rpe ? `, RPE ${set.rpe}` : ''}`;
  return { type: 'log', set, sets, summary: count > 1 ? `Log ${count} sets of ${desc}?` : `Log ${desc}?` };
}

/**
 * text -> {type: 'log'|'correct'|'delete'|'clarify'|'question', ...}.
 * ctx: {history, active, unit} where unit is the user's default for unlabelled weights.
 */
export function parseIntent(raw, ctx = {}) {
  const original = String(raw ?? '').trim();
  if (!original || SAFETY.test(original)) return question();
  const text = normalise(original);
  if (DELETE.test(text)) return parseDelete(text, ctx);
  if (CORRECT.test(text) || /\bnot\b/.test(text)) {
    const c = parseCorrect(text, ctx);
    if (c) return c;
  }
  return parseLog(text, ctx) ?? question();
}

const mapSets = (data, fn) => ({
  ...data,
  active: data.active ? { ...data.active, sets: fn(data.active.sets) } : data.active,
  history: data.history.map((w) => ({ ...w, sets: fn(w.sets) })),
});

/** Pure: apply field changes to one set wherever it lives (active or history). */
export const applyUpdate = (data, id, changes) => mapSets(data, (sets) => sets.map((s) => (s.id === id ? { ...s, ...changes } : s)));

/** Pure: remove one set wherever it lives (active or history). */
export const applyDelete = (data, id) => mapSets(data, (sets) => sets.filter((s) => s.id !== id));
