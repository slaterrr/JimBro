// Ported from apps/mobile/src/voice/parse.ts. Works on typed text or keyboard dictation;
// the UI always asks for confirmation before saving.


export const EXERCISE_PATTERNS = [
  ["shoulder_press", /\b(shoulder|overhead|military)\s+press(es)?\b/],
  ["bench", /\bbench(\s+press(es)?)?\b/],
  ["deadlift", /\bdead\s?lifts?\b/],
  ["pull_up", /\b(pull|chin)[\s-]?ups?\b/],
  ["squat", /\bsquats?\b/],
  ["lunge", /\blunges?\b/],
  ["curl",/\b(bicep\s+)?curls?\b/],
];

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Turn number words into digits ("twenty five" -> "25"). */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
      (_, t, u) => String(WORDS[t] + WORDS[u]))
    .replace(/\b[a-z]+\b/g, (w) => (w in WORDS ? String(WORDS[w]) : w));
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

export function parseSetUtterance(raw) {
  const text = normalise(raw);
  const match = EXERCISE_PATTERNS.find(([, re]) => re.test(text));
  if (!match) return null;
  const exercise = match[0];

  let rest = text;
  let rpe;
  const rpeMatch = rest.match(new RegExp(String.raw`\brpe\s*(?:of\s*)?${NUM}`));
  if (rpeMatch) {
    const v = Number(rpeMatch[1]);
    if (v >= 1 && v <= 10) rpe = v;
    rest = rest.replace(rpeMatch[0], " ");
  }

  let weight;
  let unit;
  const w = rest.match(new RegExp(String.raw`${NUM}\s*(kg|kgs|kilos?|kilograms?|lb|lbs|pounds?)\b`));
  if (w) {
    weight = Number(w[1]);
    unit = w[2].startsWith("k") ? "kg" : "lb";
    rest = rest.replace(w[0], " ");
  }

  let reps;
  const r = rest.match(new RegExp(String.raw`${NUM}\s*(?:reps?|times)\b`));
  if (r) {
    reps = Number(r[1]);
    rest = rest.replace(r[0], " ");
  }
  const numbers = [...rest.matchAll(new RegExp(NUM, "g"))].map((m) => Number(m[1]));
  if (reps === undefined) reps = numbers.shift();
  if (weight === undefined && numbers.length) weight = numbers.shift();
  if (reps === undefined || !Number.isInteger(reps)) return null;

  const out = { exercise, reps, weight: weight ?? 0 };
  if (unit) out.unit = unit;
  if (rpe !== undefined) out.rpe = rpe;
  return out;
}
