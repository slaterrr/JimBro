import React, { useId } from 'react';
import { Text, View } from 'react-native';

import { targetMaximum, workoutTarget } from '../lib/workoutTargets.js';
import { T, type } from '../theme.js';

export function TargetSlider({ kind, label, value, onChange }) {
  const id = useId();
  const current = workoutTarget(kind, value);
  return (
    <View style={{ marginVertical: 8 }}>
      <Text style={type.label}><label htmlFor={id}>{label} · {current}</label></Text>
      <input
        id={id}
        type="range"
        min={1}
        max={targetMaximum(kind)}
        step={1}
        value={current}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ width: '100%', minHeight: 44, accentColor: T.accent, margin: 0 }}
      />
    </View>
  );
}
