// Progress dashboard sections (Strength, Consistency, Volume, Performance,
// PRs), filters, and the workout editor. All numbers come from
// lib/analytics.js, derived from history on every render, so edits and
// deletes are always reflected. Measured values and estimates are labelled.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import {
  calendar,
  compareLatest,
  currentRecords,
  durationMin,
  frequency,
  liftSessions,
  periodVolume,
  recordHistory,
  volumeByLift,
  volumeByMuscle,
} from '../lib/analytics.js';
import { exerciseName } from '../lib/exercises.js';
import { MUSCLE_GROUPS } from '../lib/muscles.js';
import { streak, weeklyProgress } from '../lib/progress.js';
import { T, type } from '../theme.js';
import { BarChart, LineChart } from './Charts.js';
import { Card, Chips, Field, PrimaryButton, Sheet } from './kit.js';
import { EQUIPMENT } from './Sheets.js';

const DAY = 86400000;
export const RANGES = [['4w', '4 wk'], ['12w', '12 wk'], ['6m', '6 mo'], ['all', 'All']];
export const rangeFrom = (r, now = Date.now()) => ({ '4w': now - 28 * DAY, '12w': now - 84 * DAY, '6m': now - 182 * DAY }[r] ?? null);

const signed = (v, unit = '') => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}${unit ? ` ${unit}` : ''}`);
const fmt = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString());

export function Tag({ estimated }) {
  return (
    <Text style={{ fontSize: 10, color: estimated ? T.amber : T.green, borderColor: estimated ? T.amber : T.green, borderWidth: 1, borderRadius: 99, paddingHorizontal: 6, marginLeft: 6 }}>
      {estimated ? 'estimated' : 'measured'}
    </Text>
  );
}

function Row({ label, value, estimated }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: T.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        <Text style={type.body}>{label}</Text>
        {estimated !== undefined ? <Tag estimated={estimated} /> : null}
      </View>
      <Text style={[type.title, { fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

/** Lift / date range / program filters. */
export function Filters({ liftsList, lift, setLift, range, setRange, programs, program, setProgram, showLift = true }) {
  return (
    <Card style={{ marginTop: 14 }}>
      {showLift ? (
        liftsList.length ? (
          <>
            <Text style={[type.label, { marginBottom: 6 }]}>Lift</Text>
            <Chips options={liftsList.map((l) => [l.key, l.label])} value={lift} onChange={setLift} />
          </>
        ) : (
          <Text style={type.body}>Log a set to see lifts here.</Text>
        )
      ) : null}
      <Text style={[type.label, { marginVertical: 6 }]}>Date range</Text>
      <Chips options={RANGES} value={range} onChange={setRange} />
      {programs.length ? (
        <>
          <Text style={[type.label, { marginVertical: 6 }]}>Program</Text>
          <Chips options={[['', 'All'], ...programs.map((p) => [p, p])]} value={program} onChange={setProgram} />
        </>
      ) : null}
    </Card>
  );
}

// ---- Strength ---------------------------------------------------------------------

const RECORD_TEXT = {
  heaviest: (e) => `Heaviest: ${e.weight} ${e.unit} × ${e.reps}`,
  reps_at_weight: (e) => `Most reps at ${e.weight} ${e.unit}: ${e.reps}`,
  session_volume: (e) => `Session volume: ${fmt(e.value)} ${e.unit}`,
  e1rm: (e) => `Est. 1RM: ${e.value} ${e.unit} (from ${e.weight} × ${e.reps})`,
};

export function StrengthView({ workouts, lift, unit }) {
  const sessions = useMemo(() => (lift ? liftSessions(workouts, lift, unit) : []), [workouts, lift, unit]);
  const events = useMemo(() => recordHistory(workouts, unit).filter((e) => e.lift === lift && !e.first), [workouts, lift, unit]);
  if (!lift) return null;
  const loaded = sessions.filter((s) => !s.bodyweight);
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        {loaded.length ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={type.title}>Top weight per session ({unit})</Text><Tag /></View>
            <LineChart points={loaded.slice(-10).map((s) => ({ label: s.date.slice(5), value: s.topWeight }))} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}><Text style={type.title}>Best estimated 1RM ({unit})</Text><Tag estimated /></View>
            <LineChart points={loaded.filter((s) => s.bestE1RM !== null).slice(-10).map((s) => ({ label: s.date.slice(5), value: s.bestE1RM }))} />
            <Text style={type.small}>Epley formula, from sets of 10 reps or fewer. An estimate, not a tested max. Never max out from it.</Text>
          </>
        ) : (
          <Text style={type.body}>{sessions.length ? 'Bodyweight only: see reps under Performance.' : 'No sessions in this range.'}</Text>
        )}
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Text style={type.title}>Personal record history</Text>
        {!events.length ? <Text style={[type.body, { marginTop: 6 }]}>No records beaten in this range yet.</Text> : null}
        {events.slice(-10).reverse().map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <Text style={[type.small, { width: 76 }]}>{e.date}</Text>
            <Text style={[type.body, { flexShrink: 1 }]}>🏆 {RECORD_TEXT[e.type](e)}</Text>
            <Tag estimated={e.source === 'estimated'} />
          </View>
        ))}
      </Card>
    </>
  );
}

// ---- Consistency -------------------------------------------------------------------

function Calendar({ workouts }) {
  const now = new Date();
  const [offset, setOffset] = useState(0);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const month = d.toISOString().slice(0, 7);
  const days = calendar(workouts, month);
  const lead = (d.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <TouchableOpacity onPress={() => setOffset((o) => o - 1)}><Text style={type.title}>‹</Text></TouchableOpacity>
        <Text style={type.title}>{d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Text>
        <TouchableOpacity disabled={offset >= 0} onPress={() => setOffset((o) => o + 1)}><Text style={[type.title, offset >= 0 && { opacity: 0.3 }]}>›</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => (
          <Text key={`h${i}`} style={[type.small, { width: `${100 / 7}%`, textAlign: 'center' }]}>{x}</Text>
        ))}
        {cells.map((n, i) => {
          const key = n ? `${month}-${String(n).padStart(2, '0')}` : null;
          const on = key && days[key];
          return (
            <View key={i} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 }}>
              {n ? (
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? T.purpleSoft : 'transparent', borderWidth: on ? 1 : 0, borderColor: T.purple }}>
                  <Text style={{ color: on ? T.text : T.textMute, fontSize: 12 }}>{n}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function ConsistencyView({ workouts, allWorkouts, from, goal }) {
  const start = from ?? Math.min(Date.now() - 28 * DAY, ...allWorkouts.map((w) => new Date(w.startedAt).getTime()));
  const f = useMemo(() => frequency(workouts, start), [workouts, start]);
  const week = weeklyProgress(allWorkouts, goal);
  const durations = workouts.map(durationMin).filter((m) => m !== null);
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Text style={type.title}>Workouts per week</Text>
        <Text style={type.body}>{f.perWeek} per week on average · this week {week.done} / {week.goal}</Text>
        <BarChart points={f.weeks.slice(-8).map((w) => ({ label: w.label, value: w.workouts }))} caption="workouts per week (Mon–Sun)" />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Row label="Current streak (weeks with a workout)" value={String(streak(allWorkouts))} />
        <Row label="Workouts in range" value={String(workouts.length)} />
        <Row label="Average duration" value={durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)} min` : '—'} />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Calendar workouts={allWorkouts} />
      </Card>
    </>
  );
}

