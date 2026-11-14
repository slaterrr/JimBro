// Equipment-aware exercise substitution. Only exercises from the library (lib/exercises.js) that
// the user's equipment allows; ranked by movement pattern and shared muscles; excludes patterns the
// user said to avoid and, for beginners, much harder variations. Loads never carry over.
import { canDo, EXERCISES, exerciseInfo, exerciseName } from './exercises.js';
import { EXERCISE_MUSCLES } from './muscles.js';

const MIN_SCORE = 1.5;
const MAX_OPTIONS = 3;
const label = (s) => s.replace(/_/g, ' ');
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * substitutes(exerciseId, { equipment: ids the user has, avoid: patterns to skip, level: 1-3 })
 * -> { options: [{ exercise, score, reasons[], loadNote }], note }
 */
export function substitutes(exerciseId, { equipment = [], avoid = [], level = null } = {}) {
  const target = exerciseInfo(exerciseId);
  if (!target) return { options: [], note: 'That exercise is not in the library.' };
  const muscles = new Set(EXERCISE_MUSCLES[exerciseId] ?? []);
  const options = [];
  for (const { id } of EXERCISES) {
    if (id === exerciseId || !canDo(id, equipment)) continue;
    const info = exerciseInfo(id);
    if (avoid.includes(info.pattern)) continue;
    if (level != null && info.level > level + 1) continue; // beginners: no big jumps in difficulty
    const theirs = EXERCISE_MUSCLES[id] ?? [];
    const shared = theirs.filter((m) => muscles.has(m));
    const union = new Set([...muscles, ...theirs]).size || 1;
    const samePattern = info.pattern === target.pattern;
    let score = (samePattern ? 3 : 0) + (3 * shared.length) / union;
    if (level != null) score -= 0.4 * Math.max(0, info.level - level);
    const cam = EXERCISES.find((e) => e.id === id)?.camera;
    if (cam) score += 0.3;
    if (score < MIN_SCORE) continue;
    const reasons = [];
    if (samePattern) reasons.push(`Same movement pattern (${label(info.pattern)}).`);
    if (shared.length) reasons.push(`Trains ${list(shared.map(label))} like ${exerciseName(exerciseId).toLowerCase()}.`);
    if (cam) reasons.push('The camera can count it.');
    const gear = info.needs.map((g) => g.find((x) => x === 'bodyweight' || equipment.includes(x))).filter((x) => x && x !== 'bodyweight');
    reasons.push(gear.length ? `Works with your ${list(gear.map(label))}.` : 'Needs no equipment.');
    const bodyweight = info.needs.every((g) => g.includes('bodyweight'));
    options.push({
      exercise: id,
      score: Math.round(score * 100) / 100,
      reasons,
      loadNote: bodyweight
        ? 'Bodyweight: start with reps you could repeat two or three more times.'
        : `Loads don't carry over from ${exerciseName(exerciseId).toLowerCase()}: start lighter and rate the first set.`,
    });
  }
  options.sort((a, b) => b.score - a.score);
  const top = options.slice(0, MAX_OPTIONS);
  const note = top.length
    ? `${top.length} option${top.length > 1 ? 's' : ''} from your library for ${exerciseName(exerciseId).toLowerCase()}.`
    : `Nothing in the library fits: no ${label(target.pattern)} exercise works with your equipment, and nothing close enough does either.`;
  return { options: top, note };
}
