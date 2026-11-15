// Weekly schedule for a saved program: which weekday runs which session, rest days, one-off swaps
// and the user's missed-workout policy. Stored with the plan, so it survives restarts.
//   keep_calendar  a missed workout stays missed; the calendar never moves (default)
//   push_back      a missed workout moves to the next training day; later sessions shift with it
// Pure functions: the screens read and change it through AppState (savePlan / saveSchedule).
import { addDays, completedWorkouts, dayKey, daysBetween, deviceTimeZone, WEEKDAY_NAMES, WEEKDAYS, weekdayOf, weekStartOf } from './attendance.js';
import { sessionPlanned } from './program.js';

export const SCHEDULE_SCHEMA = 'jimbro.schedule.v1';
export const MISSED_POLICIES = {
  keep_calendar: 'Keep the calendar: a missed workout stays missed and the week carries on.',
  push_back: 'Push it back: a missed workout moves to your next training day.',
};
export const DEFAULT_DAYS = {
  2: ['mon', 'thu'], 3: ['mon', 'wed', 'fri'], 4: ['mon', 'tue', 'thu', 'fri'],
  5: ['mon', 'tue', 'wed', 'fri', 'sat'], 6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
};

const weekMap = (days) => Object.fromEntries(WEEKDAYS.map((d) => [d, days.includes(d) ? days.filter((x) => WEEKDAYS.indexOf(x) < WEEKDAYS.indexOf(d)).length : null]));

// This week if none of its training days has passed yet, otherwise next Monday.
function firstFullWeek(today, days) {
  const monday = weekStartOf(today);
  const passed = days.some((d) => addDays(monday, WEEKDAYS.indexOf(d)) < today);
  return passed ? addDays(monday, 7) : monday;
}

export function createSchedule(program, { startDate, timeZone = deviceTimeZone(), trainingDays, missedPolicy = 'keep_calendar', now = new Date() } = {}) {
  const perWeek = program.intake.daysPerWeek;
  const days = trainingDays ?? DEFAULT_DAYS[perWeek];
  return {
    schema: SCHEDULE_SCHEMA, programId: program.id, timeZone, missedPolicy,
    startDate: startDate ?? firstFullWeek(dayKey(now, timeZone), days),
    week: weekMap([...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))),
    overrides: {},
  };
}

export function validateSchedule(schedule, program) {
  const p = [];
  if (schedule?.schema !== SCHEDULE_SCHEMA) return ['not a JimBro schedule'];
  if (!MISSED_POLICIES[schedule.missedPolicy]) p.push('unknown missed-workout policy');
  if (schedule.programId !== program.id) p.push('schedule belongs to another program');
  const perWeek = program.intake.daysPerWeek;
  const used = WEEKDAYS.map((d) => schedule.week?.[d]).filter((x) => x != null);
  if (used.length !== perWeek) p.push(`expected ${perWeek} training days, got ${used.length}`);
  if (new Set(used).size !== used.length || used.some((i) => !Number.isInteger(i) || i < 0 || i >= perWeek)) p.push('each session must be on exactly one weekday');
  for (const [date, o] of Object.entries(schedule.overrides ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(o?.session === null || (Number.isInteger(o?.session) && o.session < perWeek))) p.push(`bad override on ${date}`);
  }
  return p;
}

const assigned = (schedule, date) => (date in (schedule.overrides ?? {}) ? schedule.overrides[date].session : schedule.week[weekdayOf(date)]);

/** Which dates already have a completed workout (by its scheduled date, else the day it was done). */
function doneDates(history, timeZone) {
  const done = new Set();
  for (const w of completedWorkouts(history)) {
    done.add(dayKey(w.startedAt, timeZone));
    if (w.planned?.scheduledFor) done.add(w.planned.scheduledFor);
  }
  return done;
}

