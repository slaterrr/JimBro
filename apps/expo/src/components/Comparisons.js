import React, { useState } from 'react';
import { Text } from 'react-native';
import { Card, Dropdown } from './kit.js';
import { EXERCISES } from '../lib/exercises.js';
import { defaultPair, periods, metrics } from '../lib/comparison.js';
import { type } from '../theme.js';

const FRAMES = [['workout', 'Workout to workout'], ['month', 'Month to month'], ['year', 'Year to year']];

export function Comparisons({ history, unit }) {
  const [mode, setMode] = useState('workout');
  const [exercise, setExercise] = useState('bench');
  const [before, setBefore] = useState(null);
  const [after, setAfter] = useState(null);
  const groups = periods(history, mode);
  const [fromKey, toKey] = defaultPair(groups, exercise);
  const a = groups.find(g => g.key === (before ?? fromKey));
  const b = groups.find(g => g.key === (after ?? toKey));
  const old = metrics(a, exercise, unit), current = metrics(b, exercise, unit);
  const display = n => n === null ? 'No data' : Math.round(n).toLocaleString();
  const choices = groups.map(g => [g.key, g.label]);
  return <Card style={{ marginTop: 14 }}>
    <Text style={type.title}>Compare your training</Text>
    <Dropdown testID="compare-frame" label="Compare by" value={mode} options={FRAMES} onChange={v => { setMode(v); setBefore(null); setAfter(null); }} />
    <Dropdown testID="compare-exercise" label="Exercise" value={exercise} options={EXERCISES.map(e => [e.id, e.name])} onChange={v => { setExercise(v); setBefore(null); setAfter(null); }} />
    {groups.length < 2 ? <Text style={[type.body, { marginTop: 10 }]}>Complete workouts in two different {mode === 'workout' ? 'sessions' : mode+'s'} to compare.</Text> : <>
      <Dropdown testID="compare-from" label="From" value={a?.key} options={choices} onChange={setBefore} />
      <Dropdown testID="compare-to" label="To" value={b?.key} options={choices} onChange={setAfter} />
      {['strength','volume'].map(key => <Text key={key} style={[type.body, { marginTop: 10 }]}>
        {key === 'strength' ? 'Best estimated 1RM' : 'Total volume'} ({unit}{key === 'volume' ? ' × reps' : ''}): {display(old[key])} → {display(current[key])}
        {old[key] > 0 && current[key] !== null ? ` (${((current[key]-old[key])/old[key]*100).toFixed(1)}%)` : ''}
      </Text>)}
      <Text style={[type.small, { marginTop: 8 }]}>Same exercise, converted to {unit}. Strength uses sets of 1–10 reps. Volume totals all logged sets; partial months and years may have fewer workouts.</Text>
    </>}
  </Card>;
}
