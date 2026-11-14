import { estimate1RM } from './tools.js';
import { sessionOptions } from './historyOrder.js';
export function periods(history, mode) {
  if (mode === 'workout') return sessionOptions(history);
  const groups = new Map();
  for (const w of [...history].sort((a,b) => b.startedAt.localeCompare(a.startedAt))) {
    const d = new Date(w.startedAt);
    const key = mode === 'workout' ? w.id : mode === 'month' ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : String(d.getFullYear());
    if (!groups.has(key)) groups.set(key, { key, label: mode === 'workout' ? `${d.toLocaleDateString()} ${w.name}` : key, workouts: [] });
    groups.get(key).workouts.push(w);
  }
  return [...groups.values()];
}
export function metrics(period, exercise, unit) {
  const sets = (period?.workouts ?? []).flatMap(w => w.sets).filter(s => s.exercise === exercise);
  const normalized = sets.map(s => ({...s, unit, weight: s.weight * (s.unit === unit ? 1 : unit === 'kg' ? 0.45359237 : 1/0.45359237)}));
  return { volume: normalized.length ? normalized.reduce((v,s) => v+s.weight*s.reps,0) : null, strength: Math.max(0, ...normalized.map(s => estimate1RM(s) ?? 0)) || null };
}
