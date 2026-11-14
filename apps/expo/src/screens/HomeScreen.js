import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useApp } from '../AppState.js';
import { ImportSheet } from '../components/ImportSheet.js';
import { MissionCard } from '../components/Mission.js';
import { Card, Chips, Icon, IconButton, JimBars, PrimaryButton } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { askJim, historyFor, proxyKey, proxyUrl } from '../lib/jimAI.js';
import { personaFor } from '../lib/personas.js';
import { healthSummary } from '../lib/healthSummary.js';
import { HOME_OPTIONS, HOME_SUBTITLE, nextWorkout } from '../lib/homeActions.js';
import { FOCUS_LABEL, parseMission, planMission } from '../lib/mission.js';
import { answerContext } from '../lib/coachQA.js';
import { answerPerformance } from '../lib/perfCoach.js';
import { isCompact } from '../lib/layout.js';
import { buildPlan } from '../lib/plans.js';
import { R, T, type } from '../theme.js';

const GOALS = [['hypertrophy', 'Build muscle'], ['general', 'Endurance'], ['strength', 'Get stronger']];
const PROXY_URL = proxyUrl({ EXPO_PUBLIC_JIM_PROXY_URL: process.env.EXPO_PUBLIC_JIM_PROXY_URL }, Constants.expoConfig?.extra);
const PROXY_KEY = proxyKey({ EXPO_PUBLIC_JIM_PROXY_KEY: process.env.EXPO_PUBLIC_JIM_PROXY_KEY }, Constants.expoConfig?.extra);
const TALK_SEND_MS = 1800; // Talk mode: send dictated text after this long without changes.
const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbells', 'Dumbbells'], ['pullup_bar', 'Pull-up bar'], ['bodyweight', 'Bodyweight']];

function Glow() {
  return (
    <Svg width="100%" height={110} viewBox="0 0 400 110" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={T.accent} stopOpacity="0.55" />
          <Stop offset="1" stopColor={T.accent} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d="M0 70 C80 95 140 95 210 72 C280 48 330 30 400 34 L400 110 L0 110 Z" fill="url(#glow)" />
      <Path d="M0 70 C80 95 140 95 210 72 C280 48 330 30 400 34" stroke={T.accent} strokeWidth="2" fill="none" />
    </Svg>
  );
}

function PlanCard({ goal: initialGoal = 'hypertrophy' }) {
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
        <PrimaryButton secondary onPress={() => startWorkout('Plan day 1', plan.days[0])}>Start day 1</PrimaryButton>
      ) : null}
    </Card>
  );
}

