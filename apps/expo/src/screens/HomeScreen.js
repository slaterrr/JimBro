import Constants from 'expo-constants';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { newId, useApp, useLiveCamera } from '../AppState.js';
import { PlanCard } from '../components/ChatPlanCard.js';
import { ImportSheet } from '../components/ImportSheet.js';
import { MissionCard } from '../components/Mission.js';
import { IntakeCard, ProgramCard, SessionCard, SwapCard } from '../components/ProgramCards.js';
import { Card, Field, Icon, IconButton, JimBars, PrimaryButton } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { askJim, checkProxy, historyFor, proxyKey, proxyUrl, validateProposal } from '../lib/jimAI.js';
import { confirmedText, missionIntro } from '../lib/homeReplies.js';
import { proxyStatusLine } from '../lib/aiStatus.js';
import { healthSummary } from '../lib/healthSummary.js';
import { nextWorkout } from '../lib/homeActions.js';
import { parseMission, planMission } from '../lib/mission.js';
import { answerContext } from '../lib/coachQA.js';
import { answerPerformance } from '../lib/perfCoach.js';
import { SAFETY, SAFETY_TEXT } from '../lib/coach.js';
import { chatAction } from '../lib/chatActions.js';
import { answerIntake, buildProgram, INTAKE_FIELDS, nextQuestion, programToPlan, sessionPlanned, swapExercise, validateProgram } from '../lib/program.js';
import { programQuery, startProgramChat } from '../lib/programChat.js';
import { CoachScreen } from './CoachScreen.js';
import { MusclesScreen } from './MusclesScreen.js';
import { ProgressScreen } from './ProgressScreen.js';
import { ProgramScreen } from './ProgramScreen.js';
import { TrainingScreen } from './TrainingScreen.js';
import { TodayCard } from '../components/TodayCard.js';
import { WorkoutChecklist } from '../components/WorkoutChecklist.js';
import { T, type } from '../theme.js';

const PROXY_URL = proxyUrl({ EXPO_PUBLIC_JIM_PROXY_URL: process.env.EXPO_PUBLIC_JIM_PROXY_URL }, Constants.expoConfig?.extra);
const PROXY_KEY = proxyKey({ EXPO_PUBLIC_JIM_PROXY_KEY: process.env.EXPO_PUBLIC_JIM_PROXY_KEY }, Constants.expoConfig?.extra);
const PANEL_LABELS = { camera: 'Workout studio', progress: 'Your progress', muscles: 'Muscle & recovery map', plan: 'Your training plan', import: 'Import & reference photo' };
const TOOL_LABELS = { get_recent_sets: 'Read workout history', get_live_session: 'Read measured camera reps', get_workout_context: 'Read your workout', get_goal_progress: 'Check your goals', get_weekly_checkin: 'Review your week', get_last_set_report: 'Read your set report', log_sets: 'Propose logging a set', correct_set: 'Propose a correction', delete_set: 'Propose deleting a set', show_panel: 'Open a chat tool', build_program: 'Build and check a program', get_program: 'Read your program' };
const QUICK = [
  { icon: 'camera-outline', title: 'Start a workout', detail: 'Your camera. Every rep.', message: 'Start a workout' },
  { icon: 'creation', title: 'Build my program', detail: 'A multi-week plan that fits your life.', message: 'Build me a training program' },
  { icon: 'chart-line', title: 'Review my progress', detail: 'Find your next small win.', message: 'Review my progress' },
  { icon: 'timer-outline', title: 'I have 20 minutes', detail: 'Make the most of today.', message: 'I have 20 minutes, help me train arms' },
];