// ---- Volume ----------------------------------------------------------------------

export function VolumeView({ workouts, unit, from }) {
  const [period, setPeriod] = useState('week');
  const start = from ?? Math.min(Date.now() - 28 * DAY, ...workouts.map((w) => new Date(w.startedAt).getTime()));
  const series = useMemo(() => periodVolume(workouts, unit, period, start), [workouts, unit, period, start]);
  const byLift = useMemo(() => volumeByLift(workouts, unit), [workouts, unit]);
  const byMuscle = useMemo(() => volumeByMuscle(workouts, unit), [workouts, unit]);
  const maxSets = Math.max(1, ...byMuscle.map((m) => m.sets));
  const name = (id) => MUSCLE_GROUPS.find((g) => g.id === id)?.name ?? id;
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Chips options={[['week', 'Weekly'], ['month', 'Monthly']]} value={period} onChange={setPeriod} />
        <BarChart
          points={series.slice(period === 'week' ? -8 : -6).map((v) => ({ label: period === 'week' ? v.label : v.label.slice(2), value: v.volume }))}
          caption={`${unit} × reps per ${period} (completed, loaded sets)`}
        />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Text style={type.title}>By lift</Text>
        {!byLift.length ? <Text style={type.body}>Nothing in this range.</Text> : null}
        {byLift.map((l) => (
          <Row key={l.key} label={l.label} value={l.volume ? `${fmt(l.volume)} ${unit}` : `${l.reps} reps (bodyweight)`} />
        ))}
      </Card>
      <Card style={{ marginTop: 12 }}>
        <Text style={type.title}>By muscle group</Text>
        {byMuscle.map((m) => (
          <View key={m.muscle} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={type.body}>{name(m.muscle)}</Text>
              <Text style={type.small}>{m.sets} sets · {fmt(m.volume)} {unit}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: T.border, marginTop: 4 }}>
              <View style={{ height: 6, borderRadius: 3, width: `${(m.sets / maxSets) * 100}%`, backgroundColor: T.purple }} />
            </View>
          </View>
        ))}
        <Text style={[type.small, { marginTop: 10 }]}>
          How it's counted: each set counts fully for the lift's main muscles and half for its helpers (e.g. bench: chest 1, shoulders and triceps ½). A relative training-load guide, not a measure of how hard each muscle worked.
        </Text>
      </Card>
    </>
  );
}

