// Saving a plan never throws the old one away: it moves to planVersions (newest last, last 10).
const KEEP = 10;

export function withSavedPlan(data, plan, now = new Date().toISOString()) {
  const versions = [...(data.planVersions ?? []), ...(data.plan ? [{ ...data.plan, replacedAt: now }] : [])].slice(-KEEP);
  return { ...data, plan: { ...plan, savedAt: now }, planVersions: versions };
}
