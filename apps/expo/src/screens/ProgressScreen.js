import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { Card, Choice, Kicker, Metric, Title, s } from '../ui.js';

const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const day = (iso) => new Date(iso).toLocaleDateString();

/** On-phone comparison (first vs latest finished workout) when the Pi is unreachable. */
function localTrend(history, exercise) {
  const byUnit = {};
  for (const w of history) {
    const sets = w.sets.filter((x) => x.exercise === exercise);
    if (!sets.length) continue;
    for (const unit of new Set(sets.map((x) => x.unit))) {
      const u = sets.filter((x) => x.unit === unit);
      (byUnit[unit] ??= []).push({
        date: w.startedAt.slice(0, 10),
        top_weight: Math.max(...u.map((x) => x.weight)),
        volume: u.reduce((t, x) => t + x.weight * x.reps, 0),
      });
    }
  }
  return Object.fromEntries(
    Object.entries(byUnit).map(([unit, points]) => {
      const [a, b] = [points[0], points[points.length - 1]];
      const change = (x, y) => (points.length > 1 && x ? Math.round(((y - x) / x) * 1000) / 10 : null);
      return [unit, { points, top_weight_change_pct: change(a.top_weight, b.top_weight), volume_change_pct: change(a.volume, b.volume), tut_change_pct: null }];
    }),
  );
}

export function ProgressScreen() {
  const { api, online, workout } = useApp();
  const [exercise, setExercise] = useState('curl');
  const [trend, setTrend] = useState(null);

  useEffect(() => {
    let live = true;
    (online ? api.progress(exercise).then((p) => ({ byUnit: p.by_unit, source: 'pi' })) : Promise.reject())
      .catch(() => ({ byUnit: localTrend(workout.history, exercise), source: 'phone' }))
      .then((t) => { if (live) setTrend(t); });
    return () => { live = false; };
  }, [api, online, exercise, workout.history]);

  const sets = workout.history.flatMap((w) => w.sets);
  const units = Object.entries(trend?.byUnit ?? {});

  return (
    <>
      <Kicker>THE WORK ADDS UP</Kicker>
      <Title>Progress</Title>
      <View style={s.metrics}>
        <Metric title="WORKOUTS" value={workout.history.length} />
        <Metric title="SETS" value={sets.length} />
        <Metric title="REPS" value={sets.reduce((t, x) => t + x.reps, 0)} />
      </View>
      <Card>
        <Choice title="Exercise" options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
        {!units.length ? <Text style={[s.body, { marginTop: 12 }]}>Log {exerciseName(exercise).toLowerCase()} to start tracking it.</Text> : null}
        {units.map(([unit, t]) => (
          <View key={unit} style={s.set}>
            <Text style={s.bigStat}>{pct(t.top_weight_change_pct)}</Text>
            <Text style={s.body}>Top weight, first → latest of {t.points.length} sessions ({unit})</Text>
            <Text style={s.rowText}>Volume {pct(t.volume_change_pct)}{t.tut_change_pct !== null ? `  ·  Est. TUT ${pct(t.tut_change_pct)}` : ''}</Text>
            {t.points.slice(-6).map((p, i) => (
              <Text key={i} style={s.body}>
                {p.date ? day(p.date) : ''} · top {p.top_weight} {unit} · volume {Math.round(p.volume)}
              </Text>
            ))}
          </View>
        ))}
        <Text style={s.fine}>
          {trend?.source === 'pi' ? 'From your Pi. ' : 'From this phone (Pi offline). '}
          kg and lb are never mixed; % change compares your first and latest session.
        </Text>
      </Card>
    </>
  );
}
