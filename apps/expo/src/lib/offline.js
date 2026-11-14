// What Jim and the planner do when the Pi is unreachable. Numbers are never invented.
const SAFETY = /\b(sharp pain|chest pain|pain|hurts?|injur(ed|y)|dizz(y|iness)|faint|numb)\b/i;
const SAFETY_TEXT =
  'Stop the set now. Pain, dizziness or numbness means rest, not push through. ' +
  'If it is sharp, persists, or you have chest pain or trouble breathing, get medical help.';
const PRESETS = {
  direct: 'Set logged. Stay focused and make the next one count.',
  friendly: 'Nice work! Take a breath and get ready for the next set.',
  silly: 'That set just got a one-way ticket to Gainsville.',
  hard: 'Set complete. Recover, reset, and attack the next one.',
};

export function fallbackReply(message, tone) {
  if (SAFETY.test(message)) return { text: SAFETY_TEXT, tone, source: 'safety', suggestion: null };
  return {
    text: `${PRESETS[tone] ?? PRESETS.friendly} (Jim is offline: connect to your Pi for history-based advice.)`,
    tone,
    source: 'offline',
    suggestion: null,
  };
}

const POOL = [
  ['squat', ['barbell', 'bodyweight']],
  ['bench', ['barbell', 'dumbbells']],
  ['deadlift', ['barbell']],
  ['pull_up', ['pullup_bar']],
  ['shoulder_press', ['barbell', 'dumbbells']],
  ['curl', ['barbell', 'dumbbells']],
];
const SCHEME = { strength: [4, 3, 5], hypertrophy: [3, 8, 12], general: [3, 6, 10] };

export function localPlan({ goal, days_per_week, minutes_per_session, equipment }) {
  const [sets, lo, hi] = SCHEME[goal] ?? SCHEME.general;
  const available = POOL.filter(([, needs]) => needs.some((n) => equipment.includes(n))).map(([e]) => e);
  const perDay = Math.max(1, Math.min(4, Math.floor((minutes_per_session - 5) / 10)));
  const days = Array.from({ length: days_per_week }, (_, d) => {
    const off = available.length ? (d * 2) % available.length : 0;
    const order = [...available.slice(off), ...available.slice(0, off)];
    return {
      day: d + 1,
      items: order.slice(0, perDay).map((exercise) => ({ exercise, sets, reps_low: lo, reps_high: hi })),
    };
  });
  return { goal, days, notes: ['Offline starter plan. Connect to the Pi for the validated version.'], source: 'offline' };
}
