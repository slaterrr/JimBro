// Calendar, weekly split, analytics and Excel export. Everything here is local data and rules:
// no AI calls (see docs/TRAINING.md).
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { BarChart } from '../components/Charts.js';
import { Card, Chips, Icon, PrimaryButton } from '../components/kit.js';
import { addDays, attendance, dayKey, deviceTimeZone, WEEKDAY_NAMES, WEEKDAYS, weekStartOf } from '../lib/attendance.js';
import { exerciseName } from '../lib/exercises.js';
import { saveBytes } from '../lib/exportFile.js';
import { exerciseSessions, recommendNext } from '../lib/progression.js';
import { calendarMonth, isRestDayFor, MISSED_POLICIES, moveTrainingDay, swapDates, swapWeekdays, validateSchedule } from '../lib/schedule.js';
import { buildWorkbook, toXlsx, workbookFilename } from '../lib/workbook.js';
import { T, type } from '../theme.js';

const COLORS = () => ({ completed: T.accent, missed: T.amber, scheduled: T.borderStrong, rest: T.border, none: 'transparent' });
const LEGEND = [['completed', 'Completed'], ['missed', 'Missed'], ['scheduled', 'Scheduled'], ['rest', 'Rest']];
const shiftMonth = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

function Calendar({ ctx, month, setMonth, selected, onSelect }) {
  const cal = calendarMonth(month, ctx);
  const c = COLORS();
  const cells = [...Array(cal.leadingBlanks).fill(null), ...cal.days];
  const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  return (
    <View testID="calendar">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} style={st.nav}><Icon name="chevron-left" color={T.text} /></TouchableOpacity>
        <Text style={type.title}>{title}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(shiftMonth(month, 1))} style={st.nav}><Icon name="chevron-right" color={T.text} /></TouchableOpacity>
      </View>
      <View style={st.grid}>
        {WEEKDAYS.map((d) => <Text key={d} style={[st.cell, st.head]}>{WEEKDAY_NAMES[d].slice(0, 2)}</Text>)}
        {cells.map((d, i) => (d ? (
          <TouchableOpacity key={d.date} testID={`day-${d.date}`} accessibilityRole="button" accessibilityLabel={`${d.date === ctx.today ? 'Today, ' : ''}${d.date}: ${d.status}${d.name ? `, ${d.name}` : ''}`}
            onPress={() => onSelect(d.date)} style={[st.cell, { borderColor: selected === d.date ? T.accentText : c[d.status] ?? 'transparent', backgroundColor: d.status === 'completed' ? T.accent : 'transparent', borderStyle: d.rescheduled ? 'dashed' : 'solid' }]}>
            <Text style={{ color: d.status === 'completed' ? T.onAccent : d.status === 'missed' ? T.amber : d.status === 'rest' ? T.textMute : T.text, fontSize: 13, fontWeight: d.status === 'completed' ? '800' : '500' }}>{d.dayOfMonth}</Text>
            {d.date === ctx.today ? <View style={{ position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: d.status === 'completed' ? T.onAccent : T.accentText }} /> : null}
          </TouchableOpacity>
        ) : <View key={`b${i}`} style={st.cell} />))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {LEGEND.map(([k, l]) => <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 12, height: 12, borderRadius: 3, borderWidth: 2, borderColor: c[k], backgroundColor: k === 'completed' ? c[k] : 'transparent' }} /><Text style={type.small}>{l}</Text></View>)}
      </View>
    </View>
  );
}

