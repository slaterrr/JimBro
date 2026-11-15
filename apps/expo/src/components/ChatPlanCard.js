import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../AppState.js';
import { Card, Chips, PrimaryButton } from './kit.js';
import { exerciseName } from '../lib/exercises.js';
import { buildPlan } from '../lib/plans.js';
import { T, type } from '../theme.js';
const GOALS = [['hypertrophy', 'Build muscle'], ['general', 'Endurance'], ['strength', 'Get stronger']];
const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbells', 'Dumbbells'], ['pullup_bar', 'Pull-up bar'], ['bodyweight', 'Bodyweight']];
export function PlanCard({ goal: initialGoal = 'hypertrophy', onStart }) {
  const { savePlan, startWorkout, active, plan: saved } = useApp();
  const [goal, setGoal] = useState(initialGoal);
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(45);
  const [equipment, setEquipment] = useState(['barbell', 'dumbbells']);
  const req = { goal, days_per_week: days, minutes_per_session: minutes, equipment };
  const plan = equipment.length ? buildPlan(req) : null;
  const isSaved = saved && JSON.stringify(saved.request) === JSON.stringify(req);
  return (
    <Card style={{ marginTop: 10 }}>
      <Text style={type.title}>Your weekly plan</Text>
      <Text style={[type.label, { marginVertical: 8 }]}>Goal</Text>
      <Chips options={GOALS} value={goal} onChange={setGoal} />
      <Text style={[type.label, { marginVertical: 8 }]}>Days per week</Text>
      <Chips options={[2, 3, 4, 5].map((d) => [d, String(d)])} value={days} onChange={setDays} />
      <Text style={[type.label, { marginVertical: 8 }]}>Minutes</Text>
      <Chips options={[30, 45, 60].map((m) => [m, String(m)])} value={minutes} onChange={setMinutes} />
      <Text style={[type.label, { marginVertical: 8 }]}>Equipment</Text>
      <Chips multi options={EQUIPMENT} value={equipment} onChange={(id) => setEquipment((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))} />
      {plan?.days.map((d) => (
        <View key={d.day} style={{ marginTop: 12 }}>
          <Text style={[type.label, { color: T.text }]}>Day {d.day} · ~{Math.round(d.estimated_minutes)} min</Text>
          <Text style={type.small}>{d.items.map((i) => `${exerciseName(i.exercise)} ${i.sets}×${i.reps_low}–${i.reps_high}`).join(' · ')}</Text>
        </View>
      ))}
      <PrimaryButton disabled={!plan} onPress={() => savePlan({ ...plan, request: req })}>{isSaved ? 'Saved ✓' : 'Save as my plan'}</PrimaryButton>
      {isSaved && !active ? (
        <PrimaryButton secondary onPress={() => { startWorkout('Plan day 1', plan.days[0]); onStart?.(); }}>Start day 1</PrimaryButton>
      ) : null}
    </Card>
  );
}

