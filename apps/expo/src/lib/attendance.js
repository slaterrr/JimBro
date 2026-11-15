// Gym attendance from completed workouts. One gym day per calendar day in the user's time zone,
// however many workouts that day. Opening the app never counts: a day counts only when a workout
// was finished with at least one saved set. JimBro does not detect physical gym presence.
const DAY_MS = 86400000;
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
};

/** 'YYYY-MM-DD' for an instant in a time zone. */
export function dayKey(instant, timeZone = deviceTimeZone()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const toUTC = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
export const addDays = (key, n) => new Date(toUTC(key) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
export const weekdayOf = (key) => WEEKDAYS[(new Date(toUTC(key)).getUTCDay() + 6) % 7];
/** Monday of the week containing `key`. */
export const weekStartOf = (key) => addDays(key, -WEEKDAYS.indexOf(weekdayOf(key)));

/** Finished workouts with at least one set, each id once (a retried save never counts twice). */
export function completedWorkouts(history = []) {
  const seen = new Set();
  return history.filter((w) => {
    if (!w?.finishedAt || !w.sets?.length || seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
}

export function workoutMinutes(w) {
  if (!w?.startedAt || !w?.finishedAt) return null;
  return Math.max(0, Math.round((new Date(w.finishedAt) - new Date(w.startedAt)) / 60000));
}

/** Sorted unique gym days ('YYYY-MM-DD'). */
export function gymDays(history, { timeZone = deviceTimeZone() } = {}) {
  return [...new Set(completedWorkouts(history).map((w) => dayKey(w.startedAt, timeZone)))].sort();
}

/**
 * { thisWeek, thisMonth, lifetime, currentStreak, longestStreak, today, days }.
 * Streaks count gym days in a row; a day that isRestDay(key) (from the user's schedule) and today
 * (not over yet) never break a streak; any other day without a workout does.
 */
export function attendance(history, { now = new Date(), timeZone = deviceTimeZone(), isRestDay = () => false } = {}) {
  const days = gymDays(history, { timeZone });
  const today = dayKey(now, timeZone);
  const week = weekStartOf(today);
  const set = new Set(days);
  let run = 0;
  let longest = 0;
  if (days.length) {
    for (let key = days[0]; key <= today; key = addDays(key, 1)) {
      if (set.has(key)) { run += 1; longest = Math.max(longest, run); } else if (key !== today && !isRestDay(key)) run = 0;
    }
  }
  return {
    today,
    thisWeek: days.filter((d) => d >= week && d <= today).length,
    thisMonth: days.filter((d) => d.slice(0, 7) === today.slice(0, 7) && d <= today).length,
    lifetime: days.length,
    currentStreak: run,
    longestStreak: longest,
    days,
  };
}
