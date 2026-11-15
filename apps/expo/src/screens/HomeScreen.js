import Constants from 'expo-constants';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { useApp, useLiveCamera } from '../AppState.js';
import { PlanCard } from '../components/ChatPlanCard.js';
import { ImportSheet } from '../components/ImportSheet.js';
import { MissionCard } from '../components/Mission.js';
import { Card, Field, Icon, IconButton, JimBars, PrimaryButton } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { askJim, checkProxy, historyFor, proxyKey, proxyUrl, validateProposal } from '../lib/jimAI.js';
import { confirmedText, missionIntro } from '../lib/homeReplies.js';
import { healthSummary } from '../lib/healthSummary.js';
import { nextWorkout } from '../lib/homeActions.js';
import { parseMission, planMission } from '../lib/mission.js';
import { answerContext } from '../lib/coachQA.js';
import { answerPerformance } from '../lib/perfCoach.js';
import { SAFETY, SAFETY_TEXT } from '../lib/coach.js';
import { chatAction } from '../lib/chatActions.js';
import { CoachScreen } from './CoachScreen.js';
import { MusclesScreen } from './MusclesScreen.js';
import { ProgressScreen } from './ProgressScreen.js';
import { T, type } from '../theme.js';

const PROXY_URL = proxyUrl({ EXPO_PUBLIC_JIM_PROXY_URL: process.env.EXPO_PUBLIC_JIM_PROXY_URL }, Constants.expoConfig?.extra);
const PROXY_KEY = proxyKey({ EXPO_PUBLIC_JIM_PROXY_KEY: process.env.EXPO_PUBLIC_JIM_PROXY_KEY }, Constants.expoConfig?.extra);
const PANEL_LABELS = { camera: 'Workout studio', progress: 'Your progress', muscles: 'Muscle & recovery map', plan: 'Your training plan', import: 'Import & reference photo' };
const TOOL_LABELS = { get_recent_sets: 'Read workout history', get_live_session: 'Read measured camera reps', get_workout_context: 'Read your workout', get_goal_progress: 'Check your goals', get_weekly_checkin: 'Review your week', get_last_set_report: 'Read your set report', log_sets: 'Propose logging a set', correct_set: 'Propose a correction', delete_set: 'Propose deleting a set', show_panel: 'Open a chat tool' };
const QUICK = [
  { icon: 'camera-outline', title: 'Start a workout', detail: 'Your camera. Every rep.', message: 'Start a workout' },
  { icon: 'creation', title: 'Build me a plan', detail: 'A routine that fits your life.', message: 'Create a new plan' },
  { icon: 'chart-line', title: 'Review my progress', detail: 'Find your next small win.', message: 'Review my progress' },
  { icon: 'timer-outline', title: 'I have 20 minutes', detail: 'Make the most of today.', message: 'I have 20 minutes, help me train arms' },
];

function SmallButton({ icon, label, onPress, active = false }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[st.smallButton, active && { backgroundColor: T.accentSoft }]}><Icon name={icon} size={20} color={active ? T.accentText : T.textDim} /></TouchableOpacity>;
}

function CameraConfirm({ message, onConfirm, onCancel }) {
  const { settings } = useApp();
  const [weight, setWeight] = useState('0');
  const [rpe, setRpe] = useState('');
  const valid = weight.trim() !== '' && Number.isFinite(Number(weight)) && Number(weight) >= 0 && Number(weight) <= 2000 && (!rpe || (Number(rpe) >= 1 && Number(rpe) <= 10));
  return <Card style={st.confirmCard}>
    <Text style={st.eyebrow}>MEASURED ON YOUR DEVICE</Text>
    <Text style={[type.h2, { marginVertical: 10 }]}>{message.camera.reps.length} reps · {exerciseName(message.camera.movement)}</Text>
    <Text style={type.body}>Save these camera-counted reps? Enter any added weight. Zero means no external load.</Text>
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
      <Field accessibilityLabel="Added weight" label={`Added weight (${settings.unit}) · reported`} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <Field accessibilityLabel="Reported effort" label="RPE 1–10 · optional" value={rpe} onChangeText={setRpe} keyboardType="decimal-pad" />
    </View>
    <View style={{ flexDirection: 'row', gap: 10 }}><PrimaryButton style={{ flex: 1 }} disabled={!valid} onPress={() => onConfirm({ weight: Number(weight), rpe: rpe ? Number(rpe) : null })}>Confirm</PrimaryButton><PrimaryButton secondary style={{ flex: 1 }} onPress={onCancel}>Cancel</PrimaryButton></View>
  </Card>;
}

