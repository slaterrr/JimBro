// Chat cards for multi-week programs: intake questions, the expandable program (save/cancel),
// a single session (today / shorter) and swap options. Cards never save anything themselves:
// the chat screen confirms and writes through AppState.
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Card, Chips, Icon, PrimaryButton } from './kit.js';
import { exerciseName } from '../lib/exercises.js';
import { EXPERIENCE, GOALS } from '../lib/program.js';
import { itemLine } from '../lib/programChat.js';
import { T, type } from '../theme.js';

const eyebrow = { color: T.highlight, fontSize: 10, letterSpacing: 2, fontWeight: '600' };
const cardStyle = { marginTop: 18, borderColor: T.chat.accentBorder, backgroundColor: T.chat.tinted };

export function IntakeCard({ field, onAnswer, onCancel }) {
  const [picked, setPicked] = useState([]);
  const toggle = (v) => setPicked((p) => (v === 'none' || v === 'full_gym' ? [v] : p.includes(v) ? p.filter((x) => x !== v) : [...p.filter((x) => x !== 'none' && x !== 'full_gym'), v]));
  return (
    <Card testID={`program-intake-${field.id}`} style={cardStyle}>
      <Text style={eyebrow}>{field.id === 'goal' ? 'YOUR PROGRAM' : 'BUILDING YOUR PROGRAM'}</Text>
      <Text style={[type.title, { marginTop: 10, marginBottom: 10 }]}>{field.question}</Text>
      {field.multi
        ? <Chips multi options={field.options} value={picked} onChange={toggle} />
        : <Chips options={field.options} value={null} onChange={(v) => onAnswer(v)} />}
      <Text style={[type.small, { marginTop: 8 }]}>Tap an option or type your answer.</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {field.multi ? <PrimaryButton style={{ flex: 1 }} disabled={!picked.length} onPress={() => onAnswer(picked)}>Done</PrimaryButton> : null}
        <PrimaryButton secondary style={{ flex: 1 }} onPress={onCancel}>Stop building</PrimaryButton>
      </View>
    </Card>
  );
}

function Session({ session, expandedDefault = false }) {
  const [open, setOpen] = useState(expandedDefault);
  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 10 }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${open ? 'Collapse' : 'Expand'} day ${session.day}: ${session.name}`} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color={T.accentText} />
        <Text style={[type.label, { color: T.text, flex: 1 }]}>Day {session.day} · {session.name}</Text>
        <Text style={type.small}>~{Math.round(session.estimated_minutes)} min</Text>
      </TouchableOpacity>
      {open ? (
        <View style={{ paddingLeft: 26, gap: 6 }}>
          <Text style={type.small}>{session.focus}</Text>
          <Text style={[type.small, { color: T.textDim }]}>Warm-up: {session.warmup.join(' ')}</Text>
          {session.items.map((i, k) => (
            <View key={k} style={{ marginTop: 4 }}>
              <Text style={{ color: T.text, fontSize: 13, lineHeight: 19 }}>{k + 1}. {itemLine(i)}</Text>
              <Text style={type.small}>{i.load.text}</Text>
              {i.substitutes.length ? <Text style={type.small}>Swap options: {i.substitutes.map((x) => exerciseName(x)).join(', ')}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Week({ week, expandedDefault }) {
  const [open, setOpen] = useState(expandedDefault);
  return (
    <View testID={`program-week-${week.week}`} style={{ marginTop: 12 }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${open ? 'Collapse' : 'Expand'} week ${week.week}`} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={20} color={T.accent} />
        <Text style={[type.title, { fontSize: 15, flex: 1 }]}>Week {week.week}{week.deload ? ' · Deload' : ''}</Text>
        <Text style={type.small}>{week.sessions.reduce((t, s) => t + s.items.reduce((a, i) => a + i.sets, 0), 0)} sets</Text>
      </TouchableOpacity>
      {open ? <View><Text style={[type.small, { marginLeft: 28 }]}>{week.note}</Text>{week.sessions.map((s) => <Session key={s.day} session={s} expandedDefault={expandedDefault && s.day === 1} />)}</View> : null}
    </View>
  );
}