const intakeLabel = (field, value) => (Array.isArray(value) ? value : [value]).map((v) => field.options.find(([id]) => id === v)?.[1] ?? String(v)).join(', ');

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
  const { settings, voice, logSet, updateSet, deleteSet, startWorkout, finishWorkout, endMission, active, history, goals, plan, savePlan, startMission, conversation } = app;
  const { snapshot: liveCamera, clear: clearCamera } = useLiveCamera();
  const { messages, busy: thinking, source, reason, error } = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [text, setText] = useState('');
  const [page, updatePage] = useState(null);
  const pageTrail = useRef([]);
  const setPage = next => {
    voice.stop();
    if (next === null) { updatePage(pageTrail.current.pop() ?? null); return; }
    if (next !== page) pageTrail.current.push(page);
    updatePage(next);
  };
  const backArrow = <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to previous page" onPress={() => setPage(null)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={T.text} /></TouchableOpacity>;
  const [progressGroup, setProgressGroup] = useState(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraExercise, setCameraExercise] = useState(null);
  const [menu, setMenu] = useState(false);
  const [focused, setFocused] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const compact = width < 400;
  const scroll = useRef(null);
  const input = useRef(null);
  const mounted = useRef(true);
  const [proxy, setProxy] = useState(PROXY_URL ? 'checking' : 'offline');
  const health = healthSummary({ history, active, goals, plan });
  const aiOn = source === 'ai' || (proxy === 'ok' && source !== 'offline');
  const status = thinking ? 'Working on it…' : source === 'ai' ? 'Connected to Jim AI' : source === 'local' ? 'Answered from your workout data' : proxyStatusLine({ configured: Boolean(PROXY_URL), state: proxy }, source);

  useEffect(() => {
    if (!PROXY_URL) return undefined;
    let alive = true;
    checkProxy({ url: PROXY_URL, key: PROXY_KEY }).then(r => { if (alive) setProxy(r.ok ? 'ok' : 'offline'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (messages.length) scroll.current?.scrollToEnd({ animated: true }); }, [messages, thinking]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; voice.stop(); }; }, [voice]);

  const push = (...items) => conversation.update(cur => [...cur, ...items]);
  const closePanel = index => { if (conversation.getSnapshot().messages[index]?.panel === 'camera') clearCamera(); conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: `${PANEL_LABELS[m.panel] ?? 'Tool'} closed.` } : m)); };
  const openPanel = (panel, exercise, options = {}) => {
    if (panel === 'camera') { setCameraExercise(exercise ?? null); setCameraEnabled(false); setPage('workout-choice'); return; }
    if (panel === 'progress') { setProgressGroup(options.muscleGroup ?? null); setPage('progress'); return; }
    if (panel === 'muscles') { setPage('muscles'); return; }
    // Keep just one live camera mounted. Closing it releases the camera stream.
    conversation.update(cur => [...cur.map(m => m.kind === 'panel' && m.panel === panel ? { kind: 'notice', text: `${PANEL_LABELS[panel]} reopened below.` } : m), { kind: 'panel', panel, ...options, ...(exercise ? { exercise } : {}) }]);
    setMenu(false);
  };
  const go = screen => openPanel({ Coach: 'camera', Progress: 'progress', Muscles: 'muscles' }[screen] ?? 'progress');

  const confirmIntent = (index) => {
    const card = conversation.getSnapshot().messages[index];
    if (card?.intent?.type === 'log' && !active) return;
    const intent = conversation.claimConfirmation(index, p => Boolean(validateProposal(p, { history, active })) && (p.type !== 'log' || card.workoutId === active?.id));
    if (!intent) return;
    if (intent.type === 'log') intent.sets.forEach(x => logSet({ ...x, rpe: x.rpe ?? null, source: 'voice', reps_detail: [] }, 'Logged with Jim'));
    else if (intent.type === 'correct') updateSet(intent.target.setId, intent.changes);
    else deleteSet(intent.target.setId);
    const reply = confirmedText(intent, settings.persona);
    conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: reply } : m));
  };
  const cancelCard = index => conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: 'Cancelled. Your workout data was not changed.' } : m));
  const captureSet = (initial, camera) => {
    if (!camera?.reps.length) {
      push({ me: false, text: 'No completed camera reps to save yet. You can also tell me your exercise, reps and weight to log a set manually.' });
      return;
    }
    push({ kind: 'camera-confirm', camera, workoutId: active?.id ?? null });
  };
  const confirmCamera = (index, reported) => {
    const captured = conversation.claimConfirmation(index, m => m.camera?.reps.length > 0 && Boolean(active) && m.workoutId === active.id);
    if (!captured) return;
    const c = captured.camera;
    const saved = logSet({ exercise: c.movement, reps: c.reps.length, weight: reported.weight, unit: settings.unit, rpe: reported.rpe, source: 'camera', reps_detail: c.reps, camera_quality: c.quality, target: c.target, clips: c.clips });
    if (!saved) return;
    conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: `Saved ${c.reps.length} measured reps of ${exerciseName(c.movement)}. Added weight and effort are user-reported.` } : m));
  };

  // ---------- multi-week programs (lib/program.js): intake -> checked program card -> confirm ----------
  const programTurn = (intake, question, first = false) => {
    if (question) {
      const text = `${first ? "Let's build your program. I'll ask a few quick questions; your logged sets set the starting loads. " : ''}${question.question}`;
      return { reply: question.question, messages: [{ me: false, text }, { kind: 'program-intake', intake, field: question.id }] };
    }
    const program = buildProgram(intake, { history, unit: settings.unit, id: `program-${newId()}`, now: new Date().toISOString() });
    const problems = validateProgram(program, program.intake, { history });
    if (problems.length) return { reply: `I couldn't build a program that passes my checks (${problems[0]}). Nothing was saved.`, messages: [{ kind: 'tools', calls: [{ name: 'build_program', status: 'rejected' }] }, { me: false, text: `I couldn't build a program that passes my checks (${problems[0]}). Nothing was saved.` }] };
    const fromHistory = program.weeks[0].sessions.flatMap((x) => x.items).filter((i) => i.load.from).length;
    const reply = `Here's your ${program.name}. Week 1 is open below; tap any week or day to see it. ${fromHistory ? `${fromHistory} starting loads come from your logged sets; the rest are set by effort.` : 'You have no logged sets for these lifts yet, so starting loads are set by effort, not guessed.'} Nothing is saved until you confirm.`;
    return { reply, messages: [{ kind: 'tools', calls: [{ name: 'build_program', status: 'completed' }] }, { me: false, text: reply }, { kind: 'program', program }] };
  };
  const answerProgram = (index, message) => {
    const card = conversation.getSnapshot().messages[index];
    const r = answerIntake(card.intake, card.field, message);
    if (!r.ok) {
      conversation.update(cur => cur.filter((_, i) => i !== index));
      const text = `${r.error} Or say "cancel" to stop building.`;
      return { reply: text, messages: [{ me: false, text }, { kind: 'program-intake', intake: card.intake, field: card.field }] };
    }
    conversation.update(cur => cur.filter((_, i) => i !== index));
    return programTurn(r.intake, nextQuestion(r.intake));
  };
  const programAnswer = q => {
    const tools = { kind: 'tools', calls: [{ name: 'get_program', status: 'completed' }] };
    const text = { me: false, text: q.reply };
    if (q.type === 'today' && q.session) return [tools, text];
    if (q.type === 'shorter' && q.session) return [tools, text, { kind: 'session', session: q.session, name: q.name, week: q.week, short: true }];
    if (q.type === 'swap' && q.options.length) return [tools, text, { kind: 'swap', from: q.from, options: q.options, fromWeek: q.fromWeek }];
    return [tools, text];
  };
  const saveProgram = index => {
    const card = conversation.claimConfirmation(index, m => validateProgram(m.program, m.program.intake, { history }).length === 0);
    if (!card) return;
    const replaced = Boolean(plan);
    // Keep the weekly schedule when the same program gets a new version (a swap); otherwise start one.
    const keep = plan?.schedule && plan.schedule.programId === card.program.id;
    savePlan({ ...programToPlan(card.program), schedule: keep ? plan.schedule : app.createDefaultSchedule(card.program) });
    const line = `Saved ${card.program.name} (version ${card.program.version}).${replaced ? ' Your previous plan is kept in plan history.' : ''} Say "Start workout" when you're ready.`;
    conversation.update(cur => cur.map((m, i) => i === index ? { kind: 'notice', text: line } : m));
  };
  const startSession = index => {
    const m = conversation.getSnapshot().messages[index];
    if (m?.kind !== 'session' || active || !plan?.program) return;
    startWorkout(m.name, sessionPlanned(plan.program, m.session, m.week));
    conversation.update(cur => cur.map((item, i) => i === index ? { kind: 'notice', text: `${m.name} started. Your workout studio is ready below.` } : item));
    openPanel('camera');
  };
  const pickSwap = (index, to) => {
    const m = conversation.getSnapshot().messages[index];
    if (m?.kind !== 'swap' || !plan?.program) return;
    const r = swapExercise(plan.program, { from: m.from, to, fromWeek: m.fromWeek });
    conversation.update(cur => [...cur.map((item, i) => i === index ? { kind: 'notice', text: `Swap chosen: ${exerciseName(m.from)} → ${exerciseName(to)}.` } : item),
      ...(r.error ? [{ me: false, text: `${r.error} Your program was not changed.` }]
        : [{ kind: 'program', program: r.program, mode: 'swap', summary: `${exerciseName(m.from)} → ${exerciseName(to)} from week ${m.fromWeek} (${r.count} sessions). Starting loads for the new exercise are set by effort.` }])]);
  };

  // Dashboard: start the scheduled session for today (or the next one) with sets pre-filled.
  const startToday = () => {
    if (!active) { const next = nextWorkout(plan, history); startWorkout(next.name, next.planned); }
    setCameraExercise(null); setCameraEnabled(false); setPage('workout');
  };

  const send = async raw => {
    const message = raw.trim();
    if (!message) return;
    if (/^(start (a |my |the )?workout)[.!]?$/i.test(message)) {
      setText(''); setMenu(false); setCameraExercise(null); setCameraEnabled(false); setPage('workout-choice'); return;
    }
    if (/^(review my progress|show progress|open progress)[.!]?$/i.test(message)) {
      setText(''); setMenu(false); setProgressGroup(null); setPage('progress'); return;
    }
    if (/^(muscles|show muscles|open muscles|muscle map)[.!]?$/i.test(message)) { setText(''); setMenu(false); setPage('muscles'); return; }
    if (/^((show|open) (my )?)?(calendar|attendance|analytics|training calendar)[.!?]?$|^export( my workouts)?( to)? excel[.!?]?$/i.test(message)) { setText(''); setMenu(false); setPage('training'); return; }
    if (/^start today'?s workout[.!]?$/i.test(message)) { setText(''); setMenu(false); startToday(); return; }
    if (/^(training program|open (my )?program)[.!]?$/i.test(message) && plan) {
      setText(''); setMenu(false); setPage('program'); return;
    }
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
        finishWorkout(); endMission(); clearCamera();
        conversation.update(cur => cur.map(m => m.kind === 'panel' && m.panel === 'camera' ? { kind: 'notice', text: 'Camera stopped.' } : m));
        return { source: 'local', reply: active?.sets.length ? `Workout finished. ${active.sets.length} saved sets are in your history.` : 'Workout finished. No sets were saved.', actions: [{ type: 'show_panel', panel: 'progress' }] };
      }
      if (/\bhow many reps\b/i.test(message) && liveCamera?.sessionId === active?.id && Date.now() - new Date(liveCamera.updatedAt).getTime() < 300000) {
        return { source: 'local', reply: `The camera has counted ${liveCamera.reps} reps of ${exerciseName(liveCamera.exercise)} in this set. These are measured on your device and are not saved until you confirm.`, toolCalls: [{ name: 'get_live_session', status: 'completed' }] };
      }
      // An open program question takes the typed answer first.
      const intakeIndex = conversation.getSnapshot().messages.findLastIndex(m => m.kind === 'program-intake');
      if (intakeIndex >= 0) {
        if (/^(cancel|stop building|never ?mind|forget it)[.!]?$/i.test(message)) {
          conversation.update(cur => cur.filter((_, i) => i !== intakeIndex));
          return { source: 'local', reply: 'Okay, I stopped building the program. Nothing was saved.' };
        }
        return { source: 'local', ...answerProgram(intakeIndex, message) };
      }
      const pq = programQuery(message, { plan, history, active });
      if (pq) return { source: 'local', reply: pq.reply, messages: programAnswer(pq) };
      const started = startProgramChat(message, { settings });
      if (started) return { source: 'local', ...programTurn(started.intake, started.question, true) };
      const ask = parseMission(message);
      if (ask.recognized) {
        const mission = planMission({ minutes: ask.minutes, focus: ask.focus, history, settings, now: new Date() });
        const intro = missionIntro(mission, { hasHistory: history.length > 0, persona: settings.persona });
        return { source: 'local', reply: intro, messages: [{ me: false, text: intro }, { kind: 'mission', mission }] };
      }
      const action = chatAction(message);
      if (action) {
        if (['camera', 'progress', 'muscles'].includes(action.panel)) {
          openPanel(action.panel, action.exercise);
          return { source: 'local', reply: action.panel === 'camera' ? 'Choose camera tracking or manual logging to start your workout.' : `Opened ${PANEL_LABELS[action.panel]}.`, proposals: [] };
        }
        return { source: 'local', reply: action.panel === 'camera' ? 'Let’s get moving. Allow your camera below and keep your body in frame. Video stays on this device; only your rep measurements are saved when you confirm.' : `Here’s ${PANEL_LABELS[action.panel].toLowerCase()}, right here in our conversation.`, actions: [action], toolCalls: [{ name: 'show_panel', status: 'completed' }] };
      }
      const mutation = /\b(log|save|correct|change|delete|remove|fix)\b/i.test(message);
      const answer = mutation ? null : answerPerformance(message, { history, active }) ?? answerContext(message, { history, active, plan, settings, profile: settings.profile ?? {} });
      if (answer) return { source: 'local', reply: answer, proposals: [], toolCalls: [{ name: 'get_workout_context', status: 'completed' }] };
      const response = await askJim({ message, history: historyFor(prior), state, url: PROXY_URL, key: PROXY_KEY });
      const navigation = response.actions?.find(a => ['camera', 'progress', 'muscles'].includes(a.panel));
      if (navigation) {
        openPanel(navigation.panel, navigation.exercise);
        return { ...response, actions: response.actions.filter(a => !['camera', 'progress', 'muscles'].includes(a.panel)), workoutId: active?.id ?? null };
      }
      return { ...response, workoutId: active?.id ?? null };
    });
    // Model-triggered panels use the same renderer and camera lifecycle as local actions.
    if (result?.actions?.some(a => a.panel === 'camera')) {
      const current = conversation.getSnapshot().messages;
      const latest = current.findLastIndex(m => m.kind === 'panel' && m.panel === 'camera');
      conversation.update(cur => cur.map((m, i) => m.kind === 'panel' && m.panel === 'camera' && i !== latest ? { kind: 'notice', text: 'Camera reopened below.' } : m));
    }
  };
  const newChat = () => { conversation.clear(); clearCamera(); voice.stop(); setText(''); setMenu(false); };

  const renderPanel = (m, index) => <View key={index} testID={`chat-panel-${m.panel}`} style={st.panel}>
    <View style={st.panelHeader}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={m.panel === 'camera' ? 'camera-outline' : 'view-dashboard-outline'} size={18} color={T.accent} /><Text style={st.panelTitle}>{PANEL_LABELS[m.panel]}</Text></View><SmallButton icon="close" label={`Close ${m.panel}`} onPress={() => closePanel(index)} /></View>
    {m.panel === 'camera' ? <View style={{ height: 620, maxHeight: 740 }}><CoachScreen openLog={captureSet} initialExercise={m.exercise} /></View>
      : m.panel === 'progress' ? <View style={{ height: 540 }}><ProgressScreen go={go} muscleGroup={m.muscleGroup} onClearMuscle={() => conversation.update(cur => cur.map((item, i) => i === index ? { ...item, muscleGroup: null } : item))} /></View>
      : m.panel === 'muscles' ? <View style={{ height: 550 }}><MusclesScreen openProgress={group => openPanel('progress', undefined, { muscleGroup: group })} openHistory={() => go?.('Progress')} /></View>
      : m.panel === 'plan' ? <View style={{ padding: 16 }}><PlanCard proxyUrl={PROXY_URL} proxyKey={PROXY_KEY} onStart={() => openPanel('camera')} /><ImportSheet proxyUrl={PROXY_URL} proxyKey={PROXY_KEY} onDone={line => push({ kind: 'notice', text: line })} /></View>
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
      ['calendar-outline', 'Training program', () => plan ? setPage('program') : send('Build me a training program')],
      ['calendar-check-outline', 'Calendar & analytics', () => { setMenu(false); setPage('training'); }],
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

  if (page === 'training') return <TrainingScreen onBack={() => setPage(null)} />;
  if (page === 'program') return <ProgramScreen plan={plan} onBack={() => setPage(null)} />;
  if (page === 'progress') return <View style={{ flex: 1 }}>{backArrow}<ProgressScreen go={() => setPage(null)} muscleGroup={progressGroup} onClearMuscle={() => setProgressGroup(null)} /></View>;
  if (page === 'muscles') return <View style={{ flex: 1 }}>{backArrow}<MusclesScreen openHistory={() => { setProgressGroup(null); setPage('progress'); }} openProgress={group => { setProgressGroup(group); setPage('progress'); }} /></View>;
  if (page === 'workout-choice') return <ScrollView contentContainerStyle={{ padding: 20 }}>
    {backArrow}
    <Text style={[type.h1, { marginTop: 20 }]}>Start workout</Text>
    <Text style={type.body}>Choose how you want to record your sets.</Text>
    <PrimaryButton onPress={() => { if (!active) { const next = nextWorkout(plan, history); startWorkout(next.name, next.planned); } setCameraEnabled(true); setPage('workout'); }}>Use camera</PrimaryButton>
    <PrimaryButton secondary onPress={() => { if (!active) { const next = nextWorkout(plan, history); startWorkout(next.name, next.planned); } setCameraEnabled(false); setPage('workout'); }}>Without camera</PrimaryButton>
  </ScrollView>;
  if (page === 'workout') return <View style={{ flex: 1 }}>
    {backArrow}
    {cameraEnabled ? <CoachScreen openLog={openLog} initialExercise={cameraExercise} /> : <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 48, maxWidth: 760, width: "100%", alignSelf: "center" }}>
      <Text style={type.h1}>{active?.name ?? 'Workout'}</Text>
      <Text style={[type.body, { marginBottom: 12 }]}>Camera is off. Tick each set as you finish it.</Text>
      <WorkoutChecklist />
      <PrimaryButton secondary disabled={!active} onPress={() => openLog()}>Log another set</PrimaryButton>
      <PrimaryButton secondary onPress={() => setCameraEnabled(true)}>Use camera instead</PrimaryButton>
      <PrimaryButton secondary onPress={() => { finishWorkout(); endMission(); setPage(null); }}>Finish workout</PrimaryButton>
    </ScrollView>}
  </View>;
  return <KeyboardAvoidingView style={st.workspace} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {desktop ? sidebar : null}
    <View style={st.main}>
      <View style={[st.header, compact && { paddingHorizontal: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          {!desktop ? <SmallButton icon="menu" label="Open menu" onPress={() => setMenu(!menu)} /> : <View style={st.headerDot} />}
          <View style={{ flexShrink: 1 }}><Text style={st.headerTitle}>Jim </Text><Text numberOfLines={1} accessibilityLiveRegion="polite" style={st.status}>{status}</Text></View>
        </View>
                {!desktop ? <SmallButton icon="square-edit-outline" label="New chat" onPress={newChat} /> : <SmallButton icon="cog-outline" label="Activity and settings" onPress={openActivity} />}
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={[st.thread, { paddingHorizontal: compact ? 16 : 28 }, !messages.length && { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        {!messages.length ? <View style={st.welcome}>
          <Image source={require('../../assets/jim-home.png')} accessibilityLabel="Blue Jim holding a barbell" resizeMode="contain" style={st.mascot} />

          <Text style={[st.heroTitle, { fontSize: compact ? 34 : desktop ? 52 : 40, lineHeight: compact ? 42 : desktop ? 62 : 50 }]}>Hey, I'm Jim</Text>
          <Text testID="welcome-greeting" style={st.heroSubtitle}>Your AI gym bro. Tell me what you want to hit today</Text>
          <Text style={[st.quickDetail, { textAlign: 'center', maxWidth: 480, marginTop: 12 }]}>Type a message, or use your iPhone keyboard's dictation button.</Text>
          <TodayCard onStart={startToday} onOpenTraining={() => setPage('training')} onBuild={() => send('Build me a training program')} />
          <View style={st.quickGrid}>{QUICK.map(q => <TouchableOpacity accessibilityRole="button" accessibilityLabel={q.title} key={q.title} onPress={() => send(q.message)} style={[st.quickCard, { width: '48%' }]}><View style={st.quickIcon}><Icon name={q.icon} color={T.accentText} size={21} /></View><View style={{ flex: 1 }}><Text style={st.quickTitle}>{q.title}</Text><Text style={st.quickDetail}>{q.detail}</Text></View><Icon name="arrow-top-right" size={17} color={T.textMute} /></TouchableOpacity>)}</View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${health.text}. Open progress.`} onPress={() => go?.('Progress')} style={st.health}><Icon name="pulse" color={T.accent} size={16} /><Text style={{ color: T.textMute, fontSize: 12, flexShrink: 1 }}>{health.text}</Text></TouchableOpacity>
        </View> : messages.map((m, index) => {
          if (m.kind === 'panel') return renderPanel(m, index);
          if (m.kind === 'tools') return <View key={index} style={st.receipts}>{m.calls.map((c, i) => <View key={i} style={st.receipt}><Icon name={c.status === 'rejected' ? 'close-circle-outline' : c.status === 'proposed' ? 'clock-outline' : 'check-circle-outline'} color={c.status === 'rejected' ? T.amber : T.accent} size={15} /><Text style={st.receiptText}>{TOOL_LABELS[c.name]} · {c.status === 'proposed' ? 'awaiting confirmation' : c.status}</Text></View>)}</View>;
          if (m.kind === 'notice') return <View key={index} style={st.notice}><Icon name="check-circle-outline" color={T.accent} size={16} /><Text style={{ color: T.textDim, fontSize: 13, lineHeight: 20, flex: 1 }}>{m.text}</Text></View>;
          if (m.kind === 'camera-confirm') return <CameraConfirm key={m.confirmationId} message={m} onConfirm={reported => confirmCamera(index, reported)} onCancel={() => cancelCard(index)} />;
          if (m.kind === 'program-intake') { const field = INTAKE_FIELDS.find(f => f.id === m.field); return <IntakeCard key={`intake-${index}`} field={field} onAnswer={v => send(intakeLabel(field, v))} onCancel={() => send('cancel')} />; }
          if (m.kind === 'program') return <ProgramCard key={m.confirmationId} message={m} currentPlan={plan} onSave={() => saveProgram(index)} onCancel={() => conversation.update(cur => cur.map((x, i) => i === index ? { kind: 'notice', text: 'Cancelled. Your plan was not changed.' } : x))} />;
          if (m.kind === 'session') return <SessionCard key={index} message={m} disabledReason={active ? 'Finish your current workout before starting this one.' : null} onStart={() => startSession(index)} />;
          if (m.kind === 'swap') return <SwapCard key={index} message={m} onPick={to => pickSwap(index, to)} onCancel={() => conversation.update(cur => cur.map((x, i) => i === index ? { kind: 'notice', text: `Kept ${exerciseName(m.from)}. Your program was not changed.` } : x))} />;
          if (m.kind === 'mission') return <MissionCard key={index} mission={m.mission} onStart={() => { if (conversation.getSnapshot().messages[index]?.kind !== 'mission') return; startMission(m.mission); conversation.update(cur => cur.map((item, i) => i === index ? { kind: 'notice', text: 'Mission started. Your workout studio is ready below.' } : item)); openPanel('camera'); }} onCancel={() => cancelCard(index)} />;
          if (m.kind === 'confirm') return <Card key={m.confirmationId} style={st.confirmCard}><Text style={st.eyebrow}>YOUR CALL</Text><Text style={[type.title, { marginTop: 10 }]}>{m.intent.type === 'delete' ? 'Delete this set?' : m.intent.type === 'correct' ? 'Update your set?' : 'Add to your workout?'}</Text><Text style={[type.body, { marginTop: 8 }]}>{m.intent.summary}</Text><Text style={[type.small, { marginTop: 8 }]}>{m.intent.type === 'log' && !active ? 'Start a workout, then ask Jim to log these sets again. ' : ''}Nothing changes until you confirm. This proposal expires in 5 minutes.</Text><View style={{ flexDirection: 'row', gap: 10 }}><PrimaryButton style={{ flex: 1 }} disabled={m.intent.type === 'log' && !active} onPress={() => confirmIntent(index)}>Confirm</PrimaryButton><PrimaryButton secondary style={{ flex: 1 }} onPress={() => cancelCard(index)}>Cancel</PrimaryButton></View></Card>;
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
        <View style={[st.composer, focused && { borderColor: T.accent }]}>
          <TextInput ref={input} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} value={text} onChangeText={v => { if (!text && v) voice.stop(); setText(v); }} onSubmitEditing={() => send(text)} onKeyPress={e => { if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.shiftKey && !e.nativeEvent.shiftKey) { e.preventDefault(); send(text); } }} accessibilityLabel="Message Jim" maxLength={2000} multiline blurOnSubmit={false} placeholder="Ask anything about your training…" placeholderTextColor={T.textMute} style={st.input} />
          <View style={st.composerTools}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><SmallButton icon="plus" label="Import workouts or reference photo" onPress={() => send('Import my workouts')} /><SmallButton icon="camera-outline" label="Open camera in chat" onPress={() => send('Start a workout')} /><View style={st.toolDivider} /><Text style={{ color: T.textMute, fontSize: 11 }}>{aiOn ? 'Jim AI' : 'On-device coach'}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel={thinking && !text.trim() ? 'Stop reply' : 'Send'} disabled={!thinking && !text.trim()} onPress={() => thinking && !text.trim() ? conversation.cancel() : send(text)} style={[st.send, !thinking && !text.trim() && { opacity: 0.4 }]}><Icon name={thinking && !text.trim() ? 'stop' : 'arrow-up'} size={22} color={T.onAccent} /></TouchableOpacity></View>
        </View>
        <Text style={st.reviewLabel}>Review prototype · Muse-inspired layout interpretation</Text>
        <Text style={st.footer}>Video stays on your device. {desktop ? 'Changes to your workout always need your confirmation.' : 'You’re in control.'}</Text>
      </View>
    </View>
    {!desktop && menu ? <View style={st.mobileMenu}>{sidebar}</View> : null}
  </KeyboardAvoidingView>;
}

const st = StyleSheet.create({
  workspace: { flex: 1, flexDirection: 'row', backgroundColor: T.chat.background },
  sidebar: { width: 252, backgroundColor: T.chat.sidebar, paddingHorizontal: 18, paddingTop: 28, borderRightWidth: 1, borderRightColor: T.border, flexShrink: 0 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginBottom: 32 },
  brandMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: T.chat.tinted, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: T.text, fontSize: 25, fontWeight: '700', letterSpacing: -1, flex: 1 },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 46, borderWidth: 1, borderColor: T.chat.accentBorder, backgroundColor: T.chat.tinted, borderRadius: 10, paddingHorizontal: 12, marginBottom: 32 },
  sideLabel: { color: T.textMute, fontSize: 10, fontWeight: '600', letterSpacing: 1.5, marginLeft: 12, marginBottom: 14 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  navActive: { backgroundColor: T.chat.selected },
  navText: { color: T.textDim, fontSize: 13, flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },
  sideDivider: { height: 1, backgroundColor: T.border, marginHorizontal: 10, marginTop: 24, marginBottom: 26 },
  sideInfo: { color: T.textMute, fontSize: 12, paddingHorizontal: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: T.border, paddingVertical: 22, marginTop: 16 },
  avatar: { width: 34, height: 34, borderRadius: 18, backgroundColor: T.chat.selected, alignItems: 'center', justifyContent: 'center' },
  activeSession: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, backgroundColor: T.chat.tinted, borderRadius: 10 },
  main: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 30, minHeight: 79, borderBottomWidth: 1, borderBottomColor: T.border },
  headerDot: { width: 7, height: 7, backgroundColor: T.accent, borderRadius: 4 },
  headerTitle: { color: T.text, fontWeight: '600', fontSize: 14 },
  status: { color: T.textMute, fontSize: 11, marginTop: 5 },
  smallButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flexShrink: 0 },
  thread: { flexGrow: 1, width: '100%', maxWidth: 870, alignSelf: 'center', paddingTop: 28, paddingBottom: 30 },
  welcome: { alignItems: 'center', paddingVertical: 22 },
  mascot: { width: 194, height: 130, marginBottom: 20 },
  heroMark: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center', borderRadius: 25, borderWidth: 1, borderColor: T.chat.accentBorder, backgroundColor: T.chat.tinted, marginBottom: 28, transform: [{ rotate: '-5deg' }] },
  heroSpark: { position: 'absolute', right: -8, top: -8, width: 26, height: 26, backgroundColor: T.chat.background, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: T.highlight, fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  heroTitle: { color: T.text, textAlign: 'center', fontFamily: Platform.OS === 'web' ? 'Georgia, serif' : undefined, fontWeight: '400', letterSpacing: -1.5, marginTop: 16 },
  heroSubtitle: { color: T.textDim, fontSize: 14, lineHeight: 23, textAlign: 'center', marginTop: 18, maxWidth: 480 },
  quickGrid: { width: '100%', maxWidth: 660, flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 34 },
  quickCard: { flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16, borderWidth: 1, borderColor: T.border, borderRadius: 13, backgroundColor: T.chat.raised, minHeight: 86 },
  quickIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: T.chat.selected, alignItems: 'center', justifyContent: 'center' },
  quickTitle: { color: T.text, fontSize: 13, fontWeight: '600' },
  quickDetail: { color: T.textMute, fontSize: 11, marginTop: 6, lineHeight: 15 },
  health: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, marginTop: 18, minHeight: 44 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 25 },
  userMessage: { justifyContent: 'flex-end', marginTop: 16 },
  messageAvatar: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: T.chat.tinted },
  messageBody: { flexShrink: 1, paddingTop: 3, maxWidth: '93%' },
  messageName: { color: T.text, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  messageText: { color: T.text, fontSize: 15, lineHeight: 25 },
  userBubble: { backgroundColor: T.chat.selected, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 18, maxWidth: '86%' },
  receipts: { marginTop: 20, gap: 6, alignItems: 'flex-start' },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: T.chat.tinted, borderWidth: 1, borderColor: T.border, borderRadius: 8, maxWidth: '100%' },
  receiptText: { color: T.accentText, fontSize: 11, flexShrink: 1, lineHeight: 17 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, padding: 12, backgroundColor: T.chat.tinted, borderRadius: 10 },
  confirmCard: { marginTop: 18, borderColor: T.chat.accentBorder, backgroundColor: T.chat.tinted },
  panel: { marginTop: 20, borderWidth: 1, borderColor: T.border, borderRadius: 16, overflow: 'hidden', backgroundColor: T.bg },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 16, paddingRight: 7, minHeight: 49, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.chat.tinted },
  panelTitle: { color: T.accentText, fontSize: 13, fontWeight: '600' },
  voiceChip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: T.accent },
  voiceChipQuiet: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: T.chat.accentBorder },
  talkHint: { color: T.textMute, fontSize: 11, lineHeight: 16, paddingHorizontal: 9, paddingTop: 4 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20 },
  composerArea: { width: '100%', maxWidth: 870, alignSelf: 'center', paddingTop: 8, paddingBottom: 12 },
  composer: { backgroundColor: T.chat.composer, borderWidth: 1, borderColor: T.chat.composerBorder, borderRadius: 20, padding: 10 },
  input: { color: T.text, fontSize: 14, lineHeight: 22, padding: 9, minHeight: 48, maxHeight: 120, outlineStyle: 'none' },
  composerTools: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolDivider: { width: 1, height: 14, backgroundColor: T.borderStrong, marginHorizontal: 7 },
  send: { width: 36, height: 36, borderRadius: 12, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', marginRight: 3 },
  reviewLabel: { color: T.textMute, fontSize: 10, textAlign: 'center', marginTop: 9, lineHeight: 14 },
  footer: { color: T.textMute, fontSize: 10, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  mobileMenu: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 270, backgroundColor: T.chat.sidebar, zIndex: 10, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, elevation: 10 },
});