// ---- Performance ---------------------------------------------------------------------

export function PerformanceView({ workouts, lift, unit }) {
  const sessions = useMemo(() => (lift ? liftSessions(workouts, lift, unit) : []), [workouts, lift, unit]);
  const cmp = useMemo(() => (lift ? compareLatest(workouts, lift, unit) : null), [workouts, lift, unit]);
  if (!lift) return null;
  const last = sessions[sessions.length - 1];
  const tuts = sessions.filter((s) => s.avgTutMs !== null);
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Text style={type.title}>Reps per session</Text>
        <LineChart points={sessions.slice(-10).map((s) => ({ label: s.date.slice(5), value: s.reps }))} />
        {sessions.some((s) => !s.bodyweight) ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}><Text style={type.title}>Average weight per rep ({unit})</Text><Tag /></View>
            <LineChart points={sessions.filter((s) => !s.bodyweight).slice(-10).map((s) => ({ label: s.date.slice(5), value: s.avgWeightPerRep }))} />
          </>
        ) : null}
      </Card>
      {last ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={type.title}>Latest session ({last.date})</Text>
          <Row label="Sets completed" value={`${last.completedSets} / ${last.sets}${last.plannedSets ? ` (planned ${last.plannedSets})` : ''}`} estimated={false} />
          <Row label="Reps" value={String(last.reps)} estimated={false} />
          {!last.bodyweight ? <Row label="Top weight" value={`${last.topWeight} ${unit}`} estimated={false} /> : null}
          {!last.bodyweight ? <Row label="Volume" value={`${fmt(last.volume)} ${unit}`} estimated={false} /> : null}
          {last.bestE1RM !== null ? <Row label="Best est. 1RM" value={`${last.bestE1RM} ${unit}`} estimated /> : null}
          {last.avgTutMs !== null ? <Row label="Camera rep time (TUT)" value={`${(last.avgTutMs / 1000).toFixed(1)} s`} estimated /> : null}
        </Card>
      ) : null}
      <Card style={{ marginTop: 12 }}>
        <Text style={type.title}>Vs. previous session</Text>
        {!cmp ? (
          <Text style={[type.body, { marginTop: 6 }]}>Needs two sessions of this lift.</Text>
        ) : (
          <>
            <Text style={type.small}>{cmp.previous.date} → {cmp.latest.date}</Text>
            <Row label="Top weight" value={signed(cmp.change.topWeight, unit)} />
            <Row label="Volume" value={signed(cmp.change.volume === null ? null : Math.round(cmp.change.volume), unit)} />
            <Row label="Reps" value={signed(cmp.change.reps)} />
            <Row label="Best est. 1RM" value={signed(cmp.change.bestE1RM, unit)} estimated />
          </>
        )}
      </Card>
      {tuts.length ? (
        <Text style={[type.small, { marginTop: 8 }]}>
          Camera sets: rep counts are what you confirmed when ending the set. Rep timing (TUT) is estimated from movement and isn't used for records.
        </Text>
      ) : null}
    </>
  );
}

