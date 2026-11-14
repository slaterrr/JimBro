import { useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useApp } from '../AppState.js';
import { HowToSheet } from '../components/FormReview.js';
import { Card, Chips, IconButton, JimBars, PrimaryButton, Sheet } from '../components/kit.js';
import { liveCue } from '../lib/cues.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { LiveSession } from '../lib/live.js';
import { poseHtml } from '../lib/poseHtml.js';
import { R, T, type } from '../theme.js';

// Neutral, plain-word reasons for a movement the counter did not count.
const BLOCKED_WORDS = { arm_swing: 'arm swing', framing: 'step back into frame', implausible_motion: 'tracking jumped', tracking: 'lost tracking' };
const CAUGHT_MS = 1500;

const CAMERA_LIFTS =EXERCISES.filter((e) => e.camera).map((e) => [e.id, e.name]);

function plannedFor(active, movement) {
  return active?.planned?.items?.find((i) => i.exercise === movement) ?? null;
}

export function CoachScreen({ openLog }) {
  const { active, settings } = useApp();
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
  const [view, setView] = useState({ count: 0, tracking: 'lost', lastRep: null, issue: null });
  const [caught, setCaught] = useState(null);
  const caughtTimer = useRef(null);
  useEffect(() => () => clearTimeout(caughtTimer.current), []);
  const session = useRef(new LiveSession(movement));
  const web = useRef(null);
  const html = useMemo(() => poseHtml({ facing: 'user' }), []);

  const doneSets = (active?.sets ?? []).filter((x) => x.exercise === movement).length;
  const setNo = Math.min(doneSets + 1, Math.max(sets, doneSets + 1));
  const cue = liveCue({ movement, count: view.count, target, lastRep: view.lastRep, tracking: view.tracking, persona: settings.persona });
  const cameraGuidance = view.issue === 'arm_swing'
    ? 'Upper arm moved too far — rep not counted. Keep your elbow near your side.'
    : view.issue === 'framing'
      ? 'Step back — your shoulders and hips need to be in frame to count reps.'
    : view.issue === 'implausible_motion'
      ? 'Tracking jumped — rep paused. Hold steady with only you in frame.'
    : view.issue === 'tracking'
      ? 'Tracking uncertain — rep paused. Keep your body and working arm or leg in frame.'
      : null;

  const resetSet = (m = movement) => {
    session.current = new LiveSession(m);
    setView({ count: 0, tracking: 'lost', lastRep: null, issue: null });
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

  const onMessage = (e) => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') setReady(true);
    if (m.type === 'error') {
      setError(m.kind === 'camera'
        ? 'The camera could not start. Allow camera access for Expo Go in Settings.'
        : 'The pose model could not load. The first run needs internet to download it.');
    }
    if (m.type !== 'frame') return;
    const out = session.current.frame(m.t, m.pose);
    const lastRep = session.current.reps[session.current.reps.length - 1] ?? null;
    setView((v) => {
      if (v.count === out.count && v.tracking === out.tracking.status && v.issue === out.issue) return v;
      return { count: out.count, tracking: out.tracking.status, lastRep, issue: out.issue };
    });
    if (out.blocked) {
      const words = BLOCKED_WORDS[out.blocked.reason] ?? 'lost tracking';
      setCaught({ reason: out.blocked.reason, words });
      clearTimeout(caughtTimer.current);
      caughtTimer.current = setTimeout(() => setCaught(null), CAUGHT_MS);
      if (voice) {
        Speech.stop();
        Speech.speak(`Not counted — ${words}.`);
      }
    }
    if (out.rep && voice) {
      Speech.stop();
      Speech.speak(String(out.count));
    }
  };

  const stop = () => {
    const reps = session.current.repsDetail();
    openLog({ exercise: movement, reps: reps.length, source: 'camera' }, reps.length ? { movement, reps, quality: session.current.quality(), target, clips: session.current.clips } : null);
    resetSet();
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
      <View style={{ padding: 20 }}>
        <Header live={false} />
        <Card style={{ marginTop: 20 }}>
          <Text style={type.title}>Camera access</Text>
          <Text style={type.body}>Jim counts your reps from your pose, right on this phone. Video is never saved or uploaded.</Text>
          {permission.canAskAgain
            ? <PrimaryButton onPress={requestPermission}>Allow camera</PrimaryButton>
            : <PrimaryButton onPress={() => Linking.openSettings()}>Open Settings</PrimaryButton>}
        </Card>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      <Header live={ready && view.tracking === 'ok'} />
      <View style={st.stage}>
        <WebView
          ref={web}
          source={{ html, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          style={{ backgroundColor: '#000' }}
        />
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
        <View style={[st.glass, st.cue]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <JimBars height={16} />
            <Text style={{ color: T.violetText, fontWeight: '700', fontSize: 16 }}>Jim</Text>
          </View>
          <Text style={{ color: T.text, fontSize: 16, lineHeight: 22 }}>{error ?? (cameraGuidance || (ready ? cue : 'Loading pose model…'))}</Text>
        </View>
      </View>

      <View style={st.controls}>
        <IconButton icon={voice ? 'microphone-outline' : 'microphone-off'} label="Voice cues" onPress={() => setVoice((v) => !v)} />
        <IconButton ring={T.red} size={70} label="End set and log it" onPress={stop}>
          <View style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: T.red }} />
        </IconButton>
        <IconButton icon="camera-flip-outline" label="Flip camera" onPress={flip} />
      </View>
      <Text style={[type.small, { textAlign: 'center', marginTop: 12 }]}>
        Pose tracking runs on this phone. Bench, deadlift and pull-ups: log them with + on Home.
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
  stage: { height: 520, borderRadius: R.lg, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: T.border },
  glass: { position: 'absolute', backgroundColor: 'rgba(16,13,22,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: R.md, padding: 14 },
  exerciseBox: { top: 12, left: 12, minWidth: 160 },
  repsBox: { top: 12, right: 12, alignItems: 'flex-start', minWidth: 110 },
  cue: { left: 12, right: 12, bottom: 12 },
  caught: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: 'rgba(16,13,22,0.88)', borderWidth: 2, borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 8 },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', marginTop: 18 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.purple, backgroundColor: T.purpleSoft, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
