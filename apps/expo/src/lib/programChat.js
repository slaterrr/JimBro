// Chat around a saved program: start the intake, then answer "What's today's workout?",
// "Why this exercise?", "Swap this movement" and "Make this session shorter" from the program
// itself. Pure functions; the chat screen shows the cards and asks before saving anything.
import { EXERCISES, exerciseName } from './exercises.js';
import { nextQuestion, parseProgramRequest, prefillIntake, programLoadText, programNext, programSubstitutes, shortenSession } from './program.js';

/** Start a program conversation, or null when the message isn't a program request. */
export function startProgramChat(message, { settings = {} } = {}) {
  const parsed = parseProgramRequest(message);
  if (!parsed.recognized) return null;
  const intake = prefillIntake(parsed.intake, settings);
  return { intake, question: nextQuestion(intake) };
}

// Exercise mentions in free text, longest alias first ("romanian deadlift" before "deadlift").
const ALIASES = EXERCISES.flatMap(({ id, name }) => {
  const base = [name.toLowerCase(), id.replace(/_/g, ' ')];
  if (id === 'bench') base.push('bench');
  if (id === 'bent_over_row') base.push('rows', 'row');
  if (id === 'pull_up') base.push('pullups', 'pullup');
  if (id === 'tricep_pushdown') base.push('pushdowns', 'pushdown');
  return [...new Set(base)].map((a) => [a, id]);
}).sort((a, b) => b[0].length - a[0].length);