// ---- PRs -----------------------------------------------------------------------------

export function RecordsView({ workouts, unit }) {
  const recs = useMemo(() => currentRecords(workouts, unit), [workouts, unit]);
  if (!recs.length) return <Card style={{ marginTop: 14 }}><Text style={type.body}>Your personal records will show up here.</Text></Card>;
  return (
    <>
      {recs.map((r) => {
        const atWeight = Object.values(r.repsAtWeight ?? {}).sort((a, b) => b.weight - a.weight).slice(0, 3);
        return (
          <Card key={r.lift} style={{ marginTop: 12 }}>
            <Text style={type.title}>🏆 {r.label}</Text>
            {r.heaviest ? <Row label="Heaviest" value={`${r.heaviest.weight} ${unit} × ${r.heaviest.reps}`} estimated={false} /> : null}
            {r.session_volume ? <Row label="Best session volume" value={`${fmt(r.session_volume.value)} ${unit}`} estimated={false} /> : null}
            {atWeight.map((e) => <Row key={e.weight} label={`Most reps at ${e.weight} ${unit}`} value={String(e.reps)} estimated={false} />)}
            {r.e1rm ? <Row label="Best est. 1RM" value={`${r.e1rm.value} ${unit}`} estimated /> : null}
            <Text style={type.small}>Set {r.heaviest?.date ?? r.e1rm?.date}. Recalculated from your history whenever you edit or delete.</Text>
          </Card>
        );
      })}
    </>
  );
}

// ---- Workout editor --------------------------------------------------------------------

