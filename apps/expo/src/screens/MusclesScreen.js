import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { useApp } from '../AppState.js';
import { BodyFigure, STATUS_COLOR } from '../components/BodyMap.js';
import { Card, Icon, PrimaryButton, Sheet } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { MUSCLE_GROUPS, muscleDetail, muscleStatus } from '../lib/muscles.js';
import { R, T, type } from '../theme.js';

const LEGEND = [
  ['trained', 'Trained', '(≤ 3d)'],
  ['recent', 'Recent', '(4–7d)'],
  ['rest', 'Rest', '(≥ 8d)'],
];

export function MusclesScreen({ openProgress, openHistory, embedded = false }) {
  const { history, active } = useApp();
  const workouts = useMemo(() => [...history, ...(active?.sets.length ? [active] : [])], [history, active]);
  const status = useMemo(() => muscleStatus(workouts), [workouts]);
  const [group, setGroup] = useState(null);
  const [bodyWidth, setBodyWidth] = useState(null);
  const { width } = useWindowDimensions();
  const figure = Math.min(180, ((bodyWidth ?? width - 56) - 8) / 2);
  const detail = group ? muscleDetail(workouts, group) : null;
  const name = MUSCLE_GROUPS.find((g) => g.id === group)?.name;

  const content = (
    <View style={st.content}>
      <View style={st.header}>
        <Text style={type.h1}>Muscles</Text>
        <TouchableOpacity accessibilityLabel="Workout history" onPress={openHistory} style={st.cal}>
          <Icon name="calendar-blank-outline" size={22} color={T.text} />
        </TouchableOpacity>
      </View>

      <Text style={[type.title, st.instruction]}>Tap a muscle group</Text>
      <View style={st.figures} onLayout={(event) => {
        const measuredWidth = event.nativeEvent.layout.width;
        if (measuredWidth > 8) setBodyWidth(measuredWidth);
      }}>
        <BodyFigure side="front" status={status} onSelect={setGroup} width={figure} />
        <BodyFigure side="back" status={status} onSelect={setGroup} width={figure} />
      </View>

      <View style={st.legend}>
        {LEGEND.map(([k, label, sub]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: STATUS_COLOR[k] }} />
            <View>
              <Text style={{ color: T.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
              <Text style={{ color: T.textDim, fontSize: 12 }}>{sub}</Text>
            </View>
          </View>
        ))}
      </View>

      <Sheet hideKeyboardControl visible={Boolean(group)} onClose={() => setGroup(null)} title={name ?? ''}>
        {detail ? (
          <>
            <Card>
              <Text style={type.title}>
                {detail.days === null ? 'Not trained yet' : detail.days === 0 ? 'Trained today' : `Trained ${detail.days} day${detail.days === 1 ? '' : 's'} ago`}
              </Text>
              <Text style={type.body}>{detail.setsThisWeek} set{detail.setsThisWeek === 1 ? '' : 's'} in the last 7 days</Text>
              {detail.exercises.length ? <Text style={type.small}>From: {detail.exercises.map(exerciseName).join(', ')}</Text> : null}
            </Card>
            <PrimaryButton onPress={() => { const selected = group; setGroup(null); openProgress(selected); }}>Progress</PrimaryButton>
          </>
        ) : null}
      </Sheet>
    </View>
  );
  return embedded ? content : <ScrollView>{content}</ScrollView>;
}

const st = StyleSheet.create({
  content: { padding: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cal: { width: 44, height: 44, borderRadius: R.sm, borderWidth: 1, borderColor: T.borderStrong, alignItems: 'center', justifyContent: 'center' },
  instruction: { textAlign: 'center', fontWeight: '500', marginTop: 6 },
  figures: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  legend: { flexDirection: 'row', justifyContent: 'space-around', borderWidth: 1, borderColor: T.border, borderRadius: R.lg, paddingVertical: 9, marginTop: 10, backgroundColor: T.card },
});
