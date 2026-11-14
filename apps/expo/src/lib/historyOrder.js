// Timestamp ordering is independent of presentation labels and storage technology.
// A future database can ORDER BY startedAt, id and retain these same session IDs.
export function chronologicalHistory(history) {
  return [...history].sort((a, b) =>
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || String(a.id).localeCompare(String(b.id)));
}

export function sessionOptions(history) {
  const sorted = chronologicalHistory(history);
  const dayKey = w => new Date(w.startedAt).toLocaleDateString('en-CA');
  const totals = new Map(), seen = new Map();
  for (const w of sorted) totals.set(dayKey(w), (totals.get(dayKey(w)) ?? 0) + 1);
  return sorted.map(w => {
    const day = dayKey(w), index = (seen.get(day) ?? 0) + 1;
    seen.set(day, index);
    const date = new Date(w.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return { key: w.id, label: `${date}${totals.get(day) > 1 ? ` · Session ${index}` : ''}`, workouts: [w] };
  }).reverse();
}
