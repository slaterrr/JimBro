// Estimate a general activity level from health-app history (steps, exercise minutes, workouts).
// Pure and on-device. Cutoffs:
//  - Daily steps: Tudor-Locke & Bassett (2004) / Tudor-Locke et al. (2008) bands —
//    <5,000 sedentary, 5,000–7,499 low active, 7,500–9,999 somewhat active, 10,000–12,499 active, >=12,500 highly active.
//  - Weekly moderate-to-vigorous minutes: WHO 2020 guideline of 150–300 min/week.
//    <30 sedentary, 30–74 light, 75–149 moderate, 150–299 active (meets WHO), >=300 very active.
// Active energy is shown for context only: it scales with body size, so it does not set the level.

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
export const ACTIVITY_LABELS = {
  sedentary: 'Mostly resting', light: 'Lightly active', moderate: 'Moderately active', active: 'Active', very_active: 'Very active',
};

const WINDOW_DAYS = 90;
const MIN_DAYS = 7;
const STEP_CUTS = [5000, 7500, 10000, 12500];
const MINUTE_CUTS = [30, 75, 150, 300];

const band = (v, cuts) => cuts.filter((c) => v >= c).length;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {{daily?: {date:string, steps?:number, activeKcal?:number, exerciseMin?:number}[],
 *          workouts?: {date:string, minutes:number}[]}} data
 * @returns {{level: string|null, confidence: 'none'|'low'|'medium'|'high', evidence: string[], daysOfData: number, message: string}}
 */
export function activityLevel({ daily = [], workouts = [] } = {}, now = new Date()) {
  const from = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const inWindow = (d) => typeof d?.date === 'string' && d.date >= from && d.date <= today;

  const days = new Map();
  for (const d of daily.filter(inWindow)) {
    const cur = days.get(d.date) ?? {};
    for (const k of ['steps', 'activeKcal', 'exerciseMin']) {
      const v = num(d[k]);
      if (v !== null) cur[k] = (cur[k] ?? 0) + v;
    }
    if (Object.keys(cur).length) days.set(d.date, cur);
  }
  const wByDay = new Map();
  for (const w of workouts.filter(inWindow)) {
    const m = num(w.minutes);
    if (m === null) continue;
    wByDay.set(w.date, (wByDay.get(w.date) ?? 0) + m);
    if (!days.has(w.date)) days.set(w.date, {});
  }

  const daysOfData = days.size;
  if (daysOfData < MIN_DAYS) {
    return {
      level: null, confidence: 'none', evidence: [], daysOfData,
      message: `Not enough history yet (${daysOfData} of ${MIN_DAYS} days needed). You can pick your level yourself, or try again later.`,
    };
  }

  const all = [...days.values()];
  const evidence = [];
  const bands = [];

  const steps = all.map((d) => d.steps).filter((v) => v !== undefined);
  if (steps.length >= MIN_DAYS) {
    const med = median(steps);
    bands.push(band(med, STEP_CUTS));
    evidence.push(`Typical day: ${fmt(med)} steps (median of ${steps.length} days).`);
  }

  const hasExercise = all.some((d) => d.exerciseMin !== undefined) || wByDay.size > 0;
  if (hasExercise) {
    let total = 0;
    for (const [date, d] of days) total += Math.max(d.exerciseMin ?? 0, wByDay.get(date) ?? 0);
    const perWeek = (total / daysOfData) * 7;
    bands.push(band(perWeek, MINUTE_CUTS));
    evidence.push(`About ${fmt(perWeek)} active minutes a week (WHO suggests 150+).`);
    if (wByDay.size) {
      const n = workouts.filter(inWindow).length;
      evidence.push(`${n} workouts recorded in the last ${WINDOW_DAYS} days.`);
    }
  }

  const kcal = all.map((d) => d.activeKcal).filter((v) => v !== undefined);
  if (kcal.length) {
    evidence.push(`Active energy: about ${fmt(median(kcal))} kcal a day (context only; it depends on body size).`);
  }

  if (!bands.length) {
    return { level: null, confidence: 'none', evidence, daysOfData, message: 'No step or exercise data found in this history, so there is nothing to estimate from yet.' };
  }

  const level = ACTIVITY_LEVELS[Math.ceil(bands.reduce((a, b) => a + b, 0) / bands.length)];
  const confidence = daysOfData >= 28 ? 'high' : daysOfData >= 14 ? 'medium' : 'low';
  const hedge = confidence === 'low' ? ' This is a rough guess from a short history.' : '';
  return {
    level, confidence, evidence, daysOfData,
    message: `Best guess: ${ACTIVITY_LABELS[level].toLowerCase()}, from ${daysOfData} days of data.${hedge} It only tunes suggestions; change it any time.`,
  };
}
