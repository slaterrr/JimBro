import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';

import { useApp } from '../AppState.js';
import { suggestNext } from '../lib/coach.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { Button, C, Card, Choice, Kicker, Title, s } from '../ui.js';

const RPE = [['', '–'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10']];
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function RestTimer({ seconds, onDone }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      Vibration.vibrate(400);
      onDone();
    }
  }, [left, onDone]);
  return (
    <Card>
      <Kicker>REST</Kicker>
      <Text style={s.liveCount}>{clock(Math.max(0, left))}</Text>
      <View style={s.inputRow}>
        <View style={s.inputHalf}><Button secondary onPress={() => setLeft((l) => l + 30)}>+30s</Button></View>
        <View style={s.inputHalf}><Button secondary onPress={onDone}>Skip</Button></View>
      </View>
    </Card>
  );
}

export function WorkoutScreen({ prefill, clearPrefill, cameraReps, clearCameraReps, openCamera }) {
  const { settings, active, allSets, startWorkout, logSet, deleteSet, finishWorkout, say } = useApp();
  const [name, setName] = useState('Strength session');
  const [exercise, setExercise] = useState('curl');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(settings.unit);
  const [reps, setReps] = useState('8');
  const [rpe, setRpe] = useState('');
  const [resting, setResting] = useState(false);
  const [celebrate, setCelebrate] = useState(null);
  const [error, setError] = useState(null);
  const restKey = useRef(0);

  useEffect(() => {
    if (!prefill) return;
    setExercise(prefill.exercise);
    if (prefill.weight !== undefined) setWeight(String(prefill.weight));
    if (prefill.unit) setUnit(prefill.unit);
    if (prefill.reps !== undefined) setReps(String(prefill.reps));
    clearPrefill();
  }, [prefill, clearPrefill]);

  useEffect(() => {
    if (!cameraReps) return;
    setExercise(cameraReps.movement);
    setReps(String(cameraReps.reps.length));
  }, [cameraReps]);

  const last = suggestNext(allSets.filter((x) => x.exercise === exercise && x.unit === unit));

  const save = () => {
    const w = Number(weight || 0);
    const r = Number(reps);
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 0) {
      setError('Enter a weight of 0 or more and a whole number of reps.');
      return;
    }
    setError(null);
    const fromCamera = Boolean(cameraReps && cameraReps.movement === exercise && cameraReps.reps.length === r);
    const { isPR } = logSet({
      exercise, weight: w, unit, reps: r, rpe: rpe === '' ? null : Number(rpe),
      source: fromCamera ? 'camera' : 'manual',
      reps_detail: fromCamera ? cameraReps.reps : [],
    }, name.trim());
    if (fromCamera) clearCameraReps();
    setCelebrate(isPR ? `New record: ${exerciseName(exercise)} ${w} ${unit} × ${r}` : null);
    say(isPR ? `New record! ${r} ${exerciseName(exercise)}.` : `${r} ${exerciseName(exercise)} logged.`);
    restKey.current += 1;
    setResting(true);
  };

  const planned = active?.planned?.items ?? [];

  return (
    <>
      <Kicker>PUT IN THE WORK</Kicker>
      <Title>Live workout</Title>
      {!active ? (
        <Card>
          <Text style={s.cardTitle}>Start a session</Text>
          <Text style={s.label}>Workout name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholderTextColor={C.muted} />
          <Button onPress={() => startWorkout(name.trim())}>Start session  ↗</Button>
          <Text style={s.fine}>Or start a day from your plan in the Plan tab. Logging a set also starts a session.</Text>
        </Card>
      ) : null}

      {resting ? <RestTimer key={restKey.current} seconds={settings.restSeconds} onDone={() => setResting(false)} /> : null}
      {celebrate ? (
        <Card style={{ borderColor: C.green }}>
          <Text style={s.cardTitle}>🏆 {celebrate}</Text>
        </Card>
      ) : null}

      <Card>
        <Text style={s.cardTitle}>{active ? active.name : 'Log a set'}</Text>
        {planned.length ? (
          <View style={s.field}>
            <Text style={s.label}>Today's plan</Text>
            {planned.map((i) => {
              const done = (active?.sets ?? []).filter((x) => x.exercise === i.exercise).length;
              return (
                <TouchableOpacity key={i.exercise} onPress={() => { setExercise(i.exercise); setReps(String(i.reps_high)); }}>
                  <Text style={[s.rowText, done >= i.sets && { color: C.green }]}>
                    {done >= i.sets ? '✓' : '○'} {exerciseName(i.exercise)} · {done}/{i.sets} sets of {i.reps_low}–{i.reps_high}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
        <Choice title="Exercise" options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
        {last ? (
          <TouchableOpacity onPress={() => { setWeight(String(last.weight)); setReps(String(last.reps)); }}>
            <Text style={s.fine}>Jim suggests {last.weight} {last.unit} × {last.reps}. Tap to use.</Text>
          </TouchableOpacity>
        ) : null}
        <View style={s.inputRow}>
          <View style={s.inputHalf}>
            <Text style={s.label}>Weight</Text>
            <TextInput style={s.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} />
          </View>
          <View style={s.inputHalf}>
            <Text style={s.label}>Reps</Text>
            <TextInput style={s.input} value={reps} onChangeText={(t) => { setReps(t); }} keyboardType="number-pad" />
          </View>
        </View>
        <Choice title="Unit" options={[['lb', 'lb'], ['kg', 'kg']]} value={unit} onChange={setUnit} />
        <Choice title="Effort (RPE, optional)" options={RPE} value={rpe} onChange={setRpe} />
        {cameraReps && cameraReps.movement === exercise ? (
          <Text style={s.fine}>📷 {cameraReps.reps.length} camera-counted reps with timing will be saved.</Text>
        ) : null}
        <Button onPress={save}>Log set  ✓</Button>
        {openCamera && EXERCISES.find((e) => e.id === exercise)?.camera ? (
          <Button secondary onPress={() => openCamera(exercise)}>Count reps with camera  📷</Button>
        ) : null}
        {active ? <Button onPress={finishWorkout} secondary>Finish workout</Button> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {(active?.sets ?? []).slice().reverse().map((x) => (
          <View key={x.id} style={[s.set, { flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Text style={[s.rowText, { flex: 1 }]}>
              {x.pr ? '🏆 ' : ''}{exerciseName(x.exercise)} · {x.reps} × {x.weight} {x.unit}{x.rpe ? ` · RPE ${x.rpe}` : ''}{x.source === 'camera' ? ' · 📷' : ''}
            </Text>
            <TouchableOpacity accessibilityLabel="Delete set" onPress={() => deleteSet(x.id)}>
              <Text style={[s.rowText, { color: C.muted }]}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      </Card>
    </>
  );
}