export function mentions(text) {
  let rest = ` ${text.toLowerCase().replace(/[^a-z0-9 -]/g, ' ')} `;
  const found = [];
  for (const [alias, id] of ALIASES) {
    const re = new RegExp(`\\b${alias.replace(/-/g, '[- ]?')}(e?s)?\\b`);
    const m = re.exec(rest);
    if (!m) continue;
    found.push({ id, at: m.index });
    rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

const reps = (i) => (i.reps_low === i.reps_high ? `${i.reps_low}` : `${i.reps_low}–${i.reps_high}`);
const rpe = (i) => (i.rpe_low === i.rpe_high ? `${i.rpe_low}` : `${i.rpe_low}–${i.rpe_high}`);
const rest = (s) => (s >= 120 ? `${Math.round((s / 60) * 2) / 2} min` : `${s} s`);
export const itemLine = (i) => `${exerciseName(i.exercise)} ${i.sets} × ${reps(i)}${i.per_side ? ' per leg' : ''} @ RPE ${rpe(i)}, rest ${rest(i.rest_sec)}`;

function today({ plan, history = [], active }) {
  const program = plan.program;
  if (active?.planned?.programId === program.id) {
    const week = program.weeks[(active.planned.week ?? 1) - 1];
    const session = week?.sessions.find((s) => s.day === active.planned.day) ?? week?.sessions[0];
    if (session) return { week: week.week, day: session.day, session, deload: week.deload, name: active.name, running: true };
  }
  const next = programNext(program, history);
  return next.done ? null : { ...next, running: false };
}

/** Answer a program question, or null so the regular chat handles the message. */
export function programQuery(message, { plan, history = [], active = null } = {}) {
  if (!plan?.program) return null;
  const text = message.trim();
  const program = plan.program;
  const t = today({ plan, history, active });
  const named = mentions(text);

  if (/\b(what('?s| is)|show( me)?|tell me)\b.*\b(today'?s?|todays)\b.*\b(workout|session|training|plan)\b|\bwhat am i (training|doing|lifting)( today)?\b|\btoday'?s (workout|session)\b/i.test(text)) {
    if (!t) return { type: 'today', reply: `You've finished every session of ${program.name}. Ask me to build your next block.`, session: null };
    const s = t.session;
    const lines = s.items.map(itemLine).join('; ');
    const reply = `${t.running ? 'You are in' : 'Today is'} Week ${t.week} · Day ${s.day} · ${s.name} (about ${Math.round(s.estimated_minutes)} min${t.deload ? ', deload week' : ''}): ${lines}. Warm up first: ${s.warmup[0].toLowerCase()}`;
    return { type: 'today', reply, session: s, week: t.week, name: `Week ${t.week} · Day ${s.day} · ${s.name}` };
  }

  if (/\bwhy\b/i.test(text) && (named.length || /\b(this|that|the) (exercise|movement|lift)\b|\bwhy (this|that)\b/i.test(text))) {
    const id = named[0] ?? (active?.sets?.at(-1)?.exercise) ?? t?.session?.items[0]?.exercise;
    const week = program.weeks[(t?.week ?? 1) - 1];
    const item = [week, ...program.weeks].flatMap((w) => w?.sessions ?? []).flatMap((s) => s.items).find((i) => i.exercise === id);
    if (!item) return { type: 'why', reply: `${exerciseName(id)} isn't in your program. Ask me to swap it in if you want it.` };
    return { type: 'why', exercise: id, reply: `${exerciseName(id)}: ${item.why} In week ${t?.week ?? 1} it's ${itemLine(item).replace(`${exerciseName(id)} `, '')}. ${programLoadText(item.exercise, item.load.from, t?.deload)}` };
  }

  if (/\b(swap|replace|substitute|switch out|alternative to|instead of)\b/i.test(text)) {
    const from = named[0] ?? (active?.sets?.at(-1)?.exercise) ?? t?.session?.items[0]?.exercise;
    const inProgram = program.weeks.some((w) => w.sessions.some((s) => s.items.some((i) => i.exercise === from)));
    if (!from || !inProgram) return { type: 'swap', from: from ?? null, options: [], reply: `${from ? exerciseName(from) : 'That exercise'} isn't in your program, so there's nothing to swap.` };
    const options = programSubstitutes(from, program.intake).slice(0, 3).map((o) => ({ exercise: o.exercise, reasons: o.reasons }));
    const to = named[1] && options.some((o) => o.exercise === named[1]) ? named[1] : null;
    const reply = options.length
      ? `Swaps for ${exerciseName(from).toLowerCase()} that fit your equipment and limitations: ${options.map((o) => `${exerciseName(o.exercise).toLowerCase()} (${o.reasons[0]})`).join('; ')}. Pick one below; I'll ask before changing your program.`
      : `Nothing in the library replaces ${exerciseName(from).toLowerCase()} with your equipment and limitations.`;
    return { type: 'swap', from, to, options, fromWeek: t?.week ?? 1, reply };
  }

  const shorter = /\b(shorter|less time|quicker|cut (it|this|today) (short|down))\b/i.test(text) || /\bmake (this|today|it)( session| workout)? (\d{2,3}) ?min/i.test(text) || /\bmake (today|this session|it) \d{2,3}\b/i.test(text);
  if (shorter) {
    if (!t?.session) return { type: 'shorter', session: null, reply: 'There is no program session left to shorten.' };
    const asked = /(\d{2,3})\s*(min|minutes)?/i.exec(text);
    const minutes = Math.max(20, asked ? Number(asked[1]) : Math.round(t.session.estimated_minutes - 15));
    const session = shortenSession(t.session, minutes);
    const dropped = t.session.items.filter((i) => !session.items.some((x) => x.exercise === i.exercise)).map((i) => exerciseName(i.exercise).toLowerCase());
    const reply = `A ${Math.round(session.estimated_minutes)}-minute version of ${t.session.name}: ${session.items.map(itemLine).join('; ')}.${dropped.length ? ` Left out today: ${dropped.join(', ')}.` : ' Fewer sets, same exercises.'} Your saved program doesn't change.`;
    return { type: 'shorter', session, week: t.week, name: `Week ${t.week} · Day ${t.session.day} · ${t.session.name} (short)`, reply };
  }
  return null;
}
