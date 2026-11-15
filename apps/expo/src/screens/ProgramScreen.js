import React from 'react';
import { ScrollView, Text } from 'react-native';
import { Card, PrimaryButton } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { type } from '../theme.js';

export function ProgramScreen({ plan, onBack }) {
  const weeks = plan?.program?.weeks ?? [{ week: 1, sessions: plan?.days ?? [] }];
  return <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
    <PrimaryButton secondary onPress={onBack}>Back to Jim</PrimaryButton>
    <Text style={[type.h1, { marginTop: 16 }]}>Program</Text>
    <Text style={type.body}>{plan?.program?.name ?? plan?.name ?? 'Your current split'}</Text>
    {weeks.map((week, wi) => <React.Fragment key={wi}>
      {weeks.length > 1 ? <Text style={[type.h2, { marginTop: 20 }]}>Week {week.week ?? wi + 1}</Text> : null}
      {week.sessions.map((day, di) => <Card key={di} style={{ marginTop: 12 }}>
        <Text style={type.title}>Day {day.day ?? di + 1}{day.name ? ` · ${day.name}` : ''}</Text>
        {(day.items ?? []).map((item, i) => <Text key={i} style={[type.body, { marginTop: 8 }]}>{exerciseName(item.exercise)} · {item.sets} sets · {item.reps_low ?? item.reps ?? '—'}{item.reps_high && item.reps_high !== item.reps_low ? `–${item.reps_high}` : ''} reps</Text>)}
      </Card>)}
    </React.Fragment>)}
  </ScrollView>;
}
