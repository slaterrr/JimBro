// Dashboard card: today's split, attendance this week/month, streak, next workout and
// "Start Today's Workout". All local data and rules; no AI call.
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { attendance, dayKey, deviceTimeZone } from '../lib/attendance.js';
import { isRestDayFor, nextScheduled, planFor } from '../lib/schedule.js';
import { T } from '../theme.js';
import { Card, Icon, PrimaryButton } from './kit.js';

function Stat({ value, label, testID }) {
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 70, alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ color: T.text, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: T.textMute, fontSize: 11, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export function TodayCard({ onStart, onOpenTraining, onBuild }) {
  const { plan, history, active, saveSchedule, createDefaultSchedule } = useApp();
  const program = plan?.program ?? null;
  const schedule = program && plan?.schedule?.programId === program.id ? plan.schedule : null;
  const timeZone = schedule?.timeZone ?? deviceTimeZone();
  const today = dayKey(new Date(), timeZone);
  const ctx = schedule ? { schedule, program, history, today } : null;
  const a = attendance(history, { timeZone, isRestDay: schedule ? isRestDayFor(schedule) : undefined });
  const t = ctx ? planFor(today, ctx) : null;
  const next = ctx ? nextScheduled(ctx) : null;
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(new Date());

  let headline = 'No training split yet';
  let detail = 'Build a program and Jim will schedule your week.';
  if (program && !schedule) { headline = program.name; detail = 'Pick your training days to see what is on today.'; }
  if (t) {
    if (t.type === 'workout') { headline = `${t.name} · Week ${t.week}${t.deload ? ' (deload)' : ''}`; detail = t.status === 'completed' ? 'Done today. Nice work.' : `${t.session.items.length} exercises · about ${Math.round(t.session.estimated_minutes)} min`; }
    else if (t.type === 'rest') { headline = 'Rest day'; detail = t.status === 'completed' ? 'You trained anyway. Recover well.' : 'Recovery is part of the plan.'; }
    else { headline = 'Block complete'; detail = 'Ask Jim to build your next block.'; }
  }
  const nextText = next && next.date !== today ? `Next: ${next.day} · ${next.name}` : null;
  const startLabel = active ? 'Continue workout' : "Start Today's Workout";

  return (
    <Card testID="today-card" style={{ width: '100%', maxWidth: 660, marginTop: 26, borderColor: T.chat.accentBorder, backgroundColor: T.chat.tinted }}>
      <Text style={{ color: T.highlight, fontSize: 10, letterSpacing: 2, fontWeight: '600' }}>TODAY · {dayName.toUpperCase()}</Text>
      <Text testID="today-split" style={{ color: T.text, fontSize: 20, fontWeight: '700', marginTop: 8 }}>{headline}</Text>
      <Text style={{ color: T.textDim, fontSize: 13, marginTop: 4 }}>{detail}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 6 }}>
        <Stat testID="stat-week" value={a.thisWeek} label="gym days this week" />
        <Stat testID="stat-month" value={a.thisMonth} label="this month" />
        <Stat testID="stat-streak" value={a.currentStreak} label={`day streak (best ${a.longestStreak})`} />
        <Stat testID="stat-lifetime" value={a.lifetime} label="all time" />
      </View>
      {nextText ? <Text testID="today-next" style={{ color: T.textMute, fontSize: 12, marginTop: 6 }}>{nextText}</Text> : null}
      {program && schedule ? (
        <PrimaryButton disabled={!active && !next} onPress={onStart}>{startLabel}</PrimaryButton>
      ) : program ? (
        <PrimaryButton onPress={() => saveSchedule(createDefaultSchedule(program))}>Set my training days</PrimaryButton>
      ) : (
        <PrimaryButton onPress={onBuild}>Build my program</PrimaryButton>
      )}
      {program && schedule && t && t.type !== 'workout' && !active && next ? <Text style={{ color: T.textMute, fontSize: 11, marginTop: 6 }}>Starting now runs {next.day}'s {next.name} early.</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Calendar and analytics" onPress={onOpenTraining} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 4 }}>
        <Icon name="calendar-month-outline" size={18} color={T.accentText} />
        <Text style={{ color: T.accentText, fontSize: 13, fontWeight: '600' }}>Calendar, analytics & Excel export</Text>
      </TouchableOpacity>
    </Card>
  );
}
