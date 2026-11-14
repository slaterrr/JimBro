// First-run "Beginner / Comeback" setup: three questions -> persona, a starter plan and a
// consistency goal. Pure: the component applies the result. Not medical advice.
import { SAFETY_TEXT } from './coach.js';
import { buildPlan } from './plans.js';

export const ONBOARDING_QUESTIONS = [
  { id: 'experience', title: 'How familiar is the gym for you?', options: [['new', "I'm new to this"], ['returning', 'Coming back after a break'], ['experienced', 'I train regularly']] },
  { id: 'goal', title: "What's your main goal?", options: [['habit', 'Start a workout habit'], ['stronger', 'Get stronger'], ['muscle', 'Build muscle'], ['health', 'General health']] },
  { id: 'pain', title: 'Any pain or injury right now?', options: [['no', 'No'], ['yes', 'Yes']] },
];

const PLAN_GOAL = { habit: 'general', stronger: 'strength', muscle: 'hypertrophy', health: 'general' };
const WARMUP_MIN = 5;
const SEE_A_PRO = 'Please check with a doctor or physical therapist before starting. ' +
  "When they clear you, come back and Jim will build a gentle plan. You can reopen this setup from the bell.";

/** Starter plan: fewer days, 2 sets of 8-12 at an easy effort, at most 3 lifts, ~30 minutes. */
function conservativePlan(goal) {
  const request = { goal, days_per_week: 2, minutes_per_session: 30, equipment: ['bodyweight', 'dumbbells'] };
  const base = buildPlan({ ...request, minutes_per_session: 120 });
  const days = base.days.map((d) => {
    const items = d.items.slice(0, 3).map((i) => ({ ...i, sets: 2, reps_low: 8, reps_high: 12, rest_min: 1.5 }));
    const estimated_minutes = WARMUP_MIN + items.reduce((t, i) => t + i.sets * (1 + i.rest_min), 0);
    return { ...d, items, estimated_minutes };
  });
  return {
    goal,
    days,
    request,
    notes: ['Starter plan: stop each set with 3 or more reps in reserve (RPE 7 or lower).', ...base.notes],
  };
}

/**
 * Answers -> { persona, plan, goal, safety, message }. persona/plan/goal are null when nothing
 * should change. Pain always wins: no plan, show the safety text and recommend a professional.
 */
export function onboardingResult(answers = {}) {
  const { experience, goal, pain } = answers;
  const easy = experience === 'new' || experience === 'returning';
  const persona = easy ? 'zen' : null;
  if (pain === 'yes') return { persona, plan: null, goal: null, safety: SAFETY_TEXT, message: SEE_A_PRO };
  if (!experience || !goal || pain !== 'no') {
    return { persona: null, plan: null, goal: null, safety: null, message: 'No changes made. You can run this setup again from the bell.' };
  }
  const planGoal = PLAN_GOAL[goal] ?? 'general';
  if (easy) {
    return {
      persona,
      plan: conservativePlan(planGoal),
      goal: { type: 'consistency', perWeek: 2, weeks: 4 },
      safety: null,
      message: 'Your starter plan: 2 short sessions a week, light weights, plenty of rest. Showing up is the win.',
    };
  }
  const request = { goal: planGoal, days_per_week: 3, minutes_per_session: 45, equipment: ['barbell', 'dumbbells'] };
  return {
    persona: null,
    plan: { ...buildPlan(request), request },
    goal: { type: 'consistency', perWeek: 3, weeks: 4 },
    safety: null,
    message: 'Your plan: 3 sessions a week. Adjust it any time with "Create a New Plan".',
  };
}

/** Old saves had no flag: anyone with logged workouts has clearly used the app already. */
export const isOnboarded = (settings, history) =>
  typeof settings?.onboarded === 'boolean' ? settings.onboarded : (history?.length ?? 0) > 0;