/** Everything about one date: type (workout/rest/none), the session, week and status. */
export function planFor(date, { schedule, program, history = [], today } = {}) {
  const tz = schedule.timeZone;
  const now = today ?? dayKey(new Date(), tz);
  const weekday = weekdayOf(date);
  const base = { date, weekday, day: WEEKDAY_NAMES[weekday], rescheduled: date in (schedule.overrides ?? {}) };
  const done = doneDates(history, tz);
  if (date < schedule.startDate) return { ...base, type: 'none', status: done.has(date) ? 'completed' : 'none' };
  const perWeek = program.intake.daysPerWeek;
  const idx = assigned(schedule, date);
  const status = (type) => (done.has(date) ? 'completed' : type === 'rest' ? 'rest' : date < now ? 'missed' : 'scheduled');
  if (idx == null) return { ...base, type: 'rest', name: 'Rest', status: status('rest') };

  let week = Math.floor(daysBetween(schedule.startDate, date) / 7) + 1;
  let sessionIndex = idx;
  let note = null;
  if (schedule.missedPolicy === 'push_back') {
    // Walk the training days in order; a missed past day does not use up its session.
    let pos = 0;
    for (let d = schedule.startDate; d < date; d = addDays(d, 1)) {
      if (assigned(schedule, d) == null) continue;
      if (d >= now || done.has(d)) pos += 1;
    }
    week = Math.floor(pos / perWeek) + 1;
    sessionIndex = pos % perWeek;
    if (date < now && !done.has(date)) note = 'Missed: this session moved to your next training day.';
  }
  if (week > program.weeks.length) return { ...base, type: 'none', status: done.has(date) ? 'completed' : 'none', name: 'Block complete' };
  const session = program.weeks[week - 1].sessions[sessionIndex];
  return { ...base, type: 'workout', week, sessionIndex, session, name: session.name, deload: program.weeks[week - 1].deload, status: status('workout'), note };
}

/** First date from today with a workout still to do. */
export function nextScheduled({ schedule, program, history = [], today } = {}) {
  const start = today ?? dayKey(new Date(), schedule.timeZone);
  const from = start < schedule.startDate ? schedule.startDate : start;
  const end = addDays(schedule.startDate, program.weeks.length * 7 + 14);
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const p = planFor(d, { schedule, program, history, today: start });
    if (p.type === 'workout' && p.status !== 'completed') return p;
  }
  return null;
}

/** What starting a scheduled session saves with the workout (so the date counts as done). */
export const plannedFor = (program, p) => ({ ...sessionPlanned(program, p.session, p.week), scheduledFor: p.date });
export const workoutName = (p) => `Week ${p.week} · ${p.day.slice(0, 3)} · ${p.name}`;

/** Swap what two dates hold, for those dates only. */
export function swapDates(schedule, a, b) {
  const sa = assigned(schedule, a);
  const sb = assigned(schedule, b);
  return { ...schedule, overrides: { ...schedule.overrides, [a]: { session: sb }, [b]: { session: sa } } };
}

/** Move a training weekday to a rest weekday, permanently. */
export function moveTrainingDay(schedule, from, to) {
  if (schedule.week[from] == null) throw new Error(`${WEEKDAY_NAMES[from]} is a rest day.`);
  if (schedule.week[to] != null) throw new Error(`${WEEKDAY_NAMES[to]} already has a workout. Swap the two days instead.`);
  return { ...schedule, week: { ...schedule.week, [to]: schedule.week[from], [from]: null } };
}

/** Swap two weekdays permanently (either may be a rest day). */
export function swapWeekdays(schedule, a, b) {
  return { ...schedule, week: { ...schedule.week, [a]: schedule.week[b], [b]: schedule.week[a] } };
}

export const isRestDayFor = (schedule) => (date) => date >= schedule.startDate && assigned(schedule, date) == null;

/** One month for the calendar view; weeks start on Monday. */
export function calendarMonth(month, ctx) {
  const first = `${month}-01`;
  const days = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) {
    const p = planFor(d, ctx);
    days.push({ date: d, dayOfMonth: Number(d.slice(8)), status: p.status, name: p.name ?? null, type: p.type, rescheduled: p.rescheduled });
  }
  return { month, leadingBlanks: WEEKDAYS.indexOf(weekdayOf(first)), days };
}
