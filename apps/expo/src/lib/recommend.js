// Adaptive next-set recommendation. Conservative, explained and optional: the app shows it, the
// user approves or keeps the plan, and the outcome is checked afterwards (evaluateRecommendations).
// Inputs: completed vs. target reps, reported effort (RPE/RIR), the fatigue assessment
// (lib/performance.js), where we are in the workout, and how the last accepted change went.
// Velocity loss reaches this only through the fatigue level: one signal, never a decision alone.

export const ACTIONS = ['increase', 'same', 'decrease', 'more_rest', 'fewer_reps', 'none'];

const INCREMENT = { kg: 0.5, lb: 2.5 }; // same steps as Jim's next-set suggestion (coach.js)
const MAX_UP = 0.05; // at most +5%
const DOWN = 0.075; // a missed set backs off ~7.5%
const EXTRA_REST_S = 60;
const VERY_HARD_RPE = 9.5;
const EASY_RPE = 7;
const BEAT_TARGET_BY = 2; // reps over target that justify an increase without an effort rating
const MEASURED_HARD_PCT = 30; // camera slowdown that counts as 'hard'
const MEASURED_STEADY_PCT = 15;

const round2 = (x) => Math.round(x * 100) / 100;

/** Did the last accepted increase on this exercise turn out too hard? */
function lastIncreaseTooHard(history, exercise) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.exercise !== exercise || !h.rec?.accepted || h.rec.action !== 'increase') continue;
    const next = history.slice(i + 1).find((x) => x.exercise === exercise);
    return next ? outcome(h, next) === 'too_hard' : false;
  }
  return false;
}

function outcome(entry, next) {
  const target = next.target ?? entry.rec?.reps ?? entry.reps;
  if (next.reps < target || (next.rpe != null && next.rpe >= VERY_HARD_RPE)) return 'too_hard';
  if (next.rpe != null && next.rpe <= 6 && entry.rec?.action !== 'increase') return 'too_easy';
  return 'worked';
}

/**
 * Next-set recommendation. Returns { action, weight, reps, extraRestS, reasons[], needsApproval }.
 * setNo/sets: position in the current workout (null outside a planned workout).
 */
