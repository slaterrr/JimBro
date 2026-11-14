import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { localPlan } from '../lib/offline.js';
import { Button, Card, Chip, Choice, Kicker, Title, s } from '../ui.js';

const GOALS = [['strength', 'Build strength'], ['hypertrophy', 'Build muscle'], ['general', 'General fitness']];
const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbells', 'Dumbbells'], ['pullup_bar', 'Pull-up bar'], ['bodyweight', 'Bodyweight']];

export function PlanScreen() {
  const { api } = useApp();
  const [goal, setGoal] = useState('general');
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(45);
  const [equipment, setEquipment] = useState(['barbell', 'dumbbells']);
  const [plan, setPlan] = useState(null);

  const toggle = (id) => setEquipment((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  const build = async () => {
    const req = { goal, days_per_week: days, minutes_per_session: minutes, equipment };
    try {
      setPlan({ ...(await api.plan(req)), source: 'pi' });
    } catch {
      setPlan(localPlan(req));
    }
  };

  return (
    <>
      <Kicker>A PLAN THAT FITS</Kicker>
      <Title>My plan</Title>
      <Card>
        <Choice title="Goal" options={GOALS} value={goal} onChange={setGoal} />
        <Choice title="Days per week" options={[2, 3, 4, 5, 6].map((d) => [d, String(d)])} value={days} onChange={setDays} />
        <Choice title="Minutes per session" options={[30, 45, 60, 75].map((m) => [m, String(m)])} value={minutes} onChange={setMinutes} />
        <View style={s.field}>
          <Text style={s.label}>Equipment</Text>
          <View style={s.chips}>
            {EQUIPMENT.map(([id, label]) => <Chip key={id} label={label} selected={equipment.includes(id)} onPress={() => toggle(id)} />)}
          </View>
        </View>
        <Button disabled={!equipment.length} onPress={build}>Create plan  ↗</Button>
      </Card>
      {plan ? (
        <Card>
          <Text style={s.cardTitle}>Your training days</Text>
          {plan.days.map((d) => (
            <View key={d.day} style={s.set}>
              <Text style={s.rowText}>Day {d.day}{d.estimated_minutes ? ` · ~${Math.round(d.estimated_minutes)} min` : ''}</Text>
              {d.items.map((i) => (
                <Text key={i.exercise} style={s.body}>
                  {exerciseName(i.exercise)} · {i.sets} × {i.reps_low}–{i.reps_high}
                </Text>
              ))}
            </View>
          ))}
          {plan.notes.map((n) => <Text key={n} style={s.fine}>{n}</Text>)}
        </Card>
      ) : null}
    </>
  );
}
