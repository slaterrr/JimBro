import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { buildPlan } from '../lib/plans.js';
import { Button, Card, Chip, Choice, Kicker, Title, s } from '../ui.js';

const GOALS = [['strength', 'Build strength'], ['hypertrophy', 'Build muscle'], ['general', 'General fitness']];
const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbells', 'Dumbbells'], ['pullup_bar', 'Pull-up bar'], ['bodyweight', 'Bodyweight']];

export function PlanScreen({ go }) {
  const { plan, savePlan, startWorkout, active } = useApp();
  const [goal, setGoal] = useState(plan?.request?.goal ?? 'general');
  const [days, setDays] = useState(plan?.request?.days_per_week ?? 3);
  const [minutes, setMinutes] = useState(plan?.request?.minutes_per_session ?? 45);
  const [equipment, setEquipment] = useState(plan?.request?.equipment ?? ['barbell', 'dumbbells']);

  const toggle = (id) => setEquipment((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
  const build = () => {
    const request = { goal, days_per_week: days, minutes_per_session: minutes, equipment };
    savePlan({ ...buildPlan(request), request });
  };
  const startDay = (d) => {
    startWorkout(`Plan day ${d.day}`, d);
    go('Workout');
  };

  return (
    <>
      <Kicker>A PLAN THAT FITS</Kicker>
      <Title>My plan</Title>
      <Card>
        <Choice title="Goal" options={GOALS} value={goal} onChange={setGoal} />
        <Choice title="Days per week" options={[1, 2, 3, 4, 5, 6].map((d) => [d, String(d)])} value={days} onChange={setDays} />
        <Choice title="Minutes per session" options={[15, 30, 45, 60, 75].map((m) => [m, String(m)])} value={minutes} onChange={setMinutes} />
        <View style={s.field}>
          <Text style={s.label}>Equipment</Text>
          <View style={s.chips}>
            {EQUIPMENT.map(([id, label]) => <Chip key={id} label={label} selected={equipment.includes(id)} onPress={() => toggle(id)} />)}
          </View>
        </View>
        <Button disabled={!equipment.length} onPress={build}>{plan ? 'Rebuild plan  ↻' : 'Create plan  ↗'}</Button>
      </Card>
      {plan ? (
        <Card>
          <Text style={s.cardTitle}>Your training days</Text>
          {plan.days.map((d) => (
            <View key={d.day} style={s.set}>
              <Text style={s.rowText}>Day {d.day} · ~{Math.round(d.estimated_minutes)} min</Text>
              {d.items.map((i) => (
                <Text key={i.exercise} style={s.body}>
                  {exerciseName(i.exercise)} · {i.sets} × {i.reps_low}–{i.reps_high} · rest {i.rest_min} min
                </Text>
              ))}
              <Button secondary disabled={Boolean(active)} onPress={() => startDay(d)}>Start this day  ↗</Button>
            </View>
          ))}
          {active ? <Text style={s.fine}>Finish your current workout to start a plan day.</Text> : null}
          {plan.notes.map((n) => <Text key={n} style={s.fine}>{n}</Text>)}
        </Card>
      ) : null}
    </>
  );
}
