// The started workout as a checklist: exercises from today's split with prescribed sets, target
// reps, rest and (when history supports it) weight already filled in. One tap on ✓ saves a set as
// prescribed; Edit saves what actually happened. Every tap is saved immediately (AppState).
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { loggedFor, prepareWorkout, setFromTap } from '../lib/prescription.js';
import { T, type } from '../theme.js';
import { Card, Icon } from './kit.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function SetRow({ ex, index, logged, onDone, onUndo }) {
  const [editing, setEditing] = useState(ex.needsWeight);
  const [reps, setReps] = useState(String(ex.target.reps));
  const [weight, setWeight] = useState(ex.target.weight != null ? String(ex.target.weight) : '');
  const label = `${ex.name} set ${index + 1}`;
  if (logged) {
    return (
      <View testID={`set-${ex.exercise}-${index}`} style={st.row}>
        <Icon name="check-circle" size={22} color={T.accent} />
        <Text style={[st.rowText, { color: T.text }]}>Set {index + 1} · {logged.reps} reps{logged.weight > 0 ? ` × ${logged.weight} ${logged.unit}` : ''}{logged.reps !== logged.target ? ` (target ${logged.target})` : ''}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Undo ${label}`} onPress={onUndo} style={st.small}><Text style={st.link}>Undo</Text></TouchableOpacity>
      </View>
    );
  }
  const edits = editing ? { reps: reps.trim() === '' ? undefined : Number(reps), weight: weight.trim() === '' ? undefined : Number(weight) } : {};
  const body = setFromTap(ex, index, edits);
  return (
    <View testID={`set-${ex.exercise}-${index}`}>
      <View style={st.row}>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: false, disabled: !body }} accessibilityLabel={`Complete ${label}`} disabled={!body} onPress={() => onDone(body)} style={[st.check, !body && { opacity: 0.35 }]}>
          <Icon name="checkbox-blank-outline" size={24} color={T.accentText} />
        </TouchableOpacity>
        <Text style={st.rowText}>Set {index + 1} · {ex.target.reps} reps{ex.bodyweight ? '' : ex.target.weight != null ? ` × ${ex.target.weight} ${ex.target.unit}` : ' · pick a weight'}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${editing ? 'Hide edit' : 'Edit'} ${label}`} onPress={() => setEditing(!editing)} style={st.small}><Text style={st.link}>{editing ? 'Hide' : 'Edit'}</Text></TouchableOpacity>
      </View>
      {editing ? (
        <View style={{ flexDirection: 'row', gap: 8, marginLeft: 40, marginBottom: 6 }}>
          <TextInput accessibilityLabel={`Actual reps for ${label}`} value={reps} onChangeText={setReps} keyboardType="number-pad" style={st.input} placeholder="reps" placeholderTextColor={T.textMute} />
          {ex.bodyweight ? null : <TextInput accessibilityLabel={`Weight for ${label}`} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={st.input} placeholder={ex.target.unit} placeholderTextColor={T.textMute} />}
        </View>
      ) : null}
    </View>
  );
}

export function WorkoutChecklist() {
  const { active, history, settings, logSet, deleteSet } = useApp();
  // Prepared once per workout so targets don't shift while you log sets.
  const prepared = useMemo(() => (active?.planned ? prepareWorkout(active.planned, { history, unit: settings.unit }) : null), [active?.id, history.length, settings.unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lastRest, setLastRest] = useState(null);
  if (!active) return null;
  if (!prepared?.exercises.length) return <Text style={type.body}>This workout has no planned exercises. Use “Log a set” to record sets.</Text>;
  const done = prepared.exercises.reduce((t, ex) => t + Math.min(ex.sets, loggedFor(active, ex.exercise).length), 0);
  const total = prepared.exercises.reduce((t, ex) => t + ex.sets, 0);
  return (
    <View testID="workout-checklist">
      <Text testID="checklist-progress" style={[type.small, { marginBottom: 8 }]}>{done} of {total} sets done · targets filled in from your plan{history.length ? ' and history' : ''}. Nothing is saved until you tick a set.</Text>
      {lastRest ? <Text style={[type.small, { color: T.accentText, marginBottom: 8 }]}>Rest about {mmss(lastRest)} before the next set.</Text> : null}
      {prepared.exercises.map((ex) => {
        const logged = loggedFor(active, ex.exercise);
        // After the first confirmed set, later sets default to the weight actually used.
        const lastWeight = logged.at(-1)?.weight;
        const rowEx = lastWeight != null && !ex.bodyweight ? { ...ex, target: { ...ex.target, weight: lastWeight }, needsWeight: false } : ex;
        return (
          <Card key={ex.exercise} testID={`exercise-${ex.exercise}`} style={{ marginBottom: 12 }}>
            <Text style={type.title}>{ex.name}</Text>
            <Text style={[type.small, { marginTop: 4 }]}>{ex.sets} × {ex.target.reps} reps (range {ex.target.reps_low}–{ex.target.reps_high}){ex.target.weight != null ? ` · ${ex.target.weight} ${ex.target.unit}` : ''} · rest {mmss(ex.target.rest_sec)}{ex.target.rpe_high ? ` · RPE ${ex.target.rpe_low}–${ex.target.rpe_high}` : ''}</Text>
            {ex.previous ? <Text style={type.small}>{ex.previous.text}</Text> : null}
            <Text style={[type.small, { color: T.textDim, marginTop: 2 }]}>{ex.recommendation.why}</Text>
            {Array.from({ length: ex.sets }, (_, i) => (
              <SetRow key={`${i}-${rowEx.target.weight ?? ''}`} ex={rowEx} index={i} logged={logged.find((s) => s.set_index === i)}
                onDone={(body) => { if (logSet(body)) setLastRest(ex.target.rest_sec); }}
                onUndo={() => { const s = logged.find((x) => x.set_index === i); if (s) deleteSet(s.id); }} />
            ))}
          </Card>
        );
      })}
    </View>
  );
}

const st = {
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  rowText: { color: T.textDim, fontSize: 14, flex: 1 },
  check: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  small: { minHeight: 40, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  link: { color: T.accentText, fontSize: 13, fontWeight: '600' },
  input: { color: T.text, borderWidth: 1, borderColor: T.border, borderRadius: 8, paddingHorizontal: 10, minHeight: 40, width: 90 },
};
