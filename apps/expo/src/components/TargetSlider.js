import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { targetMaximum, valueAt, workoutTarget } from '../lib/workoutTargets.js';
import { R, T, type } from '../theme.js';

export function TargetSlider({ kind, label, value, onChange }) {
  const [width, setWidth] = useState(0);
  const max = targetMaximum(kind);
  const current = workoutTarget(kind, value);
  const fraction = (current - 1) / (max - 1);
  const update = ({ nativeEvent }) => {
    if (width > 0) onChange(valueAt(nativeEvent.locationX, width, max));
  };
  return (
    <View style={{ marginVertical: 8 }}>
      <Text style={type.label}>{label} · {current}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 1, max, now: current }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={({ nativeEvent }) => {
          const step = nativeEvent.actionName === 'increment' ? 1 : -1;
          onChange(workoutTarget(kind, current + step));
        }}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={update}
        onResponderMove={update}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <View pointerEvents="none" style={{ height: 6, borderRadius: R.pill, backgroundColor: T.border }}>
          <View style={{ width: `${fraction * 100}%`, height: 6, borderRadius: R.pill, backgroundColor: T.accent }} />
          <View style={{ position: 'absolute', left: `${fraction * 100}%`, top: -7, width: 20, height: 20, borderRadius: 10, backgroundColor: T.accent, transform: [{ translateX: -10 }] }} />
        </View>
      </View>
    </View>
  );
}
