import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useApp } from '../AppState.js';
import { normalizeServer } from '../lib/config.js';
import { Button, C, Card, Choice, Kicker, Metric, s } from '../ui.js';

const TONES = [['direct', 'Direct'], ['friendly', 'Friendly'], ['silly', 'Silly'], ['hard', 'Hard']];

export function HomeScreen({ go }) {
  const { settings, update, online, pending, sync, workout } = useApp();
  const [server, setServer] = useState(settings.server.replace(/^http:\/\//, ''));
  const [athlete, setAthlete] = useState(settings.athlete);
  const [error, setError] = useState(null);

  const sets = [...workout.history, ...(workout.active ? [workout.active] : [])].flatMap((w) => w.sets);
  const volume = sets.reduce((t, x) => t + x.weight * x.reps, 0);

  const connect = () => {
    const base = normalizeServer(server);
    if (!base) return setError('Enter the Pi address, e.g. jimbro.local or 192.168.1.20');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(athlete)) return setError('Name: letters, numbers, - or _ only');
    setError(null);
    update({ server: base, athlete });
    setTimeout(sync, 0);
  };

  return (
    <>
      <Kicker>YOUR TRAINING PARTNER</Kicker>
      <Text style={s.heroTitle}>
        Show up.{'\n'}
        <Text style={s.green}>Get stronger.</Text>
      </Text>
      <Text style={s.body}>Jim tracks the work and helps you make the next set count.</Text>
      <Button onPress={() => go('Workout')}>{workout.active ? 'Continue workout  ↗' : 'Start a workout  ↗'}</Button>
      <View style={s.metrics}>
        <Metric title="WORKOUTS" value={workout.history.length} />
        <Metric title="SETS" value={sets.length} />
        <Metric title="VOLUME" value={`${Math.round(volume)}`} />
      </View>

      <Card>
        <Kicker>YOUR PI</Kicker>
        <Text style={s.cardTitle}>
          {online === null ? 'Checking…' : online ? 'Connected' : 'Offline'}
          {pending ? <Text style={{ color: C.warn }}>{`  · ${pending} to sync`}</Text> : null}
        </Text>
        <Text style={s.body}>
          {online
            ? 'Workouts, Jim and rankings come from your JimBro Pi.'
            : 'Sets are kept on this phone and sync automatically when the Pi is reachable on the same Wi-Fi.'}
        </Text>
        <Text style={s.label}>Pi address</Text>
        <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} placeholder="jimbro.local" placeholderTextColor={C.muted} />
        <Text style={s.label}>Your name on this Pi</Text>
        <TextInput style={s.input} value={athlete} onChangeText={setAthlete} autoCapitalize="none" autoCorrect={false} />
        <Button onPress={connect} secondary>Save & connect</Button>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.fine}>If jimbro.local does not resolve on your phone, use the IP shown in jimbro-status.txt on your USB stick.</Text>
      </Card>

      <Card>
        <Kicker>COACH JIM</Kicker>
        <Text style={s.cardTitle}>In your corner.</Text>
        <Choice title="Coaching tone" options={TONES} value={settings.tone} onChange={(tone) => update({ tone })} />
        <Choice title="Units" options={[['lb', 'lb'], ['kg', 'kg']]} value={settings.unit} onChange={(unit) => update({ unit })} />
      </Card>
    </>
  );
}
