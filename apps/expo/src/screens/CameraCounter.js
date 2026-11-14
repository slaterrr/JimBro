import { useCameraPermissions } from 'expo-camera';
import React, { useMemo, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useApp } from '../AppState.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { LiveSession } from '../lib/live.js';
import { poseHtml } from '../lib/poseHtml.js';
import { Button, C, Card, Choice, Kicker, s } from '../ui.js';

const CAMERA_MOVES = EXERCISES.filter((e) => e.camera).map((e) => [e.id, e.name]);
const TRACK = { ok: ['Tracking', C.green], low: ['Low confidence: step back, light up', C.warn], lost: ['No body detected', C.bad] };
const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** Full camera set: the WebView finds the pose, the tested pipeline counts reps here. */
export function CameraCounter({ movement: initial, onDone, onCancel }) {
  const { say } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [movement, setMovement] = useState(initial);
  const [facing, setFacing] = useState('user');
  const [view, setView] = useState({ count: 0, partials: 0, state: 'rest', tracking: { status: 'lost' } });
  const [reps, setReps] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const session = useRef(new LiveSession(initial));
  const web = useRef(null);
  const html = useMemo(() => poseHtml({ facing: 'user' }), []);

  const switchMovement = (m) => {
    setMovement(m);
    session.current = new LiveSession(m);
    setReps([]);
    setView((v) => ({ ...v, count: 0, partials: 0, state: 'rest' }));
  };
  const flip = () => {
    const f = facing === 'user' ? 'environment' : 'user';
    setFacing(f);
    web.current?.postMessage(JSON.stringify({ type: 'facing', facing: f }));
  };

  const onMessage = (e) => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') setStatus('ready');
    if (m.type === 'error') {
      setStatus('error');
      setError(m.kind === 'camera'
        ? 'The camera could not start. Allow camera access for Expo Go in Settings.'
        : 'The pose model could not load. The first run needs internet to download it.');
    }
    if (m.type === 'frame') {
      const out = session.current.frame(m.t, m.pose);
      if (out.rep) {
        setReps(session.current.repsDetail());
        say(String(out.count));
      }
      setView((v) => (v.count === out.count && v.state === out.state && v.partials === out.partials && v.tracking.status === out.tracking.status ? v : out));
    }
  };

  if (!permission) return <Text style={s.body}>Checking camera permission…</Text>;
  if (!permission.granted) {
    return (
      <Card>
        <Text style={s.cardTitle}>Camera access</Text>
        <Text style={s.body}>JimBro counts reps from your pose on this phone. Video is never saved or uploaded.</Text>
        {permission.canAskAgain
          ? <Button onPress={requestPermission}>Allow camera</Button>
          : <Button onPress={() => Linking.openSettings()}>Open Settings</Button>}
        <Button secondary onPress={onCancel}>Cancel</Button>
      </Card>
    );
  }

  const [label, color] = TRACK[view.tracking.status] ?? TRACK.lost;
  const last = reps[reps.length - 1];
  return (
    <>
      <Kicker>CAMERA REP COUNTER</Kicker>
      <Choice options={CAMERA_MOVES} value={movement} onChange={switchMovement} />
      <View style={{ height: 360, borderRadius: 14, overflow: 'hidden', marginTop: 12, backgroundColor: '#000' }}>
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
      </View>
      <Text style={[s.pill, { color, borderColor: color, alignSelf: 'flex-start', marginTop: 10 }]}>
        {status === 'loading' ? 'Loading pose model…' : label}
      </Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Card>
        <Text style={s.liveCount}>{view.count}</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>
          {exerciseName(movement)} · {view.partials} partial · {view.state}
          {last ? ` · last rep TUT ${sec(last.concentric_ms + last.peak_pause_ms + last.eccentric_ms)}` : ''}
        </Text>
        <Button disabled={!view.count} onPress={() => onDone({ movement, reps })}>Use {view.count} reps  ✓</Button>
        <View style={s.inputRow}>
          <View style={s.inputHalf}><Button secondary onPress={flip}>Flip camera</Button></View>
          <View style={s.inputHalf}><Button secondary onPress={() => switchMovement(movement)}>Reset</Button></View>
        </View>
        <Button secondary onPress={onCancel}>Cancel</Button>
        <Text style={s.fine}>
          Stand side-on, whole arm (or leg for squats) in frame. Full reps only: partials don't count.
          Pose detection runs on this phone; the model downloads once. TUT is estimated movement timing.
        </Text>
      </Card>
    </>
  );
}