export function HomeScreen({ openLog, openActivity, go }) {
  const { settings, say, voice, logSet, updateSet, deleteSet, startWorkout, active, history, goals, plan, startMission } = useApp();
  const MISSION_CHIPS = ['I have 20 minutes, help me finish chest day', '30 min legs', '15 min, you pick'];
  const [text, setText] = useState('');
  const compact = isCompact(useWindowDimensions().width);
  const [messages, setMessages] = useState([]);
  const [source, setSource] = useState(PROXY_URL ? 'ai' : 'offline');
  const [thinking, setThinking] = useState(false);
  const [talk, setTalk] = useState(false);
  const scroll = useRef(null);
  const input = useRef(null);
  const talkRef = useRef(false);
  talkRef.current = talk;
  const persona = personaFor(settings.persona ?? settings.tone);
  const health = healthSummary({ history, active, goals, plan });

  const push = (...m) => {
    setMessages((cur) => [...cur, ...m]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  // Talk mode always speaks (in the persona's voice) and reopens dictation when Jim is done.
  const speak = (line) => {
    if (!line) return;
    if (!talkRef.current) return say(line);
    voice.say(line, { force: true, onDone: () => talkRef.current && input.current?.focus() });
  };

  const send = async (raw) => {
    const message = raw.trim();
    if (!message || thinking) return;
    setText('');
    const prior = historyFor(messages);
    push({ me: true, text: message });
    // Performance questions ("how was my last set?", "should I go heavier?") are answered from the
    // recorded sets on the phone, so every claim comes from data.
    const perfReply = answerPerformance(message, { history, active })
      ?? answerContext(message, { history, active, plan, settings, profile: settings.profile ?? {} });
    if (perfReply) {
      push({ me: false, text: perfReply });
      speak(perfReply);
      return;
    }
    // Workout Mission: a time-boxed session request is planned on the phone (no AI call), then confirmed.
    const ask = parseMission(message);
    if (ask.recognized) {
      const mission = planMission({ minutes: ask.minutes, focus: ask.focus, history, settings, now: new Date() });
      const intro = `Here's a ${mission.minutes}-minute ${(FOCUS_LABEL[mission.focus] ?? '').toLowerCase()} session, about ${mission.estMinutes} minutes with rests. ${history.length ? 'I picked it from your history.' : "No history yet, so we start light and I adjust after each set."} Start when you're ready.`.replace('  ', ' ');
      push({ me: false, text: intro }, { kind: 'mission', mission });
      speak(intro);
      return;
    }
    setThinking(true);
    const r = await askJim({ message, history: prior, state: { settings, history, active, goals, plan }, url: PROXY_URL, key: PROXY_KEY });
    setThinking(false);
    if (r.source !== 'safety') setSource(r.source);
    // Never change data here: proposals become confirm cards and wait for the user.
    const out = [];
    if (r.reply) out.push({ me: false, text: r.reply, safety: r.safety, suggestion: r.suggestion });
    r.proposals.forEach((intent) => out.push({ kind: 'confirm', intent }));
    push(...out);
    speak(r.reply || r.proposals[0]?.summary);
  };

  // Home options: start (next plan day or quick workout) -> Coach, plan builder, progress tab.
  const choose = (id) => {
    if (id === 'start') {
      if (!active) {
        const next = nextWorkout(plan, history);
        startWorkout(next.name, next.planned);
      }
      go?.('Coach');
    } else if (id === 'plan') {
      const intro = "Let's build your plan. Pick a goal and save it, or import past workouts and use a reference photo.";
      push({ me: true, text: 'Create a new plan.' }, { me: false, text: intro }, { kind: 'plan' }, { kind: 'import' });
      speak(intro);
    } else {
      go?.('Progress');
    }
  };

  // Talk mode: keyboard dictation fills the box; once it settles, send it hands-free.
  useEffect(() => {
    if (!talk || !text.trim()) return undefined;
    const t = setTimeout(() => send(text), TALK_SEND_MS);
    return () => clearTimeout(t);
  }, [talk, text]);

  const toggleTalk = () => {
    const next = !talk;
    setTalk(next);
    talkRef.current = next;
    if (next) {
      speak("I'm listening. Tap the mic on your keyboard and talk.");
      input.current?.focus();
    } else {
      voice.stop();
    }
  };

  const confirmIntent = (i, intent) => {
    let reply;
    if (intent.type === 'log') {
      if (!active) {
        push({ me: false, text: 'Start a workout before confirming these sets.' });
        return;
      }
      intent.sets.forEach((x) => logSet({ ...x, rpe: x.rpe ?? null, source: 'voice', reps_detail: [] }, 'Logged with Jim'));
      const x = intent.sets[0];
      const n = intent.sets.length > 1 ? `${intent.sets.length} sets of ` : '';
      reply = `Logged ${n}${x.reps} × ${exerciseName(x.exercise)} at ${x.weight} ${x.unit}.`;
    } else if (intent.type === 'correct') {
      updateSet(intent.target.setId, intent.changes);
      reply = 'Done, I fixed that set.';
    } else {
      deleteSet(intent.target.setId);
      reply = 'Done, that set is gone.';
    }
    setMessages((cur) => cur.map((m, j) => (j === i ? { me: false, text: reply } : m)));
    speak(reply);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={st.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 }}>
          <Icon name="arm-flex" size={compact ? 24 : 30} color={T.accent} />
          <Text numberOfLines={1} style={[type.h2, { flexShrink: 1 }, compact && { fontSize: 20 }]}>Jim · {personaFor(settings.persona).name.replace(/s*Jims*/, '')}</Text>
          <View accessibilityLabel={source === 'ai' ? 'Jim is using Claude' : 'Jim is offline, using built-in rules'} style={[st.badge, source === 'ai' && st.badgeAI, compact && { padding: 4 }]}>
            {compact
              ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: source === 'ai' ? T.accent : T.textMute }} />
              : <Text style={[st.badgeText, source === 'ai' && { color: T.accentText }]}>{source === 'ai' ? 'AI' : 'offline'}</Text>}
          </View>
        </View>
        <TouchableOpacity accessibilityLabel={talk ? 'Stop talk mode' : 'Start talk mode'} onPress={toggleTalk} style={[st.talk, talk && st.talkOn]}>
          <Icon name={talk ? 'account-voice' : 'account-voice-off'} size={18} color={talk ? T.onAccent : T.textDim} />
          {compact ? null : <Text style={{ color: talk ? T.onAccent : T.textDim, fontWeight: '700' }}>{talk ? 'Talking' : 'Talk'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="Activity and settings" onPress={openActivity}>
          <Icon name="bell" size={24} color={T.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, paddingBottom: 30, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${health.text}. Open progress.`} onPress={() => go?.('Progress')} style={st.health}>
          <Icon name="heart-pulse" size={22} color={T.accent} />
          <Text style={st.healthText}>{health.text}</Text>
          <Icon name="chevron-right" size={20} color={T.textMute} />
        </TouchableOpacity>
        {!messages.length ? (
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <JimBars height={64} />
            <Text style={[type.h1, { marginTop: 28, fontSize: 32 }]}>Hey, I'm Jim</Text>
            <Text style={[type.body, { textAlign: 'center', marginTop: 10, fontSize: 17, lineHeight: 25 }]}>
              {HOME_SUBTITLE}
            </Text>
            <View style={st.goals}>
              {HOME_OPTIONS.map((g) => (
                <TouchableOpacity key={g.id} accessibilityRole="button" accessibilityLabel={g.label.replace('\n', ' ')} style={st.goal} onPress={() => choose(g.id)}>
                  <Icon name={g.icon} size={30} color={T.accent} />
                  <Text style={st.goalText}>{g.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[type.label, { marginTop: 22 }]}>Short on time? Give Jim a mission</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 }}>
              {MISSION_CHIPS.map((c) => (
                <TouchableOpacity key={c} accessibilityRole="button" onPress={() => send(c)} style={{ borderWidth: 1, borderColor: T.accent, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ color: T.accentText, fontWeight: '600', fontSize: 13 }}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m, i) => {
            if (m.kind === 'plan') return <PlanCard key={i} />;
            if (m.kind === 'mission') {
              return (
                <MissionCard
                  key={i}
                  mission={m.mission}
                  onStart={() => { startMission(m.mission); go?.('Coach'); }}
                  onCancel={() => setMessages((cur) => cur.filter((_, j) => j !== i))}
                />
              );
            }
            if (m.kind === 'import') return <ImportSheet key={i} proxyUrl={PROXY_URL} proxyKey={PROXY_KEY} onDone={speak} />;
            if (m.kind === 'confirm') {
              return (
                <Card key={i} style={{ marginTop: 10 }}>
                  <Text style={type.title}>{{ log: 'Log this?', correct: 'Fix this set?', delete: 'Delete this set?' }[m.intent.type]}</Text>
                  <Text style={type.body}>{m.intent.summary}</Text>
                  {m.intent.type === 'log' && !active ? <Text style={type.small}>Start a workout on Home before confirming these sets.</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <PrimaryButton style={{ flex: 1 }} disabled={m.intent.type === 'log' && !active} onPress={() => confirmIntent(i, m.intent)}>Confirm</PrimaryButton>
                    <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setMessages((cur) => cur.filter((_, j) => j !== i))}>Cancel</PrimaryButton>
                  </View>
                </Card>
              );
            }
            return (
              <View key={i} style={[st.bubble, m.me ? st.me : st.jim, m.safety && { borderColor: T.amber }]}>
                {!m.me ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <JimBars height={14} />
                    <Text style={{ color: T.accentText, fontWeight: '700' }}>Jim</Text>
                  </View>
                ) : null}
                <Text style={{ color: T.text, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
                {m.suggestion ? (
                  <TouchableOpacity disabled={!active} onPress={() => openLog({ ...m.suggestion })} style={{ marginTop: 8, opacity: active ? 1 : 0.5 }}>
                    <Text style={{ color: T.accent, fontWeight: '700' }}>Log {m.suggestion.weight} {m.suggestion.unit} × {m.suggestion.reps} →</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })
        )}
        {thinking ? <Text style={[type.small, { marginTop: 10 }]}>Jim is thinking…</Text> : null}
      </ScrollView>

      <View style={{ height: 110, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 10 }}>
        <Glow />
        <View style={st.composer}>
          <TouchableOpacity accessibilityLabel={active ? 'Log a set' : 'Start a workout to log sets'} accessibilityState={{ disabled: !active }} disabled={!active} style={{ opacity: active ? 1 : 0.5 }} onPress={() => openLog()}>
            <Icon name="plus" size={26} color={T.text} />
          </TouchableOpacity>
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => send(text)}
            placeholder={talk ? 'Tap the keyboard mic and talk…' : 'Message Jim...'}
            placeholderTextColor={T.textMute}
            returnKeyType="send"
            style={{ flex: 1, color: T.text, fontSize: 16, paddingHorizontal: 10 }}
          />
          {text.trim() ? (
            <IconButton icon="arrow-up" size={34} ring={T.accent} fill={T.accent} color={T.onAccent} label="Send" onPress={() => send(text)} />
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
  health: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: R.md, borderWidth: 1, borderColor: T.border, backgroundColor: T.card },
  healthText: { flex: 1, color: T.textDim, fontSize: 14, lineHeight: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  goals: { flexDirection: 'row', gap: 12, marginTop: 40, alignSelf: 'stretch' },
  goal: { flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: R.md, borderWidth: 1, borderColor: T.borderStrong, backgroundColor: 'rgba(255,255,255,0.03)', gap: 8 },
  goalText: { color: T.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.borderStrong, borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(6,10,9,0.9)' },
  bubble: { borderRadius: R.md, padding: 12, marginTop: 10, maxWidth: '88%', borderWidth: 1 },
  me: { alignSelf: 'flex-end', backgroundColor: T.accentSoft, borderColor: T.accent },
  badge: { borderWidth: 1, borderColor: T.border, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeAI: { borderColor: T.accent, backgroundColor: T.accentSoft },
  badgeText: { color: T.textMute, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  talk: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.borderStrong, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 'auto', marginRight: 14, flexShrink: 0 },
  talkOn: { backgroundColor: T.accent, borderColor: T.accent },
  jim: { alignSelf: 'flex-start', backgroundColor: T.card, borderColor: T.border },
});
