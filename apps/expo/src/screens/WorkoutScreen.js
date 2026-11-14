import React, { useEffect, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';

import { useApp } from '../AppState.js';
import { pwaUrl } from '../lib/config.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { repsSinceLastSet } from '../lib/station.js';
import { Button, C, Card, Choice, Kicker, Title, s } from '../ui.js';

const RPE = [['', '–'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10']];

export function WorkoutScreen({ prefill, clearPrefill }) {
  const { settings, workout, startWorkout, logSet, finishWorkout, station, stationConnected, online, notice, say } = useApp();
  const [name, setName] = useState('Strength session');
  const [exercise, setExercise] = useState('curl');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(settings.unit);
  const [reps, setReps] = useState('8');
  const [rpe, setRpe] = useState('');
  const [useCamera, setUseCamera] = useState(false);
  const [error, setError] = useState(null);

  const liveReps = repsSinceLastSet(station);

  useEffect(() => {
    if (!prefill) return;
    setExercise(prefill.exercise);
    setWeight(String(prefill.weight));
    setUnit(prefill.unit);
    setReps(String(prefill.reps));
    if (prefill.rpe) setRpe(String(prefill.rpe));
    clearPrefill();
  }, [prefill, clearPrefill]);

  // Follow the camera counter: the movement it tracks and the live rep count.
  useEffect(() => {
    if (!liveReps.length) return;
    if (station.movement && EXERCISES.some((e) => e.id === station.movement)) setExercise(station.movement);
    setReps(String(liveReps.length));
    setUseCamera(true);
  }, [liveReps.length, station.movement]);

  const save = async () => {
    const w = Number(weight || 0);
    const r = Number(reps);
    const p = rpe === '' ? null : Number(rpe);
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 0) {
      setError('Enter a weight of 0 or more and a whole number of reps.');
      return;
    }
    setError(null);
    const camera = useCamera && liveReps.length === r;
    try {
      await logSet({
        exercise, weight: w, unit, reps: r, rpe: p,
        source: camera ? 'camera' : 'manual',
        reps_detail: camera ? liveReps : [],
        confidence: null, model_version: camera ? 'reps-v1' : null,
      });
      setUseCamera(false);
      say(`${r} ${exerciseName(exercise)} logged.`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <Kicker>PUT IN THE WORK</Kicker>
      <Title>Live workout</Title>
      {!workout.active ? (
        <Card>
          <Text style={s.cardTitle}>Start a session</Text>
          <Text style={s.label}>Workout name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholderTextColor={C.muted} />
          <Button onPress={() => startWorkout(name.trim())}>Start session  ↗</Button>
        </Card>
      ) : (
        <Card>
          <Text style={s.cardTitle}>{workout.active.name}</Text>
          <Text style={s.body}>{workout.active.sets.length} sets logged</Text>
          <Choice title="Exercise" options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
          <View style={s.inputRow}>
            <View style={s.inputHalf}>
              <Text style={s.label}>Weight</Text>
              <TextInput style={s.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} />
            </View>
            <View style={s.inputHalf}>
              <Text style={s.label}>Reps</Text>
              <TextInput style={s.input} value={reps} onChangeText={(t) => { setReps(t); setUseCamera(false); }} keyboardType="number-pad" />
            </View>
          </View>
          <Choice title="Unit" options={[['lb', 'lb'], ['kg', 'kg']]} value={unit} onChange={setUnit} />
          <Choice title="Effort (RPE, optional)" options={RPE} value={rpe} onChange={setRpe} />
          {useCamera && liveReps.length ? <Text style={s.fine}>📷 {liveReps.length} camera-counted reps with timing will be saved.</Text> : null}
          <Button onPress={save}>Log set  ✓</Button>
          <Button onPress={finishWorkout} secondary>Finish workout</Button>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {notice ? <Text style={s.fine}>{notice}</Text> : null}
          {workout.active.sets.slice().reverse().map((x) => (
            <View key={x.id} style={s.set}>
              <Text style={s.rowText}>
                {exerciseName(x.exercise)} · {x.reps} reps × {x.weight} {x.unit}{x.rpe ? ` · RPE ${x.rpe}` : ''}{x.source === 'camera' ? ' · 📷' : ''}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <Kicker>LIVE REP COUNTER</Kicker>
        <Text style={s.cardTitle}>Camera counting</Text>
        <Text style={s.liveCount}>{liveReps.length}</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>
          {stationConnected ? `live from your Pi${station.movement ? ` · ${exerciseName(station.movement)}` : ''}` : online ? 'connecting to your Pi…' : 'connect to your Pi to count reps'}
        </Text>
        <Button secondary disabled={!online} onPress={() => Linking.openURL(pwaUrl(settings.server))}>Open camera counter  ↗</Button>
        <Text style={s.fine}>
          The camera counter runs in your phone's browser (curl, squat, shoulder press) and never uploads
          video. Reps it counts appear here and fill in the set above. The first time, accept the Pi's
          certificate warning.
        </Text>
      </Card>
    </>
  );
}
