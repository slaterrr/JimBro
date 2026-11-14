import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useApp } from '../AppState.js';
import { Card, Chips, Icon, IconButton, JimBars, PrimaryButton } from '../components/kit.js';
import { coachReply } from '../lib/coach.js';
import { exerciseName } from '../lib/exercises.js';
import { parseSetUtterance } from '../lib/parse.js';
import { buildPlan } from '../lib/plans.js';
import { R, T, type } from '../theme.js';

const GOALS = [
  { id: 'hypertrophy', icon: 'arm-flex-outline', label: 'Build\nMuscle', ask: 'I want to build muscle.' },
  { id: 'general', icon: 'heart-pulse', label: 'Improve\nEndurance', ask: 'I want to improve my endurance.' },
  { id: 'strength', icon: 'target', label: 'Get\nStronger', ask: 'I want to get stronger.' },
];
const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbells', 'Dumbbells'], ['pullup_bar', 'Pull-up bar'], ['bodyweight', 'Bodyweight']];

function Glow() {
  return (
    <Svg width="100%" height={110} viewBox="0 0 400 110" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={T.purple} stopOpacity="0.55" />
          <Stop offset="1" stopColor={T.purple} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d="M0 70 C80 95 140 95 210 72 C280 48 330 30 400 34 L400 110 L0 110 Z" fill="url(#glow)" />
      <Path d="M0 70 C80 95 140 95 210 72 C280 48 330 30 400 34" stroke="#b6efdf" strokeWidth="2" fill="none" />
    </Svg>
  );
}

function PlanCard({ goal }) {
  const { savePlan, startWorkout, active, plan: saved } = useApp();
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(45);
  const [equipment, setEquipment] = useState(['barbell', 'dumbbells']);
  const req = { goal, days_per_week: days, minutes_per_session: minutes, equipment };
  const plan = equipment.length ? buildPlan(req) : null;
  const isSaved = saved && JSON.stringify(saved.request) === JSON.stringify(req);
  return (
    <Card style={{ marginTop: 10 }}>
      <Text style={type.title}>Your weekly plan</Text>
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
        <PrimaryButton secondary onPress={() => startWorkout('Plan day 1', plan.days[0])}>Start day 1</PrimaryButton>
      ) : null}
    </Card>
  );
}

