import React from 'react';
import { Text } from 'react-native';
import { muscleProgress } from '../lib/muscleProgress.js';
import { MUSCLE_GROUPS } from '../lib/muscles.js';
import { type } from '../theme.js';
import { LineChart } from './Charts.js';
import { Card, PrimaryButton } from './kit.js';

export function MuscleProgress({ group, workouts, unit, onClear }) {
  const charts = muscleProgress(workouts, group, unit);
  const name = MUSCLE_GROUPS.find(g => g.id === group)?.name ?? 'Muscle';
  return <>
    <Text style={[type.h2, { marginTop: 16 }]}>{name} progress</Text>
    <Text style={type.small}>Each exercise is compared only with itself. Loaded sets show weight × reps; unweighted sets show reps. Volume is not a strength estimate.</Text>
    <PrimaryButton secondary onPress={onClear}>Show all progress</PrimaryButton>
    {!charts.length ? <Card style={{ marginTop: 12 }}><Text style={type.body}>No recorded sets for {name.toLowerCase()} yet. Complete sets during a workout to see your progress.</Text></Card> : null}
    {charts.map(chart => <Card key={chart.key} style={{ marginTop: 14 }}>
      <Text style={type.title}>{chart.name}</Text>
      <Text style={type.small}>{chart.metric} · last {Math.min(8, chart.points.length)} workouts with data</Text>
      <LineChart points={chart.points.slice(-8)} />
      {chart.points.length === 1 ? <Text style={type.small}>First workout recorded. Another workout will show a trend.</Text> : null}
    </Card>)}
  </>;
}
