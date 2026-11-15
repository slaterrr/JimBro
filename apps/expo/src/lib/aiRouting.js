// When Jim calls Claude, and when the phone answers on its own.
// Claude: reasoning and planning that depends on the person (goal changes, conflicts, complex
// questions, a personalised workout review, the weekly review). Phone: commands, logging,
// confirmations, quick facts and safety, which are faster, free and work offline.
// Anything routed here still falls back to the on-device coach when the proxy is unreachable.

export const AI_TASKS = {
  goal_change: 'Your goal changed, so Jim is re-picking exercises for it.',
  conflict: 'This conflicts with your saved goal or plan, so Jim is weighing the trade-off.',
  complex_question: 'This needs reasoning over your data, so Jim is thinking it through.',
  workout_review: 'Jim is reviewing your workout with your numbers.',
  weekly_review: 'Jim is reviewing your week and adapting next week.',
};

const GOALS = {
  strength: /\b(strong(er)?|strength|powerlifting|max(es)?|1rm|heavy)\b/i,
  muscle: /\b(muscle|bulk|hypertrophy|size|bigger|mass)\b/i,
  endurance: /\b(endurance|marathon|run(ning)?|cardio|stamina|5k|10k)\b/i,
  fat_loss: /\b(lose (weight|fat)|fat loss|cut(ting)?|lean(er)?|slim)\b/i,
};
const goalIn = (m) => Object.keys(GOALS).find((g) => GOALS[g].test(m)) ?? null;

const WEEKLY = /\b(weekly (review|check-?in|progress)|how (was|did) my week|review (my|this) week|my week (go|look))\b/i;
const WORKOUT = /\b(how did (my|the|today[’']?s) (workout|session|training|lift)|review (my|the|today[’']?s|last) (last )?(workout|session)|talk about (my|the|today[’']?s|this) (workout|session)|(workout|session) review)\b/i;
const GOAL_CHANGE = /\b(change|switch|update|set) (my )?goal\b|\bnew goal\b|\b(focus|focusing) on [a-z ]+ (now|instead)\b|\bi want to focus on\b/i;
const CONFLICT = /\b(but|though|even though)\b.*\b(plan|program|goal)\b|\b(plan|program|goal)\b.*\b(but|though)\b|\b(hurts?|pain|injur(y|ed)|can[’']?t do)\b.*\b(plan|program|instead)\b/i;
const WANT = /\bi (mainly |really |just )?(want|need|plan) to\b/i;
const REASONING = /^(why|how should|should i|what('s| is) (better|the best)|is it better|which (is|should))\b|\b(or)\b.*\?$/i;

const local = { use: false, task: null, reason: null };
const route = (task) => ({ use: true, task, reason: AI_TASKS[task] });

/** message + { settings, plan } -> { use, task, reason }. Safety is handled before this. */
export function routeToClaude(message, { settings = {}, plan = null } = {}) {
  const m = String(message ?? '').trim();
  if (!m || /^(log|save|delete|remove|correct|fix|yes|no|confirm|cancel|start|stop|finish|end)\b/i.test(m)) return local;
  if (WEEKLY.test(m)) return route('weekly_review');
  if (WORKOUT.test(m)) return route('workout_review');
  if (GOAL_CHANGE.test(m)) return route('goal_change');
  if (CONFLICT.test(m)) return route('conflict');
  const saved = plan?.goal ?? settings.fitnessGoal;
  const wanted = WANT.test(m) ? goalIn(m) : null;
  if (wanted && saved && saved !== 'general' && wanted !== saved) return route('conflict');
  const words = m.split(/\s+/).length;
  if ((REASONING.test(m) && words >= 6) || (words >= 14 && /\?$/.test(m)) || (m.match(/\?/g) ?? []).length >= 2) return route('complex_question');
  return local;
}
