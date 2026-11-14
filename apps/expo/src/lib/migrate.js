// Stored-data migration, kept pure so it can be tested without React Native.

export const GOAL_LABEL = { hypertrophy: 'Build Muscle', endurance: 'Improve Endurance', strength: 'Get Stronger', general: 'General fitness' };

/**
 * Bring stored data up to the current shape without losing anything.
 * v3 adds optional set fields (variation, equipment, notes, restSec,
 * completed) and workout fields (notes, program); older records just lack
 * them. `completed` defaults to true, since everything logged before v3 was done.
 */
export function migrateData(saved, empty, defaultSettings) {
  const fixSet = (s) => ({ ...s, completed: s.completed !== false });
  const fixWorkout = (w) => ({ ...w, sets: (w.sets ?? []).map(fixSet) });
  return {
    ...empty,
    ...saved,
    settings: { ...defaultSettings, ...saved.settings },
    history: (saved.history ?? []).map(fixWorkout),
    active: saved.active ? fixWorkout(saved.active) : null,
    version: 3,
  };
}
