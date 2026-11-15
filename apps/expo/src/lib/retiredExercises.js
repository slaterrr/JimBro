// Retired IDs remain readable in workout history, but cannot become new work.
export const isRetiredExercise = (id) => id === 'curl' || id === 'bicep_curl';

export function withoutRetiredExercises(value) {
  if (Array.isArray(value)) return value.filter((v) => !isRetiredExercise(v?.exercise)).map(withoutRetiredExercises);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, withoutRetiredExercises(v)]));
}

export function migrateRetiredExercises(data) {
  const active = data.active ? { ...data.active, planned: withoutRetiredExercises(data.active.planned) } : data.active;
  // An in-flight retired mission cannot safely resume at a changed item index.
  const hasRetiredMission = JSON.stringify(data.mission ?? {}).includes('"curl"') || JSON.stringify(data.mission ?? {}).includes('"bicep_curl"');
  return { ...data, active, plan: withoutRetiredExercises(data.plan), planVersions: withoutRetiredExercises(data.planVersions),
    goals: data.goals?.filter((g) => !isRetiredExercise(g.exercise)), mission: hasRetiredMission ? null : data.mission };
}
