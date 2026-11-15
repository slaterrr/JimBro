import { SAFETY, SAFETY_TEXT } from './coach.js';
import { answerContext } from './coachQA.js';
import { exerciseName } from './exercises.js';
import { currentTarget, missionStep } from './mission.js';
import { answerPerformance } from './perfCoach.js';
import { repMetrics } from './performance.js';
import { appendWorkoutSet } from './workoutLogging.js';
import { isRetiredExercise } from './retiredExercises.js';

const LOAD = /^(?:(\d{1,4}(?:\.\d{1,2})?)\s*(lb|lbs|pounds?|kg|kgs|kilos?|kilograms?)|body\s*weight)$/i;
const EFFORT = /^(?:(?:the )?(?:last (?:rep|one)|(?:the )?\d{1,2}(?:st|nd|rd|th)(?: rep)?) (?:was )?(?:a )?)?(?:(?:a |a bit |of a |little |slight |very )*(?:grind(?:y)?|hard|tough|easy|controlled|smooth|slow|burn(?:ed|ing)?|to failure))(?: on (?:the )?(?:last rep|rep \d{1,2}))?$/i;
const STOP = /^(?:stop(?: coaching| counting| camera)?|pause(?: coaching| counting| camera)?)[.!]?$/i;
const RESUME = /^(?:resume(?: coaching| counting| camera)?|continue)[.!]?$/i;

export function coachPauseCommand(text) {
  if (SAFETY.test(text)) return { paused: true, reply: SAFETY_TEXT };
  if (STOP.test(text)) return { paused: true, reply: 'Coaching paused. Type “resume” when you’re ready to continue.' };
  if (RESUME.test(text)) return { paused: false, reply: 'Coaching resumed. Pick up with the same set.' };
  return null;
}

function readLoad(text) {
  const match = text.match(LOAD);
  if (!match) return null;
  if (!match[2]) return { weight: 0 };
  const weight = Number(match[1]);
  if (weight > 1000) return null;
  return { weight, unit: /^k/i.test(match[2]) ? 'kg' : 'lb' };
}

/** Bounded workout shorthand. Ordinary questions can never become writes. */
export function parseCoachReport(message, { reps: measured, awaitingWeight = false } = {}) {
  const text = message.trim().replace(/[.!]$/, '');
  if (SAFETY.test(text) || text.includes('?')) return null;
  if (awaitingWeight) {
    const load = readLoad(text);
    if (load) return load;
  }
  const parts = text.match(/^(?:(?:done|i did|i got|got|finished|completed|log)\s+)?(\d{1,3})(?:\s*(?:reps?|times)\b)?(?=$|[,\s])(?:\s*[,;]?\s*)(.*)$/i);
  if (!parts) return measured > 0 && EFFORT.test(text) ? { reps: measured, effortNote: text } : null;
  const reps = Number(parts[1]);
  if (reps < 1 || reps > 100) return null;
  let tail = parts[2].trim();
  let load = null;
  if (/^(?:at|with)\s/i.test(tail)) {
    const [weight, ...notes] = tail.replace(/^(?:at|with)\s+/i, '').split(/,\s*/);
    load = readLoad(weight);
    if (!load) return null;
    tail = notes.join(', ');
  }
  if (tail && !EFFORT.test(tail)) return null;
  return { reps, ...load, ...(tail ? { effortNote: tail } : {}) };
}

export function coachSetBody(target, report, detail = []) {
  const { reps, weight, effortNote, rir = null } = report;
  const camera = target.camera && reps > 0 && detail.length === reps;
  const measured = camera ? repMetrics(target.exercise, detail) : null;
  return {
    exercise: target.exercise, unit: target.unit, target: target.reps, reps, weight,
    source: camera ? 'camera' : 'manual', reps_detail: camera ? detail : [],
    rpe: rir == null ? null : 10 - rir,
    rir,
    ...(effortNote ? { effortNote } : {}),
    ...(measured ? { metrics: { calibrated: false, meanLiftMs: measured.meanLiftMs, velocityLossPct: measured.velocityLossPct, romLossPct: measured.romLossPct, consistencyCv: measured.consistencyCv } } : {}),
  };
}

export function coachLoadLabel(target) {
  if (target.weight == null) return 'choose your load';
  return target.weight === 0 ? 'bodyweight' : target.weight + ' ' + target.unit;
}

export function answerCoachSet(text, { target, phase, ...context }) {
  if (/(?:what(?:'s| is) next|what (?:set|exercise) (?:am i on|is next))/i.test(text) && target) {
    const setLabel = target.sets == null ? '' : ' · set ' + target.setNo + ' of ' + target.sets;
    return exerciseName(target.exercise) + setLabel + ' · ' + target.reps + ' reps · ' + coachLoadLabel(target) + '.';
  }
  if (/what (?:other exercises|else|exercises) (?:do i have|are left)/i.test(text)) {
    return answerContext('How many sets are left?', context);
  }
  if (/bench.*(?:angle|degree)|(?:angle|degree).*bench/i.test(text) && !/(?:incline|decline)/i.test(text) && /bench/.test(target?.exercise ?? '')) {
    return 'For the flat bench press in this session, use the flat bench setting.';
  }
  return answerPerformance(text, context) ?? answerContext(text, context)
    ?? (phase === 'rest' ? 'Your next set is shown with the timer. Ask me what’s left or wait for the timer before logging again.'
      : 'I can log a set or answer questions about this workout. Try “8, little grind” or “what’s next?”');
}

/** Workout log and Mission pointer share a single functional state update. */
export function applyCoachSet(data, { workoutId, expectedCount, slot, set, event, restSeconds = 0, now }) {
  if (!workoutId || data.active?.id !== workoutId || isRetiredExercise(set?.exercise)) return data;
  if (!slot) {
    if (data.mission || data.active.sets.length !== expectedCount || data.active.coachRest?.until > now) return data;
    const saved = appendWorkoutSet(data, set, workoutId);
    return { ...saved, active: { ...saved.active, coachRest: restSeconds > 0 ? { exercise: set.exercise, until: now + restSeconds * 1000 } : null } };
  }

  const s = data.mission?.state;
  if (!s || data.mission.startedAt !== slot.startedAt || s.i !== slot.index || s.setNo !== slot.setNo
      || !['set', 'check'].includes(s.phase) || currentTarget(s)?.exercise !== set.exercise) return data;
  const check = { ...s, phase: 'check', pending: { reps: set.reps, reps_detail: set.reps_detail } };
  const next = missionStep(check, { ...event, type: 'confirm', rpe: set.rpe, weight: set.weight });
  if (next === check) return data;
  const log = [...next.log.slice(0, -1), {
    ...next.log.at(-1), camera: set.source === 'camera',
    ...(set.effortNote ? { effortNote: set.effortNote } : {}),
  }];
  const restUntil = next.phase === 'rest' ? now + currentTarget(next).rest_s * 1000 : null;
  const saved = appendWorkoutSet(data, set, workoutId);
  return { ...saved, mission: { ...data.mission, state: { ...next, log, restUntil } } };
}
