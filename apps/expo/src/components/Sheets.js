import React, { useEffect, useState } from 'react';
import { Alert, Keyboard, Share, Text, TouchableOpacity, Vibration, View } from 'react-native';

import { useApp } from '../AppState.js';
import { recordSetIds } from '../lib/analytics.js';
import { restSeconds } from '../lib/rest.js';
import { suggestNext } from '../lib/coach.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { streak, weeklyProgress } from '../lib/progress.js';
import { plateBreakdown } from '../lib/tools.js';
import { T, type } from '../theme.js';
import { Card, Chips, Field, Icon, PrimaryButton, Sheet } from './kit.js';

const BARBELL = new Set(['squat', 'bench', 'deadlift', 'shoulder_press']);
const RPE = [['', '–'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10']];
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function RestTimer({ seconds, onDone }) {
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
    <Card style={{ alignItems: 'center', marginTop: 14 }}>
      <Text style={type.label}>REST</Text>
      <Text style={{ color: T.text, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{clock(Math.max(0, left))}</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
        <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setLeft((l) => l + 30)}>+30s</PrimaryButton>
        <PrimaryButton secondary style={{ flex: 1 }} onPress={onDone}>Skip</PrimaryButton>
      </View>
    </Card>
  );
}

/**
 * Log one set. `initial` can prefill exercise/reps/weight; `camera` attaches counted reps
 * ({ movement, reps: reps_detail[] }) when the rep count is left unchanged.
 */
export function LogSetSheet({ visible, onClose, initial, camera }) {
  const { settings, allSets, logSet, say } = useApp();
  const [exercise, setExercise] = useState('bench');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(settings.unit);
  const [reps, setReps] = useState('8');
  const [rpe, setRpe] = useState('');
  const [more, setMore] = useState(false);
  const [variation, setVariation] = useState('');
  const [equipment, setEquipment] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setSaved(null);
    setError(null);
    setNotes('');
    setUnit(initial?.unit ?? settings.unit);
    if (initial?.exercise) setExercise(initial.exercise);
    if (initial?.reps !== undefined) setReps(String(initial.reps));
    if (initial?.weight !== undefined) setWeight(String(initial.weight));
  }, [visible, initial, settings.unit]);

  const hint = suggestNext(allSets.filter((x) => x.exercise === exercise && x.unit === unit));
  const plates = BARBELL.has(exercise) && Number(weight) > 0 ? plateBreakdown(Number(weight), unit) : undefined;

  const save = () => {
    const w = Number(weight || 0);
    const r = Number(reps);
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 0) {
      setError('Enter a weight of 0 or more and a whole number of reps.');
      return;
    }
    const fromCamera = Boolean(camera && camera.movement === exercise && camera.reps.length === r);
    const { isPR } = logSet({
      exercise, weight: w, unit, reps: r, rpe: rpe === '' ? null : Number(rpe),
      source: fromCamera ? 'camera' : initial?.source ?? 'manual',
      reps_detail: fromCamera ? camera.reps : [],
      // Optional details. Different variations or equipment are tracked as different lifts.
      variation: variation.trim() || undefined,
      equipment: equipment || undefined,
      notes: notes.trim() || undefined,
    });
    say(isPR ? `New record! ${r} ${exerciseName(exercise)}.` : `${r} ${exerciseName(exercise)} logged.`);
    setSaved({ isPR, text: `${exerciseName(exercise)} · ${r} × ${w} ${unit}` });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Log a set">
      {saved ? (
        <>
          <Card style={{ borderColor: saved.isPR ? T.green : T.border }}>
            <Text style={type.title}>{saved.isPR ? '🏆 New personal record' : 'Set saved'}</Text>
            <Text style={type.body}>{saved.text}</Text>
          </Card>
          <RestTimer seconds={restSeconds(exercise, Number(reps))} onDone={onClose} />
        </>
      ) : (
        <>
          <Text style={[type.label, { marginBottom: 8 }]}>Exercise</Text>
          <Chips options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
          {hint ? (
            <TouchableOpacity onPress={() => { setWeight(String(hint.weight)); setReps(String(hint.reps)); }} style={{ marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Icon name="lightning-bolt" size={16} color={T.purple} />
              <Text style={[type.small, { color: T.violetText }]}>Jim suggests {hint.weight} {hint.unit} × {hint.reps}. Tap to use.</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
            <Field label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="0" />
            <Field label="Reps" value={reps} onChangeText={setReps} keyboardType="number-pad" />
          </View>
          {plates === null ? <Text style={[type.small, { marginTop: 6 }]}>Lighter than an empty bar.</Text> : null}
          {plates ? (
            <Text style={[type.small, { marginTop: 6 }]}>
              Per side on a {plates.bar} {unit} bar: {plates.perSide.join(' + ') || 'nothing'}{plates.remainder ? ` (${plates.remainder} ${unit} can't be loaded)` : ''}
            </Text>
          ) : null}
          <Text style={[type.label, { marginVertical: 8 }]}>Unit</Text>
          <Chips options={[['lb', 'lb'], ['kg', 'kg']]} value={unit} onChange={setUnit} />
          <Text style={[type.label, { marginVertical: 8 }]}>Effort (RPE)</Text>
          <Chips options={RPE} value={rpe} onChange={setRpe} />
          <TouchableOpacity onPress={() => setMore((m) => !m)} style={{ marginTop: 12 }}>
            <Text style={[type.small, { color: T.violetText }]}>{more ? '▾' : '▸'} Variation, equipment, notes (optional)</Text>
          </TouchableOpacity>
          {more ? (
            <>
              <Text style={[type.label, { marginVertical: 8 }]}>Equipment</Text>
              <Chips options={EQUIPMENT} value={equipment} onChange={(v) => setEquipment(v === equipment ? '' : v)} />
              <View style={{ marginTop: 10 }}>
                <Field label="Variation (e.g. paused, incline)" value={variation} onChangeText={setVariation} />
              </View>
              <View style={{ marginTop: 10 }}>
                <Field label="Notes" value={notes} onChangeText={setNotes} />
              </View>
              <Text style={[type.small, { marginTop: 6 }]}>A different variation or equipment is tracked as its own lift, so progress is never compared across set-ups.</Text>
            </>
          ) : null}
          {camera && camera.movement === exercise ? (
            <Text style={[type.small, { marginTop: 10 }]}>📷 {camera.reps.length} camera-counted reps with timing attached.</Text>
          ) : null}
          {error ? <Text style={{ color: T.red, marginTop: 10 }}>{error}</Text> : null}
          <PrimaryButton onPress={save}>Save set</PrimaryButton>
        </>
      )}
    </Sheet>
  );
}

export const EQUIPMENT = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbell'], ['machine', 'Machine'], ['cable', 'Cable'], ['bodyweight', 'Bodyweight'], ['other', 'Other']];

const TONES = [['direct', 'Direct'], ['friendly', 'Friendly'], ['silly', 'Silly'], ['hard', 'Hard']];

/** The bell: what happened lately, plus settings and data controls. */
export function ActivitySheet({ visible, onClose }) {
  const { settings, update, history, allSets, exportJSON, eraseAll, importData } = useApp();
  const [pasted, setPasted] = useState('');
  const [msg, setMsg] = useState(null);
  const week = weeklyProgress(history, settings.weeklyGoal);
  // Records are recomputed from history, so they're right after edits and deletes.
  const recordIds = recordSetIds(history);
  const prs = allSets.filter((s) => recordIds.has(s.id)).slice(-3).reverse();

  const restore = () => {
    Keyboard.dismiss();
    try {
      const n = importData(pasted);
      setMsg(n ? `Restored ${n} workout${n === 1 ? '' : 's'}.` : 'Nothing new to restore.');
      setPasted('');
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Activity">
      <Card>
        <Text style={type.title}>{week.done >= week.goal ? 'Weekly goal hit 💪' : `${week.goal - week.done} workout${week.goal - week.done === 1 ? '' : 's'} left this week`}</Text>
        <Text style={type.body}>{streak(history)}-week streak · {week.done}/{week.goal} this week</Text>
      </Card>
      {prs.map((s) => (
        <Card key={s.id} style={{ marginTop: 10 }}>
          <Text style={type.title}>🏆 {exerciseName(s.exercise)}</Text>
          <Text style={type.body}>{s.reps} × {s.weight} {s.unit}</Text>
        </Card>
      ))}

      <Text style={[type.h2, { marginTop: 24, marginBottom: 6 }]}>Settings</Text>
      <Text style={[type.label, { marginVertical: 8 }]}>Jim's tone</Text>
      <Chips options={TONES} value={settings.tone} onChange={(tone) => update({ tone })} />
      <Text style={[type.label, { marginVertical: 8 }]}>Spoken replies</Text>
      <Chips options={[[true, 'On'], [false, 'Off']]} value={settings.speak} onChange={(speak) => update({ speak })} />
      <Text style={[type.label, { marginVertical: 8 }]}>Units</Text>
      <Chips options={[['lb', 'lb'], ['kg', 'kg']]} value={settings.unit} onChange={(unit) => update({ unit })} />
      <Text style={[type.label, { marginVertical: 8 }]}>Weekly goal</Text>
      <Chips options={[1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])} value={settings.weeklyGoal} onChange={(weeklyGoal) => update({ weeklyGoal })} />

      <Text style={[type.h2, { marginTop: 24 }]}>Your data</Text>
      <Text style={type.body}>{history.length} workouts on this phone. Nothing is uploaded.</Text>
      <PrimaryButton secondary onPress={() => Share.share({ message: exportJSON(), title: 'JimBro workouts' })}>Export workouts</PrimaryButton>
      <View style={{ marginTop: 12 }}>
        <Field value={pasted} onChangeText={setPasted} multiline autoCorrect={false} autoCapitalize="none" placeholder="Paste an export here to restore" style={{ height: 100, textAlignVertical: 'top' }} />
      </View>
      <PrimaryButton secondary disabled={!pasted.trim()} onPress={restore}>Restore</PrimaryButton>
      {msg ? <Text style={[type.small, { marginTop: 8 }]}>{msg}</Text> : null}
      <PrimaryButton
        secondary
        onPress={() => Alert.alert('Erase all workouts?', 'Export first if you want a copy.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Erase', style: 'destructive', onPress: eraseAll },
        ])}
      >
        Erase all workouts
      </PrimaryButton>
      <Text style={[type.small, { marginTop: 14 }]}>Not a medical device. TUT is estimated movement timing, not muscle tension.</Text>
    </Sheet>
  );
}