export function TrainingScreen({ onBack }) {
  const { plan, history, settings, saveSchedule, createDefaultSchedule } = useApp();
  const program = plan?.program ?? null;
  const schedule = program && plan?.schedule?.programId === program.id ? plan.schedule : null;
  const timeZone = schedule?.timeZone ?? deviceTimeZone();
  const today = dayKey(new Date(), timeZone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(null);
  const [swapFrom, setSwapFrom] = useState(null);
  const [pickDay, setPickDay] = useState(null);
  const [msg, setMsg] = useState(null);
  const ctx = schedule ? { schedule, program, history, today } : null;
  const a = attendance(history, { timeZone, isRestDay: schedule ? isRestDayFor(schedule) : undefined });
  const weekly = Array.from({ length: 8 }, (_, k) => {
    const start = addDays(weekStartOf(today), -7 * (7 - k));
    return { label: `${start.slice(5, 7)}/${start.slice(8)}`, value: a.days.filter((d) => d >= start && d < addDays(start, 7)).length };
  });
  const exercises = useMemo(() => {
    const ids = [...new Set(history.flatMap((w) => w.sets.map((s) => s.exercise)))];
    return ids.map((id) => {
      const ss = exerciseSessions(history, id, settings.unit);
      if (!ss.length) return null;
      const item = program?.weeks.flatMap((w) => w.sessions.flatMap((s) => s.items)).find((i) => i.exercise === id);
      const rec = recommendNext(history, id, { reps_low: item?.reps_low ?? 6, reps_high: item?.reps_high ?? 10, unit: settings.unit });
      const top = (s) => (s.top.weight > 0 ? `${s.top.reps} × ${s.top.weight}` : `${s.top.reps} reps`);
      return { id, sessions: ss.length, first: top(ss[0]), last: top(ss.at(-1)), heaviest: Math.max(...ss.map((s) => s.top.weight)), rec };
    }).filter(Boolean).sort((x, y) => y.sessions - x.sessions);
  }, [history, settings.unit, program]);

  const change = (next) => {
    const problems = validateSchedule(next, program);
    if (problems.length) { setMsg(problems[0]); return; }
    saveSchedule(next);
    setMsg('Schedule saved.');
  };
  const tapDate = (date) => {
    if (swapFrom && swapFrom !== date) { change(swapDates(schedule, swapFrom, date)); setSwapFrom(null); setSelected(date); return; }
    setSelected(date);
  };
  const tapWeekday = (wd) => {
    if (!pickDay) { setPickDay(wd); return; }
    if (pickDay === wd) { setPickDay(null); return; }
    try { change(schedule.week[wd] == null ? moveTrainingDay(schedule, pickDay, wd) : swapWeekdays(schedule, pickDay, wd)); } catch (e) { setMsg(e.message); }
    setPickDay(null);
  };
  const exportExcel = async () => {
    try {
      const bytes = toXlsx(buildWorkbook({ history, plan, unit: settings.unit, timeZone }));
      const r = await saveBytes(bytes, workbookFilename(new Date(), timeZone));
      setMsg(`Excel workbook ready (${r.where}). It is rebuilt from your saved workouts each time, so nothing is duplicated.`);
    } catch (e) { setMsg(`Export failed: ${e.message}`); }
  };
  const sel = selected && ctx ? calendarMonth(selected.slice(0, 7), ctx).days.find((d) => d.date === selected) : null;

  return (
    <ScrollView testID="training-screen" contentContainerStyle={{ padding: 20, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <PrimaryButton secondary onPress={onBack}>Back to Jim</PrimaryButton>
      <Text style={[type.h1, { marginTop: 16 }]}>Training</Text>
      <Text style={type.body}>{a.thisWeek} gym days this week · {a.thisMonth} this month · {a.lifetime} all time · streak {a.currentStreak} (best {a.longestStreak})</Text>
      <Text style={[type.small, { marginTop: 4 }]}>A gym day counts when you finish a workout with at least one saved set. JimBro does not track where you are.</Text>
      {msg ? <Text accessibilityLiveRegion="polite" style={[type.small, { color: T.accentText, marginTop: 8 }]}>{msg}</Text> : null}

      <Card style={{ marginTop: 16 }}>
        {ctx ? <Calendar ctx={ctx} month={month} setMonth={setMonth} selected={selected} onSelect={tapDate} /> : (
          <View>
            <Text style={type.title}>Calendar</Text>
            <Text style={type.body}>{program ? 'Set your training days to see scheduled, missed and rest days.' : 'Build a program in chat to get a weekly schedule.'} Completed days: {a.days.slice(-10).join(', ') || 'none yet'}.</Text>
            {program ? <PrimaryButton onPress={() => saveSchedule(createDefaultSchedule(program))}>Set my training days</PrimaryButton> : null}
          </View>
        )}
        {sel ? (
          <View style={{ marginTop: 10 }}>
            <Text style={type.label}>{sel.date}: {sel.name ?? '—'} · {sel.status}{sel.rescheduled ? ' · rescheduled' : ''}</Text>
            <PrimaryButton secondary onPress={() => { setSwapFrom(sel.date); setMsg('Now tap the date to swap with (this week only).'); }}>Swap this day with another date</PrimaryButton>
          </View>
        ) : null}
      </Card>

      {schedule ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={type.title}>Weekly split</Text>
          <Text style={[type.small, { marginTop: 4 }]}>Tap a day, then another day to move or swap it. This changes every week.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {WEEKDAYS.map((wd) => {
              const idx = schedule.week[wd];
              const name = idx == null ? 'Rest' : program.weeks[0].sessions[idx].name;
              return (
                <TouchableOpacity key={wd} testID={`weekday-${wd}`} accessibilityRole="button" accessibilityLabel={`${WEEKDAY_NAMES[wd]}: ${name}`} onPress={() => tapWeekday(wd)}
                  style={[st.weekday, pickDay === wd && { borderColor: T.accentText }, idx != null && { backgroundColor: T.chat.tinted }]}>
                  <Text style={{ color: T.textMute, fontSize: 11 }}>{WEEKDAY_NAMES[wd].slice(0, 3)}</Text>
                  <Text style={{ color: idx == null ? T.textMute : T.text, fontSize: 13, fontWeight: '700' }}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[type.label, { marginTop: 14, marginBottom: 6 }]}>If you miss a workout</Text>
          <Chips options={Object.keys(MISSED_POLICIES).map((k) => [k, k === 'keep_calendar' ? 'Keep the calendar' : 'Push it back'])} value={schedule.missedPolicy} onChange={(missedPolicy) => change({ ...schedule, missedPolicy })} />
          <Text style={type.small}>{MISSED_POLICIES[schedule.missedPolicy]}</Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: 16 }}>
        <Text style={type.title}>Gym days per week, last 8 weeks</Text>
        <BarChart points={weekly} />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Text style={type.title}>Exercise progress</Text>
        {exercises.length ? exercises.map((e) => (
          <View key={e.id} testID={`progress-${e.id}`} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 8 }}>
            <Text style={type.label}>{exerciseName(e.id)} · {e.sessions} session{e.sessions === 1 ? '' : 's'} · {e.rec.trend}</Text>
            <Text style={type.small}>First {e.first} → latest {e.last}{e.heaviest > 0 ? ` · heaviest ${e.heaviest} ${settings.unit}` : ''}</Text>
            <Text style={[type.small, { color: T.textDim }]}>Next: {e.rec.why}</Text>
          </View>
        )) : <Text style={type.body}>Finish a workout to see progress here.</Text>}
      </Card>

      <PrimaryButton onPress={exportExcel}>Export to Excel</PrimaryButton>
      <Text style={type.small}>Four sheets: attendance, every set, your split and progression analytics (with formulas). Your data stays on this device unless you share the file.</Text>
    </ScrollView>
  );
}

const st = {
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  cell: { width: '14.28%', aspectRatio: 1, maxHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10, borderColor: 'transparent' },
  head: { color: T.textMute, fontSize: 11, textAlign: 'center', textAlignVertical: 'center', borderWidth: 0 },
  weekday: { minWidth: 84, minHeight: 52, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: T.border, justifyContent: 'center' },
};