function SetEditor({ workoutId, s, onDone }) {
  const { updateSet, removeSet } = useApp();
  const [weight, setWeight] = useState(String(s.weight));
  const [reps, setReps] = useState(String(s.reps));
  const [unit, setUnit] = useState(s.unit);
  const [rpe, setRpe] = useState(s.rpe == null ? '' : String(s.rpe));
  const [rest, setRest] = useState(s.restSec == null ? '' : String(s.restSec));
  const [variation, setVariation] = useState(s.variation ?? '');
  const [equipment, setEquipment] = useState(s.equipment ?? '');
  const [notes, setNotes] = useState(s.notes ?? '');
  const [completed, setCompleted] = useState(s.completed !== false);
  const [error, setError] = useState(null);
  const save = () => {
    const w = Number(weight);
    const r = Number(reps);
    const p = rpe === '' ? null : Number(rpe);
    const rs = rest === '' ? null : Number(rest);
    if (!(w >= 0) || !Number.isInteger(r) || r < 0) return setError('Weight must be 0 or more; reps a whole number.');
    if (p !== null && !(p >= 1 && p <= 10)) return setError('RPE is 1–10.');
    if (rs !== null && !(rs >= 0)) return setError('Rest is seconds, 0 or more.');
    updateSet(workoutId, s.id, {
      weight: w, reps: r, unit, rpe: p, restSec: rs, completed,
      variation: variation.trim() || undefined, equipment: equipment || undefined, notes: notes.trim() || undefined,
    });
    onDone();
  };
  return (
    <Card style={{ marginTop: 8, borderColor: T.purple }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        <Field label="Reps" value={reps} onChangeText={setReps} keyboardType="number-pad" />
      </View>
      <View style={{ marginTop: 8 }}><Chips options={[['lb', 'lb'], ['kg', 'kg']]} value={unit} onChange={setUnit} /></View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <Field label="RPE (1–10)" value={rpe} onChangeText={setRpe} keyboardType="decimal-pad" />
        <Field label="Rest before (s)" value={rest} onChangeText={setRest} keyboardType="number-pad" />
      </View>
      <Text style={[type.label, { marginVertical: 6 }]}>Equipment</Text>
      <Chips options={EQUIPMENT} value={equipment} onChange={(v) => setEquipment(v === equipment ? '' : v)} />
      <View style={{ marginTop: 8 }}><Field label="Variation" value={variation} onChangeText={setVariation} /></View>
      <View style={{ marginTop: 8 }}><Field label="Notes" value={notes} onChangeText={setNotes} /></View>
      <View style={{ marginTop: 8 }}><Chips options={[[true, 'Completed'], [false, 'Not completed']]} value={completed} onChange={setCompleted} /></View>
      {error ? <Text style={{ color: T.red, marginTop: 6 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrimaryButton style={{ flex: 1 }} onPress={save}>Save</PrimaryButton>
        <PrimaryButton secondary style={{ flex: 1 }} onPress={onDone}>Cancel</PrimaryButton>
      </View>
      <PrimaryButton
        secondary
        onPress={() =>
          Alert.alert('Delete this set?', "Records and stats will be recalculated. This can't be undone.", [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { removeSet(workoutId, s.id); onDone(); } },
          ])
        }
      >
        Delete set
      </PrimaryButton>
    </Card>
  );
}

/** Edit a finished workout: its name and notes, and any of its sets. */
export function EditWorkoutSheet({ workoutId, onClose }) {
  const { history, updateWorkout, deleteWorkout } = useApp();
  const w = history.find((x) => x.id === workoutId);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    setName(w?.name ?? '');
    setNotes(w?.notes ?? '');
    setEditing(null);
  }, [workoutId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <Sheet visible={false} onClose={onClose} title="Edit workout" />;
  return (
    <Sheet visible onClose={onClose} title="Edit workout">
      <Field label="Name" value={name} onChangeText={setName} onEndEditing={() => updateWorkout(w.id, { name: name.trim() || w.name })} onBlur={() => updateWorkout(w.id, { name: name.trim() || w.name })} />
      <View style={{ marginTop: 10 }}>
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline onBlur={() => updateWorkout(w.id, { notes: notes.trim() || undefined })} />
      </View>
      <Text style={[type.small, { marginTop: 6 }]}>{new Date(w.startedAt).toLocaleString()}{durationMin(w) !== null ? ` · ${durationMin(w)} min` : ''}{w.program ? ` · ${w.program}` : ''}</Text>
      <Text style={[type.label, { marginTop: 14 }]}>Sets (tap to edit)</Text>
      {w.sets.map((s) =>
        editing === s.id ? (
          <SetEditor key={s.id} workoutId={w.id} s={s} onDone={() => setEditing(null)} />
        ) : (
          <TouchableOpacity key={s.id} onPress={() => setEditing(s.id)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border }}>
            <Text style={type.body}>
              {s.completed === false ? '✗ ' : ''}{exerciseName(s.exercise)} · {s.reps} × {s.weight} {s.unit}{s.rpe ? ` · RPE ${s.rpe}` : ''}{s.variation ? ` · ${s.variation}` : ''}{s.equipment ? ` · ${s.equipment}` : ''}
            </Text>
          </TouchableOpacity>
        ),
      )}
      <PrimaryButton
        secondary
        onPress={() =>
          Alert.alert('Delete this workout?', `${w.name}, ${w.sets.length} sets. This can't be undone.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { deleteWorkout(w.id); onClose(); } },
          ])
        }
      >
        Delete workout
      </PrimaryButton>
    </Sheet>
  );
}