export function recommendNext({ exercise, unit = 'lb', weight, target, completed, rpe = null, rir = null, fatigue = null, setNo = null, sets = null, history = [], metrics = null }) {
  // Two sources of effort: what the camera measured (rep slowdown, relative) and what the user
  // reported (RPE / reps left). Agreement raises confidence; when they disagree the cautious one wins.
  const vl = metrics?.velocityLossPct ?? null;
  const ratedAny = rpe != null || rir != null;
  const feltEasy = (rpe != null && rpe <= EASY_RPE) || (rir != null && rir >= 3);
  const feltHard = (rpe != null && rpe >= 9) || (rir != null && rir <= 1);
  const agreement = vl == null ? (ratedAny ? 'reported_only' : 'none')
    : !ratedAny ? 'measured_only'
      : vl >= MEASURED_HARD_PCT && feltEasy ? 'measured_harder'
        : vl < MEASURED_STEADY_PCT && feltHard ? 'reported_harder'
          : 'agree';
  const evidence = [];
  if (vl != null) evidence.push({ source: 'measured', text: vl < MEASURED_STEADY_PCT ? `Rep speed held steady (${vl}% slower at the end, camera, relative).` : `Rep speed fell ${vl}% from first to last reps (camera, relative).` });
  if (ratedAny) evidence.push({ source: 'reported', text: rir != null ? `You said ${rir >= 4 ? '4 or more' : rir} rep${rir === 1 ? '' : 's'} left.` : `You rated it RPE ${rpe}.` });
  const confidence = agreement === 'agree' ? 'higher' : 'lower';
  const out = (action, extra = {}, reasons = []) => ({
    action, weight, reps: target, extraRestS: 0, needsApproval: true, reasons, agreement, confidence, evidence, ...extra,
  });
  if (completed === 0) return out('none', {}, ['No reps were logged for this set, so there is nothing to base a change on.']);
  if (weight == null || completed == null) {
    return out('none', {}, ['Log the weight and reps for this set first; then I can suggest the next one.']);
  }
  const inc = INCREMENT[unit] ?? INCREMENT.lb;
  const level = fatigue?.level ?? 'uncertain';
  const midWorkout = setNo != null && sets != null && setNo < sets;
  const rated = rpe != null || rir != null;
  const easy = (rpe != null && rpe <= EASY_RPE) || (rir != null && rir >= 3);
  const veryHard = (rpe != null && rpe >= VERY_HARD_RPE) || (rir != null && rir <= 0);
  const short = target ? target - completed : 0;
  const bodyweight = weight === 0;

  if (short > 0) {
    if (level === 'failed_attempt' || short >= 3) {
      if (bodyweight) return out('fewer_reps', { reps: completed }, [`You got ${completed} of ${target}. Aim for ${completed} clean reps next set.`]);
      let down = Math.round((weight * (1 - DOWN)) / inc) * inc;
      if (down >= weight) down = weight - inc;
      return out('decrease', { weight: round2(Math.max(0, down)) }, [
        `You got ${completed} of ${target} reps${level === 'failed_attempt' ? ' and the last attempt didn\'t finish' : ''}.`,
        `A small drop to ${round2(Math.max(0, down))} ${unit} keeps the reps clean.`,
      ]);
    }
    if (midWorkout) return out('fewer_reps', { reps: completed }, [`You got ${completed} of ${target}. Same weight, aim for ${completed} next set.`]);
    return out('same', {}, [`You got ${completed} of ${target}. Keep ${weight} ${unit} and try for all ${target} next time.`]);
  }

  // Target met.
  if (bodyweight) {
    return out('same', { reps: easy ? target + 1 : target }, [easy ? 'That felt easy: add one rep next set.' : 'Same reps: own the form.']);
  }
  if (level === 'possible_fatigue' && midWorkout) {
    return out('more_rest', { extraRestS: EXTRA_REST_S }, [
      `All ${target} reps, but ${fatigue?.signals?.[0]?.replace(/\.$/, '').toLowerCase() ?? 'your reps slowed down'}.`,
      `Same weight, with ${EXTRA_REST_S} s extra rest before the next set.`,
    ]);
  }
  if (veryHard) return out('same', {}, [`All ${target} reps, but ${rpe != null ? `RPE ${rpe}` : 'no reps left'}. Hold ${weight} ${unit}.`]);
  if (agreement === 'measured_harder') {
    return out('same', {}, [
      `Your reps slowed ${vl}% by the end even though you felt you had more left, so keep ${weight} ${unit} for one more set to check before adding weight.`,
    ]);
  }
  if (lastIncreaseTooHard(history, exercise)) {
    return out('same', {}, ['Your last increase on this lift turned out too hard last time, so hold this weight a little longer.']);
  }
  const beat = completed >= target + BEAT_TARGET_BY;
  if ((easy && (level === 'normal' || level === 'uncertain')) || (!rated && beat)) {
    let up = Math.floor((weight * (1 + MAX_UP)) / inc) * inc;
    if (up <= weight) up = weight + inc;
    return out('increase', { weight: round2(up) }, [
      easy ? `All ${target} reps at ${rpe != null ? `RPE ${rpe}` : `${rir} reps left`}.` : `${completed} reps against a target of ${target}.`,
      `A small step to ${round2(up)} ${unit} is reasonable${midWorkout ? ' for the next set' : ' next session'}.`,
    ]);
  }
  if (!rated) return out('same', {}, ['All reps done. Rate how hard it was so I can suggest a change.']);
  return out('same', {}, [`All ${target} reps at a solid effort. Keep ${weight} ${unit}.`]);
}

/** How did accepted recommendations work out? Counts only; claims nothing until there's data. */
export function evaluateRecommendations(history = []) {
  const r = { accepted: 0, declined: 0, worked: 0, tooHard: 0, tooEasy: 0, pending: 0 };
  history.forEach((h, i) => {
    if (!h.rec || h.rec.action === 'none') return;
    if (!h.rec.accepted) {
      r.declined += 1;
      return;
    }
    r.accepted += 1;
    const next = history.slice(i + 1).find((x) => x.exercise === h.exercise);
    if (!next) r.pending += 1;
    else ({ worked: () => (r.worked += 1), too_hard: () => (r.tooHard += 1), too_easy: () => (r.tooEasy += 1) })[outcome(h, next)]();
  });
  const checked = r.worked + r.tooHard + r.tooEasy;
  const enoughData = checked >= 5;
  return {
    ...r,
    checked,
    enoughData,
    text: enoughData
      ? `Of ${checked} suggestions you took, ${r.worked} led to a completed set${r.tooHard ? ` and ${r.tooHard} were too hard` : ''}.`
      : `Too early to judge my suggestions: ${checked} checked so far, I need at least 5.`,
  };
}