export function HomeScreen({ openLog, openActivity, go }) {
  const { settings, say, allSets, logSet, active, startWorkout, history } = useApp();
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const scroll = useRef(null);
  const input = useRef(null);

  const push = (...m) => {
    setMessages((cur) => [...cur, ...m]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const send = (raw, goal) => {
    const message = raw.trim();
    if (!message) return;
    setText('');
    const parsed = goal ? null : parseSetUtterance(message);
    if (parsed) {
      push({ me: true, text: message }, { kind: 'confirm', set: { unit: settings.unit, ...parsed } });
      return;
    }
    if (goal) {
      const intro = {
        hypertrophy: "Let's build muscle. Here's a plan with 8–12 rep work; adjust it and save it.",
        general: "Endurance it is. I'll keep sessions moving with short rests. Real cardio still matters, so add it on off days.",
        strength: "Let's get stronger. Heavy 3–5 rep sets with long rests. Here's your week.",
      }[goal];
      push({ me: true, text: message }, { me: false, text: intro }, { kind: 'plan', goal });
      say(intro);
      return;
    }
    const r = coachReply(message, settings.tone, allSets);
    push({ me: true, text: message }, { me: false, text: r.text, safety: r.source === 'safety', suggestion: r.suggestion });
    say(r.text);
  };

  const confirmSet = (i, s) => {
    logSet({ ...s, rpe: s.rpe ?? null, source: 'voice', reps_detail: [] }, 'Logged with Jim');
    setMessages((cur) => cur.map((m, j) => (j === i ? { me: false, text: `Logged ${s.reps} × ${exerciseName(s.exercise)} at ${s.weight} ${s.unit}.` } : m)));
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="arm-flex" size={30} color={T.purple} />
          <Text style={type.h2}>Jim</Text>
        </View>
        <TouchableOpacity accessibilityLabel="Activity and settings" onPress={openActivity}>
          <Icon name="bell" size={24} color={T.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, paddingBottom: 30, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {!messages.length ? (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <JimBars height={64} />
            <Text style={[type.h1, { marginTop: 28, fontSize: 32 }]}>Hey, I'm Jim</Text>
            <Text style={[type.body, { textAlign: 'center', marginTop: 10, fontSize: 17, lineHeight: 25 }]}>
              Your AI gym bro. Tell me what you want to work on today.
            </Text>
            <View style={st.goals}>
              {[
                ['play', 'Start a Workout', () => { if (!active) startWorkout('Strength session'); openLog(); }],
                ['calendar-plus', 'Create a New Plan', () => push({ kind: 'choose-plan' })],
                ['chart-line', 'Review My Progress', () => {
                  push({ me: false, text: history.length ? `You've completed ${history.length} workouts. Compare your strength and volume across sessions, months, and years.` : 'Finish your first workout to begin reviewing your progress.' }, { kind: 'review' });
                }],
              ].map(([icon, label, action]) => (
                <TouchableOpacity key={label} style={st.goal} onPress={action}>
                  <Icon name={icon} size={30} color={T.purple} />
                  <Text style={st.goalText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m, i) => {
            if (m.kind === 'review') return <PrimaryButton key={i} onPress={() => go('Progress')}>View comparisons</PrimaryButton>;
            if (m.kind === 'choose-plan') return <Card key={i}><Text style={type.title}>Choose your goal</Text>{GOALS.filter(g => g.id !== 'general').map(g => <PrimaryButton key={g.id} onPress={() => send(g.ask, g.id)}>{g.label.replace('\n', ' ')}</PrimaryButton>)}</Card>;
            if (m.kind === 'plan') return <PlanCard key={i} goal={m.goal} />;
            if (m.kind === 'confirm') {
              return (
                <Card key={i} style={{ marginTop: 10 }}>
                  <Text style={type.title}>Log this set?</Text>
                  <Text style={type.body}>{m.set.reps} × {exerciseName(m.set.exercise)} at {m.set.weight} {m.set.unit}{m.set.rpe ? ` · RPE ${m.set.rpe}` : ''}</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <PrimaryButton style={{ flex: 1 }} onPress={() => confirmSet(i, m.set)}>Confirm</PrimaryButton>
                    <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setMessages((cur) => cur.filter((_, j) => j !== i))}>Discard</PrimaryButton>
                  </View>
                </Card>
              );
            }
            return (
              <View key={i} style={[st.bubble, m.me ? st.me : st.jim, m.safety && { borderColor: T.amber }]}>
                {!m.me ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <JimBars height={14} />
                    <Text style={{ color: T.violetText, fontWeight: '700' }}>Jim</Text>
                  </View>
                ) : null}
                <Text style={{ color: T.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
                {m.suggestion ? (
                  <TouchableOpacity onPress={() => openLog({ ...m.suggestion })} style={{ marginTop: 8 }}>
                    <Text style={{ color: T.purple, fontWeight: '700' }}>Log {m.suggestion.weight} {m.suggestion.unit} × {m.suggestion.reps} →</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={{ height: 110, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 10 }}>
        <Glow />
        <View style={st.composer}>
          <TouchableOpacity accessibilityLabel="Log a set" onPress={() => openLog()}>
            <Icon name="plus" size={26} color={T.text} />
          </TouchableOpacity>
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => send(text)}
            placeholder="Message Jim..."
            placeholderTextColor={T.textMute}
            returnKeyType="send"
            style={{ flex: 1, color: T.text, fontSize: 16, paddingHorizontal: 10 }}
          />
          {text.trim() ? (
            <IconButton icon="arrow-up" size={34} ring={T.purple} fill={T.purple} label="Send" onPress={() => send(text)} />
          ) : (
            <TouchableOpacity accessibilityLabel="Dictate (use the keyboard microphone)" onPress={() => input.current?.focus()}>
              <Icon name="microphone-outline" size={24} color={T.textDim} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  goals: { flexDirection: 'row', gap: 12, marginTop: 40, alignSelf: 'stretch' },
  goal: { flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: R.md, borderWidth: 1, borderColor: T.borderStrong, backgroundColor: 'rgba(255,255,255,0.03)', gap: 8 },
  goalText: { color: T.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.borderStrong, borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(10,8,14,0.9)' },
  bubble: { borderRadius: R.md, padding: 12, marginTop: 10, maxWidth: '88%', borderWidth: 1 },
  me: { alignSelf: 'flex-end', backgroundColor: T.purpleSoft, borderColor: T.purple },
  jim: { alignSelf: 'flex-start', backgroundColor: T.card, borderColor: T.border },
});
