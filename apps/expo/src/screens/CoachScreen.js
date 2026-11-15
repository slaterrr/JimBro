import { useCameraPermissions } from 'expo-camera';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import { useApp, useLiveCamera } from '../AppState.js';
import { CoachSetChat } from '../components/CoachSetChat.js';
import { HowToSheet } from '../components/FormReview.js';
import { MissionPanel } from '../components/Mission.js';
import { TargetSlider } from '../components/TargetSlider';
// No extension on purpose: Metro then loads PoseView.web.js on web and PoseView.js on phones.
import { PoseView } from '../components/PoseView';
import { Card, Chips, IconButton, JimBars, PrimaryButton, Sheet } from '../components/kit.js';
import { cameraGuidance, guidanceThrottle } from '../lib/guidance.js';
import { liveCue } from '../lib/cues.js';
import { coachLoadLabel, coachSetBody } from '../lib/coachSetChat.js';
import { estimateEffort } from '../lib/effort.js';
import { perfLabel, PerfTracker } from '../lib/cameraPerf.js';
import { liveSlowdownCue } from '../lib/perfCoach.js';
import { repMetrics } from '../lib/performance.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { LiveSession } from '../lib/live.js';
import { stageHeight, stageOverlays } from '../lib/layout.js';
import { analyzerFor, cameraLabel } from '../lib/analyzers.js';
import { currentTarget } from '../lib/mission.js';
import { poseHtml } from '../lib/poseHtml.js';
import { restFor } from '../lib/rest.js';
import { switchPlan } from '../lib/switchExercise.js';
import { showSetTarget, workoutTarget } from '../lib/workoutTargets.js';
import { R, T, type } from '../theme.js';

