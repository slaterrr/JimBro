import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { personalRecords, streak, trend } from '../lib/progress.js';
import { Card, Choice, Kicker, Metric, Title, s } from '../ui.js';

const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export function ProgressScreen() {
  const { history, active } = useApp();
  const [exercise, setExercise] = useState('curl');
  const workouts = useMemo(() => [...history, ...(active?.sets.length ? [active] : [])], [history, active]);
  const t = useMemo(() => trend(workouts, exercise), [workouts, exercise]);
  const records = useMemo(() => personalRecords(workouts), [workouts]);
  const sets = workouts.flatMap((w) => w.sets);
  const units = Object.entries(t);

  return (
    <>
      <Kicker>THE WORK ADDS UP</Kicker>
      <Title>Progress</Title>
      <View style={s.metrics}>
        <Metric title="WORKOUTS" value={history.length} />
        <Metric title="REPS" value={sets.reduce((n, x) => n + x.reps, 0)} />
        <Metric title="STREAK" value={`${streak(history)} wk`} />
      </View>

      <Card>
        <Choice title="Exercise" options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
        {!units.length ? <Text style={[s.body, { marginTop: 12 }]}>Log {exerciseName(exercise).toLowerCase()} to start tracking it.</Text> : null}
        {units.map(([unit, u]) => (
          <View key={unit} style={s.set}>
            <Text style={s.bigStat}>{pct(u.top_weight_change_pct)}</Text>
            <Text style={s.body}>Top weight, first → latest of {u.points.length} sessions ({unit})</Text>
            <Text style={s.rowText}>
              Volume {pct(u.volume_change_pct)}{u.tut_change_pct !== null ? `  ·  Est. TUT/rep ${pct(u.tut_change_pct)}` : ''}
            </Text>
            {u.points.slice(-6).map((p, i) => (
              <Text key={i} style={s.body}>
                {p.date} · top {p.top_weight} {unit} · volume {Math.round(p.volume)}{p.avg_tut_ms ? ` · TUT ${(p.avg_tut_ms / 1000).toFixed(1)}s` : ''}
              </Text>
            ))}
          </View>
        ))}
        <Text style={s.fine}>kg and lb are never mixed; % change compares your first and latest session.</Text>
      </Card>

      <Card>
        <Kicker>PERSONAL RECORDS</Kicker>
        {!records.length ? <Text style={s.body}>Your records will show up here.</Text> : null}
        {records.map((r) => (
          <View key={`${r.exercise}${r.unit}`} style={s.set}>
            <Text style={s.rowText}>🏆 {exerciseName(r.exercise)} ({r.unit})</Text>
            <Text style={s.body}>
              Heaviest {r.heaviest.weight} × {r.heaviest.reps} · Most reps {r.most_reps.reps} @ {r.most_reps.weight} · Best set {Math.round(r.best_set_volume)}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}
