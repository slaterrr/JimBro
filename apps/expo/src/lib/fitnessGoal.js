// The user's main fitness goal and the look they want. Stored in settings (shared contract):
// fitnessGoal, physiqueGoal (free text), focusMuscles (MUSCLE_GROUPS ids), activityLevel (filled
// from Health data by another feature; null until then).
import { MUSCLE_GROUPS } from './muscles.js';

export const FITNESS_GOALS = [
  { id: 'strength', label: 'Get stronger', short: 'Strength', plan: 'strength' },
  { id: 'muscle', label: 'Build muscle', short: 'Muscle', plan: 'hypertrophy' },
  { id: 'endurance', label: 'Improve endurance', short: 'Endurance', plan: 'endurance' },
  { id: 'general', label: 'General fitness', short: 'General fitness', plan: 'general' },
];
// The fat-loss option was removed; old saves with 'fat_loss' migrate to 'general'.
export const FITNESS_GOAL_IDS = FITNESS_GOALS.map((g) => g.id);
export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

export const DEFAULT_GOAL_SETTINGS = { fitnessGoal: 'general', physiqueGoal: '', focusMuscles: [], activityLevel: null };

const MUSCLE_IDS = new Set(MUSCLE_GROUPS.map((m) => m.id));
const byId = (id) => FITNESS_GOALS.find((g) => g.id === id) ?? FITNESS_GOALS.find((g) => g.id === 'general');

export const normalizeFitnessGoal = (id) => (FITNESS_GOAL_IDS.includes(id) ? id : 'general');
export const fitnessGoalLabel = (id) => byId(id).label;
export const fitnessGoalShort = (id) => byId(id).short;
export const planGoalFor = (id) => byId(id).plan;
export const cleanFocusMuscles = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((m) => MUSCLE_IDS.has(m)))] : [];

/** Old saves had none of these fields: fill defaults and repair invalid values. Never throws. */
export function migrateGoalSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    ...s,
    fitnessGoal: normalizeFitnessGoal(s.fitnessGoal),
    physiqueGoal: typeof s.physiqueGoal === 'string' ? s.physiqueGoal : '',
    focusMuscles: cleanFocusMuscles(s.focusMuscles),
    activityLevel: ACTIVITY_LEVELS.includes(s.activityLevel) ? s.activityLevel : null,
  };
}
