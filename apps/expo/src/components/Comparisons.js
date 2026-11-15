import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Card, Dropdown, PrimaryButton } from './kit.js';
import { EXERCISES } from '../lib/exercises.js';
import { defaultPair, periods, metrics } from '../lib/comparison.js';
import { T, type } from '../theme.js';

const FRAMES = [['workout', 'Workout to workout'], ['month', 'Month to month'], ['year', 'Year to year']];

export function Comparisons({ history, unit, onSubmit }) {
  const [mode, setMode] = useState('workout');
  const [exercise, setExercise] = useState('bench');
  const [before, setBefore] = useState(null);
  const [after, setAfter] = useState(null);
  const groups = periods(history, mode);
  const [fromKey, toKey] = defaultPair(groups, exercise);
  const a = groups.find(g => g.key === (before ?? fromKey));
  const b = groups.find(g => g.key === (after ?? toKey));
  const old = metrics(a, exercise, unit), current = metrics(b, exercise, unit);
  const choices = groups.map(g => [g.key, g.label]);
  return <Card style={{ marginTop: 14 }}>
    <Text style={type.title}>Compare your training</Text>
    <Dropdown testID="compare-frame" label="Compare by" value={mode} options={FRAMES} onChange={v => { setMode(v); setBefore(null); setAfter(null); }} />
    <Dropdown testID="compare-exercise" label="Exercise" value={exercise} options={EXERCISES.map(e => [e.id, e.name])} onChange={v => { setExercise(v); setBefore(null); setAfter(null); }} />
    {groups.length < 2 ? <Text style={[type.body, { marginTop: 10 }]}>Complete workouts in two different {mode === 'workout' ? 'sessions' : mode+'s'} to compare.</Text> : <>
      <Dropdown testID="compare-from" label="From" value={a?.key} options={choices} onChange={setBefore} />
      <Dropdown testID="compare-to" label="To" value={b?.key} options={choices} onChange={setAfter} />
      <PrimaryButton disabled={!a || !b || a.key === b.key} onPress={() => onSubmit({ exercise, mode, from: a.label, to: b.label, old, current, unit })}>Submit</PrimaryButton>
      {a?.key === b?.key ? <Text style={type.small}>Choose two different periods to compare.</Text> : null}
    </>}
  </Card>;
}

export function ComparisonResults({ comparison, onBack }) {
  const { exercise, from, to, old, current, unit } = comparison;
  const display = n => n === null ? 'No data' : Math.round(n).toLocaleString();
  const name = EXERCISES.find(e => e.id === exercise)?.name ?? exercise;
  return <>
    <PrimaryButton secondary onPress={onBack}>Back to comparison</PrimaryButton>
    <Card style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[type.title, { flex: 1, minWidth: 0 }]}>{name} progress</Text>
        <Image
          source={require('../../assets/jim-mascot.png')}
          accessibilityLabel="Jim holding a barbell"
          resizeMode="contain"
          style={{ width: 112, height: 82 }}
        />
      </View>
      <Text style={type.body}>From: {from}</Text>
      <Text style={type.body}>To: {to}</Text>
      {['strength','volume'].map(key => {
        const before = old[key], after = current[key];
        const comparable = before != null && after != null;
        const delta = comparable ? after - before : null;
        const color = delta > 0 ? T.green : delta < 0 ? T.red : T.textDim;
        const change = delta === null ? 'Not enough data to compare' : delta === 0 ? 'No change' : before > 0
          ? `${delta > 0 ? '+' : ''}${(delta / before * 100).toFixed(1)}%`
          : `${delta > 0 ? '+' : ''}${display(delta)}`;
        return <View key={key} style={{ marginTop: 18 }}>
          <Text style={type.title}>{key === 'strength' ? 'Best estimated 1RM' : 'Total volume'}</Text>
          <Text style={type.small}>{unit}{key === 'volume' ? ' × reps' : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Card style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.label}>From</Text>
              <Text style={[type.statGreen, { color: T.textDim, marginTop: 8 }]}>{display(before)}</Text>
            </Card>
            <Card style={{ flex: 1, minWidth: 0, borderColor: comparable && delta !== 0 ? color : T.border }}>
              <Text style={type.label}>To</Text>
              <Text style={[type.statGreen, { color, marginTop: 8 }]}>{display(after)}</Text>
              <Text style={[type.small, { color, marginTop: 6 }]}>{change}</Text>
            </Card>
          </View>
        </View>;
      })}
      <Text style={[type.small, { marginTop: 8 }]}>Same exercise, converted to {unit}. Strength uses sets of 1–10 reps. Volume totals all logged sets; partial months and years may have fewer workouts.</Text>
    </Card>
  </>;
}