export function ProgramCard({ message, currentPlan, onSave, onCancel }) {
  const { program, mode, summary } = message;
  const [rules, setRules] = useState(false);
  const i = program.intake;
  const replacing = Boolean(currentPlan);
  return (
    <Card testID="program-card" style={cardStyle}>
      <Text style={eyebrow}>{mode === 'swap' ? 'PROGRAM CHANGE · REVIEW BEFORE SAVING' : 'ORIGINAL JIMBRO PROGRAM · CHECKED'}</Text>
      <Text style={[type.h2, { marginTop: 10, fontSize: 21 }]}>{program.name}</Text>
      {summary ? <Text style={[type.body, { marginTop: 6 }]}>{summary}</Text> : null}
      <Text style={[type.small, { marginTop: 6 }]}>{GOALS[i.goal]} · {EXPERIENCE[i.experience]} · {i.daysPerWeek} days/week · up to {i.minutes} min · {i.weeks} weeks · version {program.version}</Text>
      <Text style={[type.small, { marginTop: 6 }]}>Checked on your phone: every exercise is in the library and fits your equipment{i.avoid.length ? ' and limitations' : ''}; sessions fit the time; effort and weekly volume per muscle are within limits. Starting loads come only from your logged sets.</Text>
      {program.weeks.map((w) => <Week key={w.week} week={w} expandedDefault={w.week === 1} />)}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={rules ? 'Hide progression rules' : 'Show progression rules'} onPress={() => setRules(!rules)} style={{ marginTop: 14, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={rules ? 'chevron-down' : 'chevron-right'} size={20} color={T.accent} />
        <Text style={[type.title, { fontSize: 15 }]}>Progression, hold, reduce and deload</Text>
      </TouchableOpacity>
      {rules ? (
        <View style={{ paddingLeft: 28, gap: 6 }}>
          <Text style={type.small}>Increase: {program.progression.increase}</Text>
          <Text style={type.small}>Hold: {program.progression.hold}</Text>
          <Text style={type.small}>Reduce: {program.progression.reduce}</Text>
          <Text style={type.small}>Stop: {program.progression.stop}</Text>
          <Text style={type.small}>Deload: {program.deload}</Text>
          {program.notes.map((n) => <Text key={n} style={type.small}>{n}</Text>)}
        </View>
      ) : null}
      {replacing ? <Text style={[type.small, { marginTop: 12, color: T.textDim }]}>This replaces your current plan{currentPlan.name ? ` (${currentPlan.name})` : ''}. The old version is kept in your plan history.</Text> : null}
      <Text style={[type.small, { marginTop: 8 }]}>Nothing is saved until you tap {replacing ? 'Replace my plan' : 'Save program'}.</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrimaryButton style={{ flex: 1 }} onPress={onSave}>{replacing ? 'Replace my plan' : 'Save program'}</PrimaryButton>
        <PrimaryButton secondary style={{ flex: 1 }} onPress={onCancel}>Cancel</PrimaryButton>
      </View>
    </Card>
  );
}

export function SessionCard({ message, onStart, disabledReason }) {
  const { session, name } = message;
  return (
    <Card testID="program-session-card" style={cardStyle}>
      <Text style={eyebrow}>{message.short ? 'SHORTER SESSION · TODAY ONLY' : "TODAY'S SESSION"}</Text>
      <Text style={[type.title, { marginTop: 10 }]}>{name} · ~{Math.round(session.estimated_minutes)} min</Text>
      <Text style={[type.small, { marginTop: 6 }]}>Warm-up: {session.warmup.join(' ')}</Text>
      {session.items.map((i, k) => <Text key={k} style={{ color: T.text, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{k + 1}. {itemLine(i)}</Text>)}
      {disabledReason ? <Text style={[type.small, { marginTop: 8 }]}>{disabledReason}</Text> : null}
      <PrimaryButton disabled={Boolean(disabledReason)} onPress={onStart}>Start this session</PrimaryButton>
    </Card>
  );
}

export function SwapCard({ message, onPick, onCancel }) {
  return (
    <Card testID="program-swap-card" style={cardStyle}>
      <Text style={eyebrow}>SWAP {exerciseName(message.from).toUpperCase()}</Text>
      <Text style={[type.small, { marginTop: 8 }]}>From week {message.fromWeek} to the end of the block. You'll review the changed program before it's saved.</Text>
      {message.options.map((o) => (
        <PrimaryButton key={o.exercise} secondary onPress={() => onPick(o.exercise)}>{`Use ${exerciseName(o.exercise)}`}</PrimaryButton>
      ))}
      <PrimaryButton secondary onPress={onCancel}>Keep {exerciseName(message.from)}</PrimaryButton>
    </Card>
  );
}
