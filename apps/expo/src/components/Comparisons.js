import React, { useState } from 'react';
import { Text } from 'react-native';
import { DateDropdown } from './DateDropdown.js';
import { Card, Chips, Segmented } from './kit.js';
import { EXERCISES } from '../lib/exercises.js';
import { periods, metrics } from '../lib/comparison.js';
import { type } from '../theme.js';
export function Comparisons({ history, unit }) {
  const [mode, setMode] = useState('workout');
  const [exercise, setExercise] = useState('bench');
  const [before, setBefore] = useState(null);
  const [after, setAfter] = useState(null);
  const groups = periods(history, mode);
  const a = groups.find(g => g.key === before) ?? groups[1];
  const b = groups.find(g => g.key === after) ?? groups[0];
  const old = metrics(a, exercise, unit), current = metrics(b, exercise, unit);
  const display = n => n === null ? 'No data' : Math.round(n).toLocaleString();
  return <Card style={{ marginTop: 14 }}>
    <Text style={type.title}>Compare your training</Text>
    <Segmented options={['workout','month','year'].map(x => [x, x[0].toUpperCase()+x.slice(1)])} value={mode} onChange={v => { setMode(v); setBefore(null); setAfter(null); }} />
    <Chips options={EXERCISES.map(e => [e.id,e.name])} value={exercise} onChange={setExercise} />
    {groups.length < 2 ? <Text style={type.body}>Complete workouts in two different {mode === 'workout' ? 'sessions' : mode+'s'} to compare.</Text> : <>
      <DateDropdown label="From" options={groups} value={a?.key} onChange={setBefore} />
      <DateDropdown label="To" options={groups} value={b?.key} onChange={setAfter} />
      {['strength','volume'].map(key => <Text key={key} style={type.body}>
        {key === 'strength' ? 'Best estimated 1RM' : 'Total volume'} ({unit}{key === 'volume' ? ' × reps' : ''}): {display(old[key])} → {display(current[key])}
        {old[key] > 0 && current[key] !== null ? ` (${((current[key]-old[key])/old[key]*100).toFixed(1)}%)` : ''}
      </Text>)}
      <Text style={type.small}>Same exercise, converted to {unit}. Strength uses sets of 1–10 reps. Volume totals all logged sets; partial months and years may have fewer workouts.</Text>
    </>}
  </Card>;
}
