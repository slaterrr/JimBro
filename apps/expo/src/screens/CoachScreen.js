import { useCameraPermissions } from 'expo-camera';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { useApp } from '../AppState.js';
import { HowToSheet } from '../components/FormReview.js';
import { MissionPanel } from '../components/Mission.js';
// No extension on purpose: Metro then loads PoseView.web.js on web and PoseView.js on phones.
import { PoseView } from '../components/PoseView';
import { Card, Chips, IconButton, JimBars, PrimaryButton, Sheet } from '../components/kit.js';
import { cameraGuidance, guidanceThrottle } from '../lib/guidance.js';
import { liveCue } from '../lib/cues.js';
import { estimateEffort } from '../lib/effort.js';
import { perfLabel, PerfTracker } from '../lib/cameraPerf.js';
import { liveSlowdownCue } from '../lib/perfCoach.js';
import { repMetrics } from '../lib/performance.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { LiveSession } from '../lib/live.js';
import { stageHeight } from '../lib/layout.js';
import { currentTarget } from '../lib/mission.js';
import { poseHtml } from '../lib/poseHtml.js';
import { switchPlan } from '../lib/switchExercise.js';
import { R, T, type } from '../theme.js';

// Neutral, plain-word reasons for a movement the counter did not count.
const BLOCKED_WORDS = { arm_swing: 'arm swing', framing: 'step back into frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const CAUGHT_MS = 1500;

const CAMERA_LIFTS =EXERCISES.filter((e) => e.camera).map((e) => [e.id, e.name]);

function plannedFor(active, movement) {
  return active?.planned?.items?.find((i) => i.exercise === movement) ?? null;
}

export function CoachScreen({ openLog }) {
  const { active, settings, voice: jim, mission, stepMission } = useApp();
  const mt = mission ? currentTarget(mission.state) : null; // the mission's current set, when one is running
  const [lastRepAt, setLastRepAt] = useState(0);
  const stageH = stageHeight(useWindowDimensions().height); // fits any screen; controls stay visible
  const [permission, requestPermission] = useCameraPermissions();
  const firstPlanned = active?.planned?.items?.find((i) => EXERCISES.find((e) => e.id === i.exercise)?.camera);
  const [movement, setMovement] = useState(firstPlanned?.exercise ?? 'curl');
  const planned = plannedFor(active, movement);
  const [target, setTarget] = useState(planned?.reps_high ?? 12);
  const [sets, setSets] = useState(planned?.sets ?? 4);
  const [setup, setSetup] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [voice, setVoice] = useState(true);
  const [facing, setFacing] = useState('user');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ count: 0, tracking: 'lost', lastRep: null, issue: null, hint: null });
  const [caught, setCaught] = useState(null);
  const caughtTimer = useRef(null);
  const [suggestion, setSuggestion] = useState(null);
  const seenSuggestion = useRef(null);
  useEffect(() => () => clearTimeout(caughtTimer.current), []);
  const session = useRef(new LiveSession(movement));
  const speakGuide = useRef(guidanceThrottle(8000));
  const web = useRef(null);
  const html = useMemo(() => poseHtml({ facing: 'user' }), []);

  const doneSets = (active?.sets ?? []).filter((x) => x.exercise === movement).length;
  const setNo = Math.min(doneSets + 1, Math.max(sets, doneSets + 1));
  const cue = liveCue({ movement, count: view.count, target, lastRep: view.lastRep, tracking: view.tracking, persona: settings.persona });
  const guidance = cameraGuidance(view.issue, view.hint, movement);
  // Live effort estimate (labelled "est.") and, for push-ups, the last rep's type.
  const effort = useMemo(() => estimateEffort({ movement, reps: session.current.repsDetail() }), [view.count, movement]);
  const lastVariant = movement === 'push_up' ? view.lastRep?.variant ?? null : null;
  // Measured, relative numbers for the overlay (degrees and ms from the camera; not m/s).
  const perf = useMemo(() => repMetrics(movement, session.current.repsDetail()), [view.count, movement]);
  const lastLiftS = perf.reps.length ? perf.reps[perf.reps.length - 1].lift_ms / 1000 : null;
  const slowCued = useRef(false);
  const speed = useRef(new PerfTracker({ targetFps: 20 }));
  const [speedText, setSpeedText] = useState(null);

  const resetSet = (m = movement) => {
    session.current = new LiveSession(m);
    slowCued.current = false;
    setView({ count: 0, tracking: 'lost', lastRep: null, issue: null, hint: null });
    setSuggestion(null);
    seenSuggestion.current = null;
  };
  useEffect(() => {
    const p = plannedFor(active, movement);
    if (p) {
      setTarget(p.reps_high);
      setSets(p.sets);
    }
    resetSet(movement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement]);

  // Mission mode: the mission decides the lift and the target; the camera follows.
  useEffect(() => {
    if (!mt) return;
    if (mt.camera && mt.exercise !== movement) setMovement(mt.exercise);
    setTarget(mt.reps);
    setSets(mt.sets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mt?.exercise, mt?.reps, mt?.sets]);

  const onMessage = (e) => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') setReady(true);
    if (m.type === 'perf') {
      speed.current.add(m); // measured on this device by the pose page
      setSpeedText(perfLabel(m));
      return;
    }
    if (m.type === 'error') {
      setError(m.kind === 'camera'
        ? 'The camera could not start. Allow camera access for Expo Go in Settings.'
        : 'The pose model could not load. The first run needs internet to download it.');
    }
    if (m.type !== 'frame') return;
    const out = session.current.frame(m.t, m.pose);
    const lastRep = session.current.reps[session.current.reps.length - 1] ?? null;
    setView((v) => {
      if (v.count === out.count && v.tracking === out.tracking.status && v.issue === out.issue && v.hint === (out.hint ?? null)) return v;
      return { count: out.count, tracking: out.tracking.status, lastRep, issue: out.issue, hint: out.hint ?? null };
    });
    if (out.issue && voice && speakGuide.current(`${out.issue}:${out.hint ?? ''}`, m.t)) {
      jim.say(cameraGuidance(out.issue, out.hint, movement), { force: true });
    }
    const suggested = out.suggested ?? session.current.suggested ?? null;
    if (suggested && suggested !== movement && suggested !== seenSuggestion.current) {
      // Show (and speak) each new suggestion once; dismissing hides it until a different one.
      seenSuggestion.current = suggested;
      setSuggestion(suggested);
      if (voice) jim.say(switchPlan({ current: movement, suggested, counted: out.count }).label, { force: true });
    }
    if (out.blocked) {
      const words = BLOCKED_WORDS[out.blocked.reason] ?? 'lost tracking';
      setCaught({ reason: out.blocked.reason, words });
      clearTimeout(caughtTimer.current);
      caughtTimer.current = setTimeout(() => setCaught(null), CAUGHT_MS);
      if (voice) jim.cue(`Not counted — ${words}.`, { force: true });
    }
    if (out.rep) setLastRepAt(Date.now());
    if (out.rep && voice) jim.cue(String(out.count), { force: true });
    if (out.rep && voice) {
      // At most one short line per set, between reps, and only for a clear slowdown.
      const line = liveSlowdownCue(movement, session.current.repsDetail(), slowCued.current);
      if (line) {
        slowCued.current = true;
        jim.say(line, { force: true });
      }
    }
  };

  const stop = () => {
    const reps = session.current.repsDetail();
    openLog({ exercise: movement, reps: reps.length, source: 'camera' }, reps.length ? { movement, reps, quality: session.current.quality(), target, clips: session.current.clips } : null);
    resetSet();
  };
  const plan = switchPlan({ current: movement, suggested: suggestion, counted: view.count });
  const onSwitch = (id) => {
    const next = suggestion;
    setSuggestion(null);
    if (id === 'keep' || !next) return;
    if (id === 'log') {
      openLog({ exercise: next });
      return;
    }
    if (mt) {
      stepMission({ type: 'switch', exercise: next }); // the mission swaps the lift; the effect above follows it
      resetSet(next);
      return;
    }
    if (plan?.logFirst) stop(); // log the reps already counted for the current lift, as Stop does
    setMovement(next); // the movement effect resets the session for the new exercise
  };
  const flip = () => {
    const f = facing === 'user' ? 'environment' : 'user';
    session.current.reacquireTracking();
    setFacing(f);
    web.current?.postMessage(JSON.stringify({ type: 'facing', facing: f }));
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        <Header live={false} />
        <Card style={{ marginTop: 20 }}>
          <Text style={type.title}>Camera access</Text>
          <Text style={type.body}>Jim counts your reps from your pose, right on this phone. Video is never saved or uploaded.</Text>
          {permission.canAskAgain
            ? <PrimaryButton onPress={requestPermission}>Allow camera</PrimaryButton>
            : <PrimaryButton onPress={() => Linking.openSettings()}>Open Settings</PrimaryButton>}
        </Card>
        {mission ? (
          <MissionPanel count={0} lastRepAt={0} tracking="lost" repsDetail={() => []} resetCounter={() => resetSet()} voiceOn={voice} />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <Header live={ready && view.tracking === 'ok'} />
      <View style={[st.stage, { height: stageH }]}>
        <PoseView ref={web} html={html} onMessage={onMessage} style={{ backgroundColor: '#000' }} />
        <TouchableOpacity style={[st.glass, st.exerciseBox]} onPress={() => setSetup(true)} accessibilityLabel="Change exercise">
          <Text style={{ color: T.text, fontSize: 18, fontWeight: '700' }}>{exerciseName(movement)}</Text>
          <Text style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>Set {setNo} of {Math.max(sets, setNo)}</Text>
        </TouchableOpacity>
        <View style={[st.glass, st.repsBox]}>
          <Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>Reps</Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: T.text }}>
            <Text style={{ color: T.purple }}>{view.count}</Text>
            <Text style={{ color: T.textDim, fontWeight: '500' }}> / {target}</Text>
          </Text>
          {lastVariant ? (
            <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} accessibilityLabel={`Last rep: ${lastVariant} push-up`}>
              {lastVariant === 'standard' ? 'Standard' : lastVariant === 'knee' ? 'Knee' : 'Incline'} push-up
            </Text>
          ) : null}
          {lastLiftS ? (
            <Text style={{ color: T.textDim, fontSize: 13 }} accessibilityLabel={`Last rep lifted in ${lastLiftS.toFixed(1)} seconds`}>
              Last rep {lastLiftS.toFixed(1)} s up
            </Text>
          ) : null}
          {perf.velocityLossPct != null ? (
            <Text style={{ color: perf.velocityLossPct >= 30 ? T.amber : T.textDim, fontSize: 13 }} accessibilityLabel={`Rep speed ${perf.velocityLossPct} percent below your first reps`}>
              Speed −{perf.velocityLossPct}% vs first reps
            </Text>
          ) : null}
          {effort.rpe != null ? (
            <Text style={{ color: T.textDim, fontSize: 13 }} accessibilityLabel={`Rough effort range RPE ${Math.max(6, effort.rpe - 1)} to ${Math.min(10, effort.rpe + 1)}, an estimate`}>
              Effort est. RPE {Math.max(6, effort.rpe - 1)}–{Math.min(10, effort.rpe + 1)}
            </Text>
          ) : null}
        </View>
        {caught ? (
          <View
            style={[st.caught, { borderColor: caught.reason === 'arm_swing' ? T.red : T.amber }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Not counted, ${caught.words}`}
          >
            <Text style={{ color: caught.reason === 'arm_swing' ? T.red : T.amber, fontSize: 16, fontWeight: '800' }}>
              Not counted · {caught.words}
            </Text>
          </View>
        ) : null}
        {plan ? (
          <View style={[st.glass, st.suggest]} accessibilityLiveRegion="polite">
            <Text style={{ color: T.text, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>{plan.label}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {plan.actions.map((a, i) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => onSwitch(a.id)}
                  accessibilityRole="button"
                  style={[st.suggestBtn, i === 0 ? { backgroundColor: T.accent, borderColor: T.accent } : { borderColor: T.border }]}
                >
                  <Text style={{ color: i === 0 ? T.bg : T.text, fontWeight: '700', fontSize: 14 }}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
        <View style={[st.glass, st.cue]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <JimBars height={16} />
            <Text style={{ color: T.violetText, fontWeight: '700', fontSize: 16 }}>Jim</Text>
          </View>
          <Text style={{ color: T.text, fontSize: 16, lineHeight: 22 }}>{error ?? (guidance || (ready ? cue : 'Loading pose model…'))}</Text>
        </View>
      </View>

      {mission ? (
        <MissionPanel
          count={view.count}
          lastRepAt={lastRepAt}
          tracking={ready ? view.tracking : 'lost'}
          repsDetail={() => session.current.repsDetail()}
          resetCounter={() => resetSet()}
          setQuality={() => session.current.quality()}
          voiceOn={voice}
        />
      ) : null}
      <View style={st.controls}>
        <IconButton icon={voice ? 'microphone-outline' : 'microphone-off'} label="Voice cues" onPress={() => setVoice((v) => !v)} />
        {mission ? null : (
          <IconButton ring={T.red} size={70} label="End set and log it" onPress={stop}>
            <View style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: T.red }} />
          </IconButton>
        )}
        <IconButton icon="camera-flip-outline" label="Flip camera" onPress={flip} />
      </View>
      <Text style={[type.small, { textAlign: 'center', marginTop: 12 }]}>
        Pose tracking runs on this device{speedText ? ` (${speedText})` : ''}. Bench press and lunges: log them with + on Home.
      </Text>

      <Sheet visible={setup} onClose={() => setSetup(false)} title="This set">
        <Text style={[type.label, { marginBottom: 8 }]}>Exercise (camera tracked)</Text>
        <Chips options={CAMERA_LIFTS} value={movement} onChange={setMovement} />
        <Text style={[type.label, { marginVertical: 8 }]}>Target reps</Text>
        <Chips options={[5, 8, 10, 12, 15].map((n) => [n, String(n)])} value={target} onChange={setTarget} />
        <Text style={[type.label, { marginVertical: 8 }]}>Sets</Text>
        <Chips options={[1, 2, 3, 4, 5].map((n) => [n, String(n)])} value={sets} onChange={setSets} />
        <PrimaryButton secondary onPress={() => { setSetup(false); setHowTo(true); }}>How to do it</PrimaryButton>
        <PrimaryButton onPress={() => setSetup(false)}>Done</PrimaryButton>
      </Sheet>
      <HowToSheet visible={howTo} onClose={() => setHowTo(false)} movement={movement} />
    </ScrollView>
  );
}

function Header({ live }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <JimBars height={26} />
        <Text style={type.h2}>Jim <Text style={{ fontWeight: '600' }}>Coach</Text></Text>
      </View>
      <View style={[st.live, !live && { borderColor: T.border, backgroundColor: 'transparent' }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? T.purple : T.textMute }} />
        <Text style={{ color: live ? T.violetText : T.textMute, fontWeight: '700' }}>{live ? 'Live' : 'Idle'}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  stage: { borderRadius: R.lg, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: T.border },
  glass: { position: 'absolute', backgroundColor: 'rgba(16,13,22,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: R.md, padding: 14 },
  exerciseBox: { top: 12, left: 12, maxWidth: '55%' },
  repsBox: { top: 12, right: 12, alignItems: 'flex-start', minWidth: 96 },
  cue: { left: 12, right: 12, bottom: 12 },
  caught: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: 'rgba(16,13,22,0.88)', borderWidth: 2, borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 8 },
  suggest: { top: 160, left: 12, right: 12 },
  suggestBtn: { borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 8 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', marginTop: 18 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.purple, backgroundColor: T.purpleSoft, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
