// Workout-context answers from the user's records: today's workout, sets left, why reps slowed,
// substitutions, progress on a lift, a shorter session, and rest. Missing data is said plainly;
// nothing is invented. Returns null for anything else so the AI (or rules) can answer.
// ctx: { history, active, plan, settings, profile: { equipment?, avoid?, level? } }
import { EXERCISES, exerciseName } from './exercises.js';
import { nextWorkout } from './homeActions.js';
import { repMetrics } from './performance.js';
import { restFor } from './rest.js';
import { substitutes } from './substitute.js';

const TODAY = /\b(what am i (training|doing|lifting)|what('?s| is) (my )?(workout|plan|training)( for)? today|today'?s (workout|plan|session))\b/i;
const SETS_LEFT = /\bhow many sets\b.*\b(left|remaining|to go)\b|\bsets (left|remaining)\b/i;
const WHY_SLOW = /\bwhy\b.*\b(reps?|repetitions|set)\b.*\b(slow|slower|slowing|slowed)\b/i;
const INSTEAD = /\b(instead of|alternatives? (to|for)|substitute (for )?|swap (out )?|replace)\b/i;
const PROGRESS = /\b(how (has|is|have|did) my .+ (progress|progressed|progressing|improv\w*|going|gone)|progress (on|in|with|for) )/i;
const SHORTER = /\b(shorter|quicker|cut (it|the workout|today) (down|short))\b/i;
const REST = /\b(how long (should|do|can) i rest|how much rest|rest time)\b/i;

const ALL_EQUIPMENT = ['barbell', 'dumbbells', 'kettlebell', 'bench', 'pullup_bar', 'dip_bars', 'cable', 'machine'];
const lower = (id) => exerciseName(id).toLowerCase();
const workoutsOf = (history = [], active = null) => [...history, ...(active ? [active] : [])];
const allSets = (history, active) => workoutsOf(history, active).flatMap((w) => (w.sets ?? []).map((s) => ({ ...s, at: s.loggedAt ?? w.startedAt })));
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const e1rm = (s) => s.weight * (1 + s.reps / 30); // Epley estimate

/** The library exercise a message names (longest name wins: "dumbbell bench press" over "bench press"). */
export function findExercise(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s-]/g, ' ')} `;
  const hits = EXERCISES.filter((e) => {
    const n = e.name.toLowerCase();
    return t.includes(` ${n}`) || t.includes(` ${n}s`) || t.includes(` ${n}es`) || t.includes(` ${e.id.replace(/_/g, ' ')}`);
  });
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0]?.id ?? null;
}

function remaining(active) {
  const items = active?.planned?.items;
  if (!items?.length) return null;
  const done = {};
  for (const s of active.sets ?? []) done[s.exercise] = (done[s.exercise] ?? 0) + 1;
  return items.map((i) => ({ ...i, left: Math.max(0, i.sets - (done[i.exercise] ?? 0)) })).filter((i) => i.left > 0);
}
const setMinutes = (i) => 1 + (i.rest_min ?? 1.5); // one working minute plus rest

export function answerContext(text, { history = [], active = null, plan = null, settings = {}, profile = {} } = {}) {
  if (TODAY.test(text) && !SHORTER.test(text)) {
    if (active?.planned?.items?.length) {
      return `You're in ${active.name ?? 'your workout'}: ${list(active.planned.items.map((i) => `${lower(i.exercise)} ${i.sets} sets`))}.`;
    }
    const next = nextWorkout(plan, history);
    if (!next.planned) return "You don't have a plan yet. Tap Create a New Plan, or tell me how long you have, like \"I have 30 minutes\".";
    return `Today is ${next.name}: ${list(next.planned.items.map((i) => `${lower(i.exercise)} ${i.sets} sets of ${i.reps_low === i.reps_high ? i.reps_low : `${i.reps_low}–${i.reps_high}`}`))}.`;
  }

  if (SETS_LEFT.test(text)) {
    const left = remaining(active);
    if (!left) return "There's no planned workout running. Start one from Home and I'll keep count.";
    const n = left.reduce((a, i) => a + i.left, 0);
    if (!n) return 'No sets left: every planned set is done. Nice work.';
    return `${n} sets left: ${list(left.map((i) => `${i.left} ${lower(i.exercise)}`))}.`;
  }

  if (WHY_SLOW.test(text)) {
    const sets = allSets(history, active);
    const last = sets.at(-1);
    if (!last) return "I don't have a set to look at yet.";
    if (!last.reps_detail?.length) return `The camera didn't time your last ${lower(last.exercise)} set, so I can't say how your reps changed. Count it with the camera and I can show rep times.`;
    const m = repMetrics(last.exercise, last.reps_detail);
    const lifts = m.reps.map((r) => r.lift_ms).filter((x) => x > 0);
    if (lifts.length < 3) return `Your last ${lower(last.exercise)} set had too few timed reps to compare.`;
    const k = Math.max(1, Math.floor(lifts.length / 3));
    const first = lifts.slice(0, k).reduce((a, b) => a + b, 0) / k / 1000;
    const end = lifts.slice(-k).reduce((a, b) => a + b, 0) / k / 1000;
    return `In your last ${lower(last.exercise)} set, your first reps took ${first.toFixed(1)} s to lift and your last ones ${end.toFixed(1)} s. Getting slower through a set is normal as the working muscles tire: it shows effort, it doesn't mean you hit your limit. Rest, sleep and how heavy the set was all play a part.`;
  }

  if (INSTEAD.test(text)) {
    const ex = findExercise(text);
    if (!ex) return "I can only suggest swaps for exercises in the library, and I didn't recognise that one.";
    const known = Array.isArray(profile.equipment);
    const s = substitutes(ex, { equipment: known ? profile.equipment : ALL_EQUIPMENT, avoid: profile.avoid ?? [], level: profile.level ?? null });
    if (!s.options.length) return s.note;
    const best = s.options[0];
    const others = s.options.slice(1).map((o) => lower(o.exercise));
    const why = best.reasons.slice(0, 2).join(' ');
    const more = others.length ? ` Also good: ${list(others)}.` : '';
    const ask = known ? '' : ' What equipment do you have? I can narrow it down.';
    return `Instead of ${lower(ex)}, try ${lower(best.exercise)}. ${why}${more} ${best.loadNote}${ask}`;
  }

  if (PROGRESS.test(text)) {
    const ex = findExercise(text);
    if (!ex) return null;
    const sessions = workoutsOf(history, active)
      .map((w) => ({ at: w.startedAt, sets: (w.sets ?? []).filter((s) => s.exercise === ex && s.weight > 0 && s.reps > 0) }))
      .filter((w) => w.sets.length)
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    if (!sessions.length) return `You haven't logged any ${lower(ex)} yet.`;
    const best = (w) => w.sets.reduce((a, s) => (e1rm(s) > e1rm(a) ? s : a));
    if (sessions.length === 1) {
      const b = best(sessions[0]);
      return `Only one ${lower(ex)} session so far (best ${b.weight} ${b.unit} × ${b.reps}). I need at least two to show progress.`;
    }
    const a = best(sessions[0]);
    const b = best(sessions.at(-1));
    if (a.unit !== b.unit) return `Your ${lower(ex)} sessions mix lb and kg, so I won't compare them directly.`;
    const pct = Math.round((100 * (e1rm(b) - e1rm(a))) / e1rm(a));
    return `${sessions.length} sessions of ${lower(ex)} since ${String(sessions[0].at).slice(0, 10)}: your best set went from ${a.weight} ${a.unit} × ${a.reps} to ${b.weight} ${b.unit} × ${b.reps}. Estimated 1RM ${Math.round(e1rm(a))} → ${Math.round(e1rm(b))} ${b.unit} (${pct >= 0 ? '+' : ''}${pct}%), an estimate from weight and reps.`;
  }

  if (SHORTER.test(text)) {
    const left = remaining(active);
    if (!left?.length) return 'Tell me how long you have, like "I have 20 minutes", and I\'ll plan a shorter session.';
    const now = left.reduce((a, i) => a + i.left, 0);
    const mins = Math.round(left.reduce((a, i) => a + i.left * setMinutes(i), 0));
    const cut = left.map((i) => ({ ...i, left: i.left >= 2 ? i.left - 1 : i.left }));
    const after = cut.reduce((a, i) => a + i.left, 0);
    const minsAfter = Math.round(cut.reduce((a, i) => a + i.left * setMinutes(i), 0));
    if (after === now) return `You have ${now} sets left, about ${mins} minutes. They're all single sets, so the quickest option is to skip an exercise. Which one?`;
    return `You have ${now} sets left, about ${mins} minutes. I can drop the last set of each remaining exercise: ${after} sets, about ${minsAfter} minutes. Want that?`;
  }

  if (REST.test(text)) {
    const last = allSets(history, active).at(-1);
    if (!last) return 'Most sets need 1 to 3 minutes. Log a set and I\'ll tailor it to the lift and your goal.';
    const r = restFor({ exercise: last.exercise, reps: last.reps, rpe: last.rpe ?? null, fitnessGoal: settings.fitnessGoal, experience: settings.experience, activityLevel: settings.activityLevel });
    return `After that ${lower(last.exercise)} set, rest about ${clock(r.seconds)}. ${r.text}`;
  }

  return null;
}