export function HomeScreen({ openLog, openActivity }) {
  const app = useApp();
  const { settings, say, voice, logSet, updateSet, deleteSet, startWorkout, finishWorkout, active, history, goals, plan, startMission, conversation } = app;
  const { snapshot: liveCamera, clear: clearCamera } = useLiveCamera();
  const { messages, busy: thinking, source, reason, error } = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [text, setText] = useState('');
  const [talk, setTalk] = useState(false);
  const [menu, setMenu] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const compact = width < 400;
  const scroll = useRef(null);
  const input = useRef(null);
  const mounted = useRef(true);
  const talkRef = useRef(false);
  talkRef.current = talk;
  const [proxy, setProxy] = useState(PROXY_URL ? 'checking' : 'offline');
  const health = healthSummary({ history, active, goals, plan });
  const aiOn = source === 'ai' || (proxy === 'ok' && source !== 'offline');
  const status = thinking ? 'Working on it…' : aiOn ? 'Connected to Jim AI' : source === 'local' ? 'Answered from your workout data' : proxy === 'checking' ? 'Connecting to Jim AI…' : 'Offline coach · AI service not connected';

  useEffect(() => {
    if (!PROXY_URL) return undefined;
    let alive = true;
    checkProxy({ url: PROXY_URL, key: PROXY_KEY }).then(r => { if (alive) setProxy(r.ok ? 'ok' : 'offline'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (messages.length) scroll.current?.scrollToEnd({ animated: true }); }, [messages, thinking]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; talkRef.current = false; voice.stop(); }; }, [voice]);

  const push = (...items) => conversation.update(cur => [...cur, ...items]);
  const speak = line => {
    if (!line) return;
    if (!talkRef.current) return say(line);
    voice.say(line, { force: true, onDone: () => talkRef.current && input.current?.focus() });
  };
  const closePanel = index => { if (conversation.getSnapshot().messages[index]?.panel === 'camera') clearCamera(); conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: `${PANEL_LABELS[m.panel] ?? 'Tool'} closed.` } : m)); };
  const openPanel = (panel, exercise) => {
    // Keep just one live camera mounted. Closing it releases the camera stream.
    conversation.update(cur => [...cur.map(m => m.kind === 'panel' && m.panel === panel ? { kind: 'notice', text: `${PANEL_LABELS[panel]} reopened below.` } : m), { kind: 'panel', panel, ...(exercise ? { exercise } : {}) }]);
    setMenu(false);
  };
  const go = screen => openPanel({ Coach: 'camera', Progress: 'progress', Muscles: 'muscles' }[screen] ?? 'progress');

  const confirmIntent = (index) => {
    const intent = conversation.claimConfirmation(index, p => Boolean(validateProposal(p, { history, active })));
    if (!intent) return;
    if (intent.type === 'log') intent.sets.forEach(x => logSet({ ...x, rpe: x.rpe ?? null, source: 'voice', reps_detail: [] }, 'Logged with Jim'));
    else if (intent.type === 'correct') updateSet(intent.target.setId, intent.changes);
    else deleteSet(intent.target.setId);
    const reply = confirmedText(intent, settings.persona);
    conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: reply } : m));
    speak(reply);
  };
  const cancelCard = index => conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: 'Cancelled. Your workout data was not changed.' } : m));
  const captureSet = (initial, camera) => {
    if (!camera?.reps.length) {
      push({ me: false, text: 'No completed camera reps to save yet. You can also tell me your exercise, reps and weight to log a set manually.' });
      return;
    }
    push({ kind: 'camera-confirm', camera });
  };
  const confirmCamera = (index, reported) => {
    const captured = conversation.claimConfirmation(index, m => m.camera?.reps.length > 0);
    if (!captured) return;
    const c = captured.camera;
    logSet({ exercise: c.movement, reps: c.reps.length, weight: reported.weight, unit: settings.unit, rpe: reported.rpe, source: 'camera', reps_detail: c.reps, camera_quality: c.quality, target: c.target, clips: c.clips }, 'Camera workout');
    conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: `Saved ${c.reps.length} measured reps of ${exerciseName(c.movement)}. Added weight and effort are user-reported.` } : m));
  };

  const send = async raw => {
    const message = raw.trim();
    if (!message) return;
    const preempts = SAFETY.test(message) || /^(stop|stop workout|stop camera|pause camera)[.!]?$/i.test(message);
    if (conversation.getSnapshot().busy && preempts) conversation.cancel();
    if (conversation.getSnapshot().busy) return;
    setText(''); setMenu(false); voice.stop();
    // "Yes" applies only to the current unexpired card. Destructive changes need an explicit tap.
    if (/^(yes|confirm|save it)[.!]?$/i.test(message)) {
      const index = conversation.getSnapshot().messages.findLastIndex(m => m.kind === 'confirm');
      if (index >= 0 && conversation.getSnapshot().messages[index].intent.type !== 'delete') { confirmIntent(index); return; }
    }
    const activeForJim = active && liveCamera?.sessionId === active.id ? { ...active, cameraSnapshot: liveCamera } : active;
    const result = await conversation.send(message, async prior => {
      const state = { settings, history, active: activeForJim, goals, plan };
      if (SAFETY.test(message)) {
        // Stop the local camera before any remote reasoning or response.
        conversation.update(cur => cur.map(m => m.kind === 'panel' && m.panel === 'camera' ? { kind: 'notice', text: 'Camera stopped.' } : m));
        clearCamera();
        return { source: 'safety', safety: true, reply: SAFETY_TEXT, proposals: [] };
      }
      if (/^(stop|stop workout|stop camera|pause camera)[.!]?$/i.test(message)) {
        conversation.update(cur => cur.map(m => m.kind === 'panel' && m.panel === 'camera' ? { kind: 'notice', text: 'Camera stopped.' } : m));
        clearCamera();
        return { source: 'local', reply: 'Stopped. Your saved sets are safe. Tell me when you want to continue.', proposals: [] };
      }
      if (/^(finish|end|complete) (my |the )?(workout|session)[.!]?$/i.test(message)) {
        finishWorkout(); clearCamera();
        conversation.update(cur => cur.map(m => m.kind === 'panel' && m.panel === 'camera' ? { kind: 'notice', text: 'Camera stopped.' } : m));
        return { source: 'local', reply: active?.sets.length ? `Workout finished. ${active.sets.length} saved sets are in your history.` : 'Workout finished. No sets were saved.', actions: [{ type: 'show_panel', panel: 'progress' }] };
      }
      if (/\bhow many reps\b/i.test(message) && liveCamera?.sessionId === active?.id && Date.now() - new Date(liveCamera.updatedAt).getTime() < 300000) {
        return { source: 'local', reply: `The camera has counted ${liveCamera.reps} reps of ${exerciseName(liveCamera.exercise)} in this set. These are measured on your device and are not saved until you confirm.`, toolCalls: [{ name: 'get_live_session', status: 'completed' }] };
      }
      const ask = parseMission(message);
      if (ask.recognized) {
        const mission = planMission({ minutes: ask.minutes, focus: ask.focus, history, settings, now: new Date() });
        const intro = missionIntro(mission, { hasHistory: history.length > 0, persona: settings.persona });
        return { source: 'local', reply: intro, messages: [{ me: false, text: intro }, { kind: 'mission', mission }] };
      }
      const action = chatAction(message);
      if (action) {
        if (action.panel === 'camera' && !active) { const next = nextWorkout(plan, history); startWorkout(next.name, next.planned); }
        return { source: 'local', reply: action.panel === 'camera' ? 'Let’s get moving. Allow your camera below and keep your body in frame. Video stays on this device; only your rep measurements are saved when you confirm.' : `Here’s ${PANEL_LABELS[action.panel].toLowerCase()}, right here in our conversation.`, actions: [action], toolCalls: [{ name: 'show_panel', status: 'completed' }] };
      }
      const mutation = /\b(log|save|correct|change|delete|remove|fix)\b/i.test(message);
      const answer = mutation ? null : answerPerformance(message, { history, active }) ?? answerContext(message, { history, active, plan, settings, profile: settings.profile ?? {} });
      if (answer) return { source: 'local', reply: answer, proposals: [], toolCalls: [{ name: 'get_workout_context', status: 'completed' }] };
      return askJim({ message, history: historyFor(prior), state, url: PROXY_URL, key: PROXY_KEY });
    });
    // Model-triggered panels use the same renderer and camera lifecycle as local actions.
    if (result?.actions?.some(a => a.panel === 'camera')) {
      const current = conversation.getSnapshot().messages;
      const latest = current.findLastIndex(m => m.kind === 'panel' && m.panel === 'camera');
      conversation.update(cur => cur.map((m, i) => m.kind === 'panel' && m.panel === 'camera' && i !== latest ? { kind: 'notice', text: 'Camera reopened below.' } : m));
    }
    if (result && mounted.current) speak(result.reply || result.proposals?.[0]?.summary);
  };
  useEffect(() => {
    if (!talk || !text.trim()) return undefined;
    const timeout = setTimeout(() => send(text), 1800);
    return () => clearTimeout(timeout);
  }, [talk, text]);
  const toggleTalk = () => {
    setTalk(!talk); talkRef.current = !talk;
    if (!talk) { speak('Use your keyboard microphone to talk. I’ll read my replies aloud.'); input.current?.focus(); }
    else voice.stop();
  };
  const newChat = () => { conversation.clear(); clearCamera(); voice.stop(); setTalk(false); setText(''); setMenu(false); };

  const renderPanel = (m, index) => <View key={index} testID={`chat-panel-${m.panel}`} style={st.panel}>
    <View style={st.panelHeader}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={m.panel === 'camera' ? 'camera-outline' : 'view-dashboard-outline'} size={18} color={T.accent} /><Text style={st.panelTitle}>{PANEL_LABELS[m.panel]}</Text></View><SmallButton icon="close" label={`Close ${m.panel}`} onPress={() => closePanel(index)} /></View>
    {m.panel === 'camera' ? <View style={{ height: 620, maxHeight: 740 }}><CoachScreen openLog={captureSet} initialExercise={m.exercise} /></View>
      : m.panel === 'progress' ? <View style={{ height: 540 }}><ProgressScreen go={go} /></View>
      : m.panel === 'muscles' ? <View style={{ height: 550 }}><MusclesScreen openLog={openLog} openHistory={() => go?.('Progress')} /></View>
      : m.panel === 'plan' ? <View style={{ padding: 16 }}><PlanCard onStart={() => openPanel('camera')} /><ImportSheet proxyUrl={PROXY_URL} proxyKey={PROXY_KEY} onDone={line => push({ kind: 'notice', text: line })} /></View>
      : <View style={{ padding: 16 }}><ImportSheet proxyUrl={PROXY_URL} proxyKey={PROXY_KEY} onDone={line => push({ kind: 'notice', text: line })} /></View>}
  </View>;

  const sidebar = <View style={st.sidebar}>
    <View style={st.brand}><View style={st.brandMark}><JimBars height={23} /></View><Text style={st.brandName}>jim<Text style={{ color: T.accent }}>bro</Text><Text style={{ color: T.textMute }}>.</Text></Text>{!desktop ? <SmallButton icon="close" label="Close menu" onPress={() => setMenu(false)} /> : null}</View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="New chat" onPress={newChat} style={st.newChat}><Icon name="plus" size={19} color={T.accentText} /><Text style={{ color: T.accentText, fontWeight: '600', fontSize: 14 }}>New conversation</Text><Icon name="square-edit-outline" size={17} color={T.accentText} /></TouchableOpacity>
    <Text style={st.sideLabel}>YOUR WORKSPACE</Text>
    {[
      ['message-outline', 'Chat with Jim', () => { setMenu(false); input.current?.focus(); }],
      ['camera-outline', 'Workout studio', () => send('Start a workout')],
      ['chart-line', 'Progress & history', () => send('Review my progress')],
      ['human-handsup', 'Muscle & recovery', () => send('Show my muscles')],
      ['calendar-outline', 'Training plan', () => send('Create a new plan')],
      ['tray-arrow-up', 'Import workouts', () => send('Import my workouts')],
    ].map(([icon, label, action], i) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} key={label} onPress={action} style={[st.navItem, i === 0 && st.navActive]}><Icon name={icon} size={19} color={i === 0 ? T.accentText : T.textMute} /><Text style={[st.navText, i === 0 && { color: T.text }]}>{label}</Text>{i === 0 ? <View style={st.dot} /> : null}</TouchableOpacity>)}
    <View style={st.sideDivider} />
    <Text style={st.sideLabel}>ON YOUR DEVICE</Text>
    <Text style={st.sideInfo}>{history.length} saved workouts{active ? ` · ${active.sets.length} sets today` : ''}</Text>
    <Text style={[st.sideInfo, { marginTop: 12, lineHeight: 20 }]}>Your camera stays private. Your progress stays yours.</Text>
    <View style={{ flex: 1 }} />
    {active ? <TouchableOpacity accessibilityRole="button" onPress={() => send('Finish workout')} style={st.activeSession}><View style={st.dot} /><Text style={{ color: T.accentText, flex: 1, fontSize: 12 }}>Workout in progress</Text><Icon name="stop-circle-outline" size={20} color={T.accentText} /></TouchableOpacity> : null}
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Activity and settings" onPress={openActivity} style={st.profile}><View style={st.avatar}><Icon name="account-outline" color={T.accentText} size={21} /></View><View style={{ flex: 1 }}><Text style={{ color: T.text, fontWeight: '600', fontSize: 13 }}>Your training space</Text><Text style={{ color: T.textMute, fontSize: 11, marginTop: 3 }}>Local storage · {settings.unit}</Text></View><Icon name="cog-outline" size={18} color={T.textMute} /></TouchableOpacity>
  </View>;

  return <KeyboardAvoidingView style={st.workspace} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {desktop ? sidebar : null}
    <View style={st.main}>
      <View style={[st.header, compact && { paddingHorizontal: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {!desktop ? <SmallButton icon="menu" label="Open menu" onPress={() => setMenu(!menu)} /> : <View style={st.headerDot} />}
          <View style={{ flexShrink: 1 }}><Text style={st.headerTitle}>Jim <Text style={{ color: T.textMute, fontWeight: '400' }}> / Your AI gym bro</Text></Text><Text numberOfLines={1} accessibilityLiveRegion="polite" style={st.status}>{status}</Text></View>
        </View>
        <SmallButton icon={talk ? 'volume-high' : 'headphones'} label={talk ? 'Stop talk mode' : 'Start talk mode'} active={talk} onPress={toggleTalk} />
        {!desktop ? <SmallButton icon="square-edit-outline" label="New chat" onPress={newChat} /> : <SmallButton icon="cog-outline" label="Activity and settings" onPress={openActivity} />}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[st.thread, { paddingHorizontal: compact ? 16 : 28 }, !messages.length && { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        {!messages.length ? <View style={st.welcome}>
          <View style={st.heroMark}><JimBars height={40} /><View style={st.heroSpark}><Icon name="star-four-points" color={T.accentText} size={17} /></View></View>
          <Text style={st.eyebrow}>YOUR SPACE TO GET STRONGER</Text>
          <Text style={[st.heroTitle, { fontSize: compact ? 34 : desktop ? 52 : 40, lineHeight: compact ? 42 : desktop ? 62 : 50 }]}>Big goals.{"\n"}<Text style={{ color: T.accentText }}>One conversation.</Text></Text>
          <Text style={st.heroSubtitle}>A coach, a workout partner, a little accountability.{"\n"}Tell me what you’re working toward. We’ll take it from here.</Text>
          <View style={st.quickGrid}>{QUICK.map(q => <TouchableOpacity accessibilityRole="button" accessibilityLabel={q.title} key={q.title} onPress={() => send(q.message)} style={[st.quickCard, { width: compact ? '100%' : '48.8%' }]}><View style={st.quickIcon}><Icon name={q.icon} color={T.accentText} size={21} /></View><View style={{ flex: 1 }}><Text style={st.quickTitle}>{q.title}</Text><Text style={st.quickDetail}>{q.detail}</Text></View><Icon name="arrow-top-right" size={17} color={T.textMute} /></TouchableOpacity>)}</View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${health.text}. Open progress.`} onPress={() => go?.('Progress')} style={st.health}><Icon name="pulse" color={T.accent} size={16} /><Text style={{ color: T.textMute, fontSize: 12, flexShrink: 1 }}>{health.text}</Text></TouchableOpacity>
        </View> : messages.map((m, index) => {
          if (m.kind === 'panel') return renderPanel(m, index);
          if (m.kind === 'tools') return <View key={index} style={st.receipts}>{m.calls.map((c, i) => <View key={i} style={st.receipt}><Icon name={c.status === 'rejected' ? 'close-circle-outline' : c.status === 'proposed' ? 'clock-outline' : 'check-circle-outline'} color={c.status === 'rejected' ? T.amber : T.accent} size={15} /><Text style={st.receiptText}>{TOOL_LABELS[c.name]} · {c.status === 'proposed' ? 'awaiting confirmation' : c.status}</Text></View>)}</View>;
          if (m.kind === 'notice') return <View key={index} style={st.notice}><Icon name="check-circle-outline" color={T.accent} size={16} /><Text style={{ color: T.textDim, fontSize: 13, lineHeight: 20, flex: 1 }}>{m.text}</Text></View>;
          if (m.kind === 'camera-confirm') return <CameraConfirm key={m.confirmationId} message={m} onConfirm={reported => confirmCamera(index, reported)} onCancel={() => cancelCard(index)} />;
          if (m.kind === 'mission') return <MissionCard key={index} mission={m.mission} onStart={() => { if (conversation.getSnapshot().messages[index]?.kind !== 'mission') return; startMission(m.mission); conversation.update(cur => cur.map((item, i) => i === index ? { kind: 'notice', text: 'Mission started. Your workout studio is ready below.' } : item)); openPanel('camera'); }} onCancel={() => cancelCard(index)} />;
          if (m.kind === 'confirm') return <Card key={m.confirmationId} style={st.confirmCard}><Text style={st.eyebrow}>YOUR CALL</Text><Text style={[type.title, { marginTop: 10 }]}>{m.intent.type === 'delete' ? 'Delete this set?' : m.intent.type === 'correct' ? 'Update your set?' : 'Add to your workout?'}</Text><Text style={[type.body, { marginTop: 8 }]}>{m.intent.summary}</Text><Text style={[type.small, { marginTop: 8 }]}>Nothing changes until you confirm. This proposal expires in 5 minutes.</Text><View style={{ flexDirection: 'row', gap: 10 }}><PrimaryButton style={{ flex: 1 }} onPress={() => confirmIntent(index)}>Confirm</PrimaryButton><PrimaryButton secondary style={{ flex: 1 }} onPress={() => cancelCard(index)}>Cancel</PrimaryButton></View></Card>;
          return <View key={index} style={[st.message, m.me && st.userMessage]}>
            {!m.me ? <View style={st.messageAvatar}><JimBars height={18} /></View> : null}
            <View style={[st.messageBody, m.me && st.userBubble, m.safety && { borderLeftColor: T.amber, borderLeftWidth: 2, paddingLeft: 16 }]}>{!m.me ? <Text style={st.messageName}>Jim <Text style={{ color: T.textMute, fontWeight: '400' }}>· your training partner</Text></Text> : null}<Text selectable style={st.messageText}>{m.text}</Text>{m.suggestion ? <TouchableOpacity accessibilityRole="button" onPress={() => send(`Log ${m.suggestion.reps} ${exerciseName(m.suggestion.exercise)} at ${m.suggestion.weight} ${m.suggestion.unit}`)}><Text style={{ color: T.accentText, marginTop: 8 }}>Review suggested set →</Text></TouchableOpacity> : null}</View>
          </View>;
        })}
        {thinking ? <View accessibilityLiveRegion="polite" style={st.thinking}><JimBars height={18} /><Text style={{ color: T.textMute, fontSize: 13 }}>Jim is thinking…</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Stop reply" onPress={() => { conversation.cancel(); voice.stop(); }}><Text style={{ color: T.accentText, padding: 12 }}>Stop reply</Text></TouchableOpacity></View> : null}
        {reason && source === 'offline' && messages.length ? <Text style={[type.small, { marginVertical: 12 }]}>Jim AI is unavailable. This reply uses the offline coach.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: T.amber, marginVertical: 10 }}>{error}</Text> : null}
      </ScrollView>
      <View style={[st.composerArea, { paddingHorizontal: compact ? 12 : 28 }]}>
        <View style={st.composer}>
          <TextInput ref={input} value={text} onChangeText={setText} onSubmitEditing={() => send(text)} onKeyPress={e => { if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.shiftKey && !e.nativeEvent.shiftKey) { e.preventDefault(); send(text); } }} accessibilityLabel="Message Jim" maxLength={2000} multiline blurOnSubmit={false} placeholder={talk ? 'Use your keyboard microphone to talk…' : 'Ask anything about your training…'} placeholderTextColor={T.textMute} style={st.input} />
          <View style={st.composerTools}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><SmallButton icon="plus" label="Import workouts or reference photo" onPress={() => send('Import my workouts')} /><SmallButton icon="camera-outline" label="Open camera in chat" onPress={() => send('Start a workout')} /><SmallButton icon={talk ? 'volume-high' : 'microphone-outline'} label={talk ? 'Stop talk mode' : 'Dictate (use the keyboard microphone)'} active={talk} onPress={toggleTalk} /><View style={st.toolDivider} /><Text style={{ color: T.textMute, fontSize: 11 }}>{talk ? 'Talk mode' : aiOn ? 'Jim AI' : 'On-device coach'}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel={thinking && !text.trim() ? 'Stop reply' : 'Send'} disabled={!thinking && !text.trim()} onPress={() => thinking && !text.trim() ? conversation.cancel() : send(text)} style={[st.send, !thinking && !text.trim() && { opacity: 0.4 }]}><Icon name={thinking && !text.trim() ? 'stop' : 'arrow-up'} size={22} color={T.onAccent} /></TouchableOpacity></View>
        </View>
        <Text style={st.footer}>Video stays on your device. {desktop ? 'Changes to your workout always need your confirmation.' : 'You’re in control.'}</Text>
      </View>
    </View>
    {!desktop && menu ? <View style={st.mobileMenu}>{sidebar}</View> : null}
  </KeyboardAvoidingView>;
}

const st = StyleSheet.create({
  workspace: { flex: 1, flexDirection: 'row', backgroundColor: '#151a18' },
  sidebar: { width: 252, backgroundColor: '#101512', paddingHorizontal: 18, paddingTop: 28, borderRightWidth: 1, borderRightColor: '#28302b', flexShrink: 0 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginBottom: 32 },
  brandMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#253e34', alignItems: 'center', justifyContent: 'center' },
  brandName: { color: T.text, fontSize: 25, fontWeight: '700', letterSpacing: -1, flex: 1 },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 46, borderWidth: 1, borderColor: '#365647', backgroundColor: '#1b2e25', borderRadius: 10, paddingHorizontal: 12, marginBottom: 32 },
  sideLabel: { color: '#80958a', fontSize: 10, fontWeight: '600', letterSpacing: 1.5, marginLeft: 12, marginBottom: 14 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  navActive: { backgroundColor: '#232e27' },
  navText: { color: '#a9b7ae', fontSize: 13, flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },
  sideDivider: { height: 1, backgroundColor: '#29312c', marginHorizontal: 10, marginTop: 24, marginBottom: 26 },
  sideInfo: { color: '#83998b', fontSize: 12, paddingHorizontal: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#29312c', paddingVertical: 22, marginTop: 16 },
  avatar: { width: 34, height: 34, borderRadius: 18, backgroundColor: '#2c3a30', alignItems: 'center', justifyContent: 'center' },
  activeSession: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, backgroundColor: '#20382c', borderRadius: 10 },
  main: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 30, minHeight: 79, borderBottomWidth: 1, borderBottomColor: '#29312c' },
  headerDot: { width: 7, height: 7, backgroundColor: T.accent, borderRadius: 4 },
  headerTitle: { color: '#f3f5ee', fontWeight: '600', fontSize: 14 },
  status: { color: '#9aaca1', fontSize: 11, marginTop: 5 },
  smallButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flexShrink: 0 },
  thread: { flexGrow: 1, width: '100%', maxWidth: 870, alignSelf: 'center', paddingTop: 28, paddingBottom: 30 },
  welcome: { alignItems: 'center', paddingVertical: 22 },
  heroMark: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center', borderRadius: 25, borderWidth: 1, borderColor: '#3c5949', backgroundColor: '#243d30', marginBottom: 28, transform: [{ rotate: '-5deg' }] },
  heroSpark: { position: 'absolute', right: -8, top: -8, width: 26, height: 26, backgroundColor: '#151a18', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#9caf9e', fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  heroTitle: { color: '#f2f3e9', textAlign: 'center', fontFamily: Platform.OS === 'web' ? 'Georgia, serif' : undefined, fontWeight: '400', letterSpacing: -1.5, marginTop: 16 },
  heroSubtitle: { color: '#a5b4a9', fontSize: 14, lineHeight: 23, textAlign: 'center', marginTop: 18, maxWidth: 480 },
  quickGrid: { width: '100%', maxWidth: 660, flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 34 },
  quickCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderWidth: 1, borderColor: '#354136', borderRadius: 13, backgroundColor: '#1d2620', minHeight: 86 },
  quickIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#2a3a2e', alignItems: 'center', justifyContent: 'center' },
  quickTitle: { color: '#e5ece3', fontSize: 13, fontWeight: '600' },
  quickDetail: { color: '#9aab9c', fontSize: 11, marginTop: 6, lineHeight: 15 },
  health: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, marginTop: 18, minHeight: 44 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 25 },
  userMessage: { justifyContent: 'flex-end', marginTop: 16 },
  messageAvatar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#2a4031' },
  messageBody: { flexShrink: 1, paddingTop: 3, maxWidth: '93%' },
  messageName: { color: T.text, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  messageText: { color: '#e0e7df', fontSize: 15, lineHeight: 25 },
  userBubble: { backgroundColor: '#2a382d', borderRadius: 16, paddingVertical: 11, paddingHorizontal: 18, maxWidth: '86%' },
  receipts: { marginTop: 20, gap: 6, alignItems: 'flex-start' },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#1d2a21', borderWidth: 1, borderColor: '#344438', borderRadius: 8, maxWidth: '100%' },
  receiptText: { color: '#b9cbbb', fontSize: 11, flexShrink: 1, lineHeight: 17 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, padding: 12, backgroundColor: '#1e2d23', borderRadius: 10 },
  confirmCard: { marginTop: 18, borderColor: '#53775e', backgroundColor: '#202f24' },
  panel: { marginTop: 20, borderWidth: 1, borderColor: '#3a4c3f', borderRadius: 16, overflow: 'hidden', backgroundColor: T.bg },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 7, minHeight: 49, borderBottomWidth: 1, borderBottomColor: '#344438', backgroundColor: '#223128' },
  panelTitle: { color: '#d1e6d4', fontSize: 13, fontWeight: '600' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20 },
  composerArea: { width: '100%', maxWidth: 870, alignSelf: 'center', paddingTop: 8, paddingBottom: 12 },
  composer: { backgroundColor: '#202a22', borderWidth: 1, borderColor: '#465647', borderRadius: 20, padding: 10 },
  input: { color: '#edf3e9', fontSize: 14, lineHeight: 22, padding: 9, minHeight: 48, maxHeight: 120, outlineStyle: 'none' },
  composerTools: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolDivider: { width: 1, height: 14, backgroundColor: '#485548', marginHorizontal: 7 },
  send: { width: 36, height: 36, borderRadius: 12, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', marginRight: 3 },
  footer: { color: '#899b8b', fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  mobileMenu: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 270, backgroundColor: '#101512', zIndex: 10, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, elevation: 10 },
});
