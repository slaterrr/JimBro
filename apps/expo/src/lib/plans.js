// Weekly plans constrained by goal, days, minutes and equipment (port of plans.py).
const POOL = [
  ['squat', ['barbell', 'bodyweight']],
  ['bench', ['barbell', 'dumbbells']],
  ['deadlift', ['barbell']],
  ['pull_up', ['pullup_bar']],
  ['shoulder_press', ['barbell', 'dumbbells']],
  ['curl', ['barbell', 'dumbbells']],
];
const NEEDS = Object.fromEntries(POOL);
const SCHEME = { strength: [4, 3, 5, 3], hypertrophy: [3, 8, 12, 1.5], general: [3, 6, 10, 1.5] };
const WARMUP_MIN = 5;
const WORK_MIN_PER_SET = 1;
const MAX_ITEMS = 4;

const minutes = (items) => WARMUP_MIN + items.reduce((t, i) => t + i.sets * (WORK_MIN_PER_SET + i.rest_min), 0);

export function buildPlan({ goal, days_per_week, minutes_per_session, equipment }) {
  if (!equipment?.length) throw new Error('choose at least one equipment option');
  const [sets, lo, hi, rest] = SCHEME[goal] ?? SCHEME.general;
  const available = POOL.filter(([, needs]) => needs.some((n) => equipment.includes(n))).map(([e]) => e);
  if (!available.length) throw new Error('no exercises match that equipment');
  const days = [];
  for (let d = 0; d < days_per_week; d++) {
    const off = (d * 2) % available.length;
    const order = [...available.slice(off), ...available.slice(0, off)];
    let items = [];
    for (const exercise of order.slice(0, MAX_ITEMS)) {
      const item = { exercise, sets, reps_low: lo, reps_high: hi, rest_min: rest };
      if (minutes([...items, item]) <= minutes_per_session) items.push(item);
    }
    if (!items.length) {
      const item = { exercise: order[0], sets, reps_low: lo, reps_high: hi, rest_min: rest };
      while (item.sets > 1 && minutes([item]) > minutes_per_session) item.sets -= 1;
      items = [item];
    }
    days.push({ day: d + 1, items, estimated_minutes: minutes(items) });
  }
  return {
    goal,
    days,
    notes: [
      "Progress with Jim's suggestions: small load steps only after an easy set (RPE <= 7).",
      'Camera rep counting covers curl, squat and shoulder press; log other lifts by hand.',
    ],
  };
}

export function validatePlan(plan, req) {
  const problems = [];
  if (plan.days.length !== req.days_per_week) problems.push(`expected ${req.days_per_week} days, got ${plan.days.length}`);
  for (const day of plan.days) {
    if (day.estimated_minutes > req.minutes_per_session) problems.push(`day ${day.day} needs ${day.estimated_minutes} minutes`);
    for (const item of day.items) {
      if (!NEEDS[item.exercise].some((n) => req.equipment.includes(n))) {
        problems.push(`day ${day.day}: ${item.exercise} needs unavailable equipment`);
      }
    }
  }
  return problems;
}