// Neutral, plain-word reasons for a movement the counter did not count.
const BLOCKED_WORDS = { arm_swing: 'arm swing', framing: 'step back into frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const CAUGHT_MS = 1500;

const CAMERA_LIFTS =EXERCISES.filter((e) => e.camera).map((e) => [e.id, e.name]);

function plannedFor(active, movement) {
  return active?.planned?.items?.find((i) => i.exercise === movement) ?? null;
}

export function CoachScreen({ openLog, initialExercise }) {
  const { active, settings, coachVoice: jim, mission, stepMission, startWorkout, saveCoachSet, clearCoachRest } = useApp();
  const mt = mission ? currentTarget(mission.state) : null; // the mission's current set, when one is running
  const [lastRepAt, setLastRepAt] = useState(0);
  // The Studio is embedded in a bounded chat panel. Keep the camera and composer visible together.
  const stageH = stageHeight(Math.min(useWindowDimensions().height, 820), { mission: true });
  const { publish: publishCameraSummary, clear: clearCameraSummary } = useLiveCamera();
  const [permission, requestPermission] = useCameraPermissions();
  const firstPlanned = active?.planned?.items?.find((i) => EXERCISES.find((e) => e.id === i.exercise)?.camera);
  const [movement, setMovement] = useState(initialExercise ?? firstPlanned?.exercise ?? 'curl');
  const planned = plannedFor(active, movement);
  const [target, setTarget] = useState(workoutTarget('reps', planned?.reps_high));
  const [sets, setSets] = useState(workoutTarget('sets', planned?.sets));
  const [setup, setSetup] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const voice = true;
  useEffect(() => () => jim.stop(), [jim]);
  const [paused, setPaused] = useState(false);
  const [clockMs, setClockMs] = useState(Date.now);
  const restDeadline = mission ? null : active?.coachRest?.until;
  const restLeft = Math.max(0, Math.ceil(((restDeadline ?? 0) - clockMs) / 1000));
  useEffect(() => {
    if (!restDeadline) return undefined;
    setClockMs(Date.now());
    const timer = setInterval(() => {
      const now = Date.now();
      setClockMs(now);
      if (now >= restDeadline) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [restDeadline]);

  const [facing, setFacing] = useState('user');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ count: 0, tracking: 'lost', lastRep: null, issue: null, hint: null });
  const [caught, setCaught] = useState(null);
  const caughtTimer = useRef(null);
  const [suggestion, setSuggestion] = useState(null);
  const seenSuggestion = useRef(null);
  const cameraWorkoutStarted = useRef(false);
  useEffect(() => () => clearTimeout(caughtTimer.current), []);
  const session = useRef(new LiveSession(movement));
  const speakGuide = useRef(guidanceThrottle(8000));
  const web = useRef(null);
  const html = useMemo(() => poseHtml({ facing: 'user' }), []);

  // Opening Coach directly is an explicit request to work out; give its camera session
  // the same on-device workout id used by Home and Jim.
  useEffect(() => {
    if (!permission?.granted || cameraWorkoutStarted.current) return;
    cameraWorkoutStarted.current = true;
    if (!active) startWorkout('Camera workout');
  }, [permission?.granted, active, startWorkout]);

  const doneSets = (active?.sets ?? []).filter((x) => x.exercise === movement).length;
  const setNo = mt?.setNo ?? doneSets + 1;
  const setupExercise = mt?.exercise ?? movement;
  const canAdjustTargets = !mission || (mt && !['check', 'done'].includes(mission.state.phase));
  const closeSetup = () => {
    if (mt && canAdjustTargets) {
      stepMission({ type: 'adjust_targets', exercise: mt.exercise, reps: target, sets });
    }
    setSetup(false);
  };
  const unit = settings.unit === 'kg' ? 'kg' : 'lb';
  const lastSet = (active?.sets ?? []).findLast((set) => set.exercise === movement && set.unit === unit);
  const soloSets = showSetTarget(movement) ? sets : null;
  const soloTarget = { exercise: movement, reps: target, sets: soloSets, setNo, unit, weight: lastSet?.weight ?? (movement === 'push_up' ? 0 : null), camera: true };
  const nextPlanned = active?.planned?.items?.find((item) => item.exercise !== movement
    && CAMERA_LIFTS.some(([id]) => id === item.exercise)
    && active.sets.filter((set) => set.exercise === item.exercise).length < item.sets);

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
    clearCameraSummary(active?.id);
    setSuggestion(null);
    seenSuggestion.current = null;
  };
  useEffect(() => {
    const p = plannedFor(active, movement);
    if (p) {
      setTarget(workoutTarget('reps', p.reps_high));
      setSets(workoutTarget('sets', p.sets));
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

  // Share a compact summary only when the counted rep changes. Camera frames stay in
  // the WebView/LiveSession and never enter persisted workout data or React app state.
  useEffect(() => {
    if (!active?.id || view.count < 1) return;
    const quality = session.current.quality();
    publishCameraSummary({
      sessionId: active.id,
      updatedAt: new Date().toISOString(),
      exercise: movement,
      reps: view.count,
      trackingPct: quality.frames ? (quality.okFrames / quality.frames) * 100 : null,
    });
  }, [active?.id, movement, publishCameraSummary, view.count]);

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
    if (m.type !== 'frame' || paused || restLeft > 0 || (mission && (!mt?.camera || !['position', 'set'].includes(mission.state.phase)))) return;
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

  const sendSoloReport = (report) => {
    const set = coachSetBody(soloTarget, report, session.current.repsDetail());
    const rest = restFor({ exercise: movement, reps: report.reps, fitnessGoal: settings.fitnessGoal });
    const id = saveCoachSet({ set, expectedCount: active?.sets.length, restSeconds: rest.seconds });
    if (id) {
      resetSet();
      if (voice) {
        const next = (soloSets === null || doneSets + 1 < soloSets) ? { exercise: movement, reps: target }
          : nextPlanned && { exercise: nextPlanned.exercise, reps: nextPlanned.reps_high };
        const summary = next ? 'Next: ' + exerciseName(next.exercise) + ', ' + next.reps + ' reps after rest.' : 'You reached your set target.';
        jim.say(summary, { force: true });
      }
    }
    return id;
  };

  const stop = () => {
    const reps = session.current.repsDetail();
    openLog({ exercise: movement, reps: reps.length, source: 'camera' }, reps.length ? { movement, reps, quality: session.current.quality(), target, clips: session.current.clips } : null);
    resetSet();
  };
  const plan = switchPlan({ current: movement, suggested: suggestion, counted: view.count });
  // Rep details in priority order; the stage keeps only as many as fit above the Jim cue card.
  const wantLines = [lastVariant, lastLiftS, perf.velocityLossPct, effort.rpe].filter((v) => v != null).length;
  const ov = stageOverlays(stageH, { repLines: wantLines, caught: !!caught, suggestion: !!plan });
  // Switch suggestion: on the stage when it fits, otherwise right under it (never over the cue).
  const suggestCard = (inStage) => (
          <View style={inStage ? [st.glass, st.suggest, { top: ov.suggestTop }] : [st.glass, st.suggestBelow]} accessibilityLiveRegion="polite">
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
  );
  let shownLines = 0;
  const fits = (v) => v != null && shownLines++ < ov.repLines;
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
            ? <PrimaryButton onPress={() => requestPermission().catch(() => setError('Camera access was denied. Allow camera access in your browser or device settings.'))}>Allow camera</PrimaryButton>
            : Platform.OS === 'web' ? <Text accessibilityRole="alert" style={[type.body, { marginTop: 12, color: T.amber }]}>Camera access is blocked. Open your browser’s site settings to allow the camera, then reopen the workout studio.</Text> : <PrimaryButton onPress={() => Linking.openSettings()}>Open Settings</PrimaryButton>}
          {error ? <Text accessibilityRole="alert" style={[type.body, { color: T.amber }]}>{error}</Text> : null}
        </Card>
        {mission ? (
          <MissionPanel count={0} lastRepAt={0} tracking="lost" repsDetail={() => []} resetCounter={() => resetSet()} voiceOn={voice} paused={paused} setPaused={setPaused} />
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
          {showSetTarget(setupExercise) ? <Text style={{ color: T.textDim, fontSize: 14, marginTop: 4 }}>Set {setNo} of {Math.max(sets, setNo)}</Text> : null}
          {analyzerFor(movement)?.status !== 'tested_real' ? (
            // Honest about how well the camera has been tested for this lift.
            <Text style={{ color: T.amber, fontSize: 12, marginTop: 4 }} accessibilityLabel={cameraLabel(movement)}>
              {analyzerFor(movement)?.status === 'experimental' ? 'Experimental counting' : 'Tested in simulation only'}
            </Text>
          ) : null}
        </TouchableOpacity>
        <View style={[st.glass, st.repsBox]}>
          <Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>Reps</Text>
          <Text testID="camera-rep-count" accessibilityLabel={`${view.count} measured reps`} style={{ fontSize: 28, fontWeight: '800', color: T.text }}>
            <Text style={{ color: T.purple }}>{view.count}</Text>
            <Text style={{ color: T.textDim, fontWeight: '500' }}> / {target}</Text>
          </Text>
          {fits(lastVariant) ? (
            <Text style={{ color: T.text, fontSize: 14, fontWeight: '600' }} accessibilityLabel={`Last rep: ${lastVariant} push-up`}>
              {lastVariant === 'standard' ? 'Standard' : lastVariant === 'knee' ? 'Knee' : 'Incline'} push-up
            </Text>
          ) : null}
          {fits(lastLiftS) ? (
            <Text style={{ color: T.textDim, fontSize: 13 }} accessibilityLabel={`Last rep lifted in ${lastLiftS.toFixed(1)} seconds`}>
              Last rep {lastLiftS.toFixed(1)} s up
            </Text>
          ) : null}
          {fits(perf.velocityLossPct) ? (
            <Text style={{ color: perf.velocityLossPct >= 30 ? T.amber : T.textDim, fontSize: 13 }} accessibilityLabel={`Rep speed ${perf.velocityLossPct} percent below your first reps`}>
              Speed −{perf.velocityLossPct}% vs first reps
            </Text>
          ) : null}
          {fits(effort.rpe) ? (
            <Text style={{ color: T.textDim, fontSize: 13 }} accessibilityLabel={`Rough effort range RPE ${Math.max(6, effort.rpe - 1)} to ${Math.min(10, effort.rpe + 1)}, an estimate`}>
              Effort est. RPE {Math.max(6, effort.rpe - 1)}–{Math.min(10, effort.rpe + 1)}
            </Text>
          ) : null}
        </View>
        {caught ? (
          <View
            style={[st.caught, { top: ov.caughtTop ?? 110, borderColor: caught.reason === 'arm_swing' ? T.red : T.amber }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Not counted, ${caught.words}`}
          >
            <Text style={{ color: caught.reason === 'arm_swing' ? T.red : T.amber, fontSize: 16, fontWeight: '800' }}>
              Not counted · {caught.words}
            </Text>
          </View>
        ) : null}
        {plan && ov.suggestInStage ? suggestCard(true) : null}
        <View style={[st.glass, st.cue]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <JimBars height={16} />
            <Text style={{ color: T.violetText, fontWeight: '700', fontSize: 16 }}>Jim</Text>
          </View>
          <Text style={{ color: T.text, fontSize: 16, lineHeight: 22 }}>{paused ? 'Coaching paused' : restLeft > 0 || mission?.state.phase === 'rest' ? 'Resting between sets' : error ?? (guidance || (ready ? cue : 'Loading pose model…'))}</Text>
        </View>
      </View>

      {plan && !ov.suggestInStage ? suggestCard(false) : null}
      {mission ? (
        <MissionPanel
          count={view.count}
          lastRepAt={lastRepAt}
          tracking={ready ? view.tracking : 'lost'}
          repsDetail={() => session.current.repsDetail()}
          resetCounter={() => resetSet()}
          setQuality={() => session.current.quality()}
          voiceOn={voice}
          paused={paused}
          setPaused={setPaused}
        />
      ) : (
        <>
          {restLeft > 0 ? (
            <Card style={{ marginTop: 10, gap: 8 }} accessibilityLiveRegion="polite">
              <Text style={type.title}>Rest · {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}</Text>
              <Text style={type.body}>{(soloSets === null || doneSets < soloSets)
                ? 'Next: ' + exerciseName(movement) + ' · ' + target + ' reps · ' + coachLoadLabel(soloTarget)
                : nextPlanned ? 'Next: ' + exerciseName(nextPlanned.exercise) + ' · ' + nextPlanned.reps_high + ' reps'
                  : 'You reached your set target.'}</Text>
              <PrimaryButton secondary onPress={() => clearCoachRest(restDeadline)}>Skip rest</PrimaryButton>
            </Card>
          ) : soloSets !== null && doneSets >= soloSets && nextPlanned ? (
            <PrimaryButton secondary onPress={() => setMovement(nextPlanned.exercise)}>Next: {exerciseName(nextPlanned.exercise)}</PrimaryButton>
          ) : null}
          <CoachSetChat
            key={active?.id}
            target={soloTarget} phase={restLeft > 0 ? 'rest' : 'set'}
            slotKey={[active?.id, movement, setNo].join(':')} measured={view.count}
            paused={paused} setPaused={setPaused} sendSet={sendSoloReport} voiceOn={voice}
          />
        </>
      )}
      <View style={st.controls}>
        {mission || paused || restLeft > 0 ? null : (
          <IconButton ring={T.red} size={70} label="End set and log it" onPress={stop}>
            <View style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: T.red }} />
          </IconButton>
        )}
        <IconButton icon="camera-flip-outline" label="Flip camera" onPress={flip} />
      </View>
      <Text style={[type.small, { textAlign: 'center', marginTop: 12 }]}>
        Pose tracking runs on this device{speedText ? ` (${speedText})` : ''}. Bench press and lunges: log them with + on Home.
      </Text>

      <Sheet visible={setup} onClose={closeSetup} title="This set">
        {mission ? <Text style={type.label}>{exerciseName(setupExercise)}</Text> : (
          <>
            <Text style={[type.label, { marginBottom: 8 }]}>Exercise (camera tracked)</Text>
            <Chips options={CAMERA_LIFTS} value={movement} onChange={setMovement} />
          </>
        )}
        {canAdjustTargets ? (
          <>
            <TargetSlider kind="reps" label="Target reps" value={target} onChange={setTarget} />
            {showSetTarget(setupExercise) ? <TargetSlider kind="sets" label="Sets" value={sets} onChange={setSets} /> : null}
          </>
        ) : null}
        <PrimaryButton secondary onPress={() => { closeSetup(); setHowTo(true); }}>How to do it</PrimaryButton>
        <PrimaryButton onPress={closeSetup}>Done</PrimaryButton>
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
  suggestBelow: { position: 'relative', marginTop: 12 },
  suggestBtn: { borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 8 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', marginTop: 18 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.purple, backgroundColor: T.purpleSoft, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
