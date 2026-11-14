import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Comparisons } from '../components/Comparisons.js';
import {
  ConsistencyView,
  EditWorkoutSheet,
  Filters,
  PerformanceView,
  RecordsView,
  StrengthView,
  VolumeView,
  rangeFrom,
} from '../components/ProgressViews.js';
import { durationMin, filterWorkouts, lifts, recordSetIds } from '../lib/analytics.js';
import { useApp } from '../AppState.js';
import { LineChart } from '../components/Charts.js';
import { Card, Chips, Icon, PrimaryButton } from '../components/kit.js';
import { exerciseName } from '../lib/exercises.js';
import { overview } from '../lib/stats.js';
import { repeatPlan } from '../lib/tools.js';
import { T, type } from '../theme.js';

const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

function Tile({ icon, title, value, sub }) {
  return (
    <Card style={st.tile}>
      <Icon name={icon} size={24} color={T.purple} />
      <Text style={[type.label, { color: T.text, marginTop: 6 }]}>{title}</Text>
      <Text style={type.statGreen}>{value}</Text>
      {sub ? <Text style={type.small}>{sub}</Text> : null}
    </Card>
  );
}

function HistoryItem({ workout, records, canRepeat, onRepeat, onDelete, onEdit }) {
  const [open, setOpen] = useState(false);
  const volume = workout.sets.filter((x) => x.completed !== false).reduce((t, x) => t + x.weight * x.reps, 0);
  const minutes = durationMin(workout);
  return (
    <Card style={{ marginTop: 10 }}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={type.title}>{workout.name}</Text>
          <Text style={type.small}>
            {new Date(workout.startedAt).toLocaleDateString()} · {workout.sets.length} sets · volume {Math.round(volume)}
            {minutes !== null ? ` · ${minutes} min` : ''}{workout.program ? ` · ${workout.program}` : ''}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={T.textDim} />
      </TouchableOpacity>
      {open ? (
        <>
          {workout.notes ? <Text style={[type.small, { marginTop: 6 }]}>📝 {workout.notes}</Text> : null}
          {workout.sets.map((x) => (
            <View key={x.id} style={{ marginTop: 6 }}>
              <Text style={type.body}>
                {records.has(x.id) ? '🏆 ' : ''}{x.completed === false ? '✗ ' : ''}{exerciseName(x.exercise)}
                {x.variation ? ` (${x.variation})` : ''}{x.equipment ? ` · ${x.equipment}` : ''} · {x.reps} × {x.weight} {x.unit}
                {x.rpe ? ` · RPE ${x.rpe}` : ''}{x.restSec ? ` · rest ${x.restSec}s` : ''}{x.source === 'camera' ? ' · 📷' : ''}
              </Text>
              {x.source === 'camera' && x.reps_detail?.length ? (
                <Text style={type.small}>
                  📷 camera-counted · est. {(x.reps_detail.reduce((t, r) => t + r.concentric_ms + r.peak_pause_ms + r.eccentric_ms, 0) / x.reps_detail.length / 1000).toFixed(1)} s per rep (estimated)
                </Text>
              ) : null}
              {x.notes ? <Text style={type.small}>📝 {x.notes}</Text> : null}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PrimaryButton secondary style={{ flex: 1 }} disabled={!canRepeat} onPress={onRepeat}>Repeat</PrimaryButton>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={onEdit}>Edit</PrimaryButton>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={onDelete}>Delete</PrimaryButton>
          </View>
        </>
      ) : null}
    </Card>
  );
}

export function ProgressScreen({ go, initialTab = 'overview' }) {
  const { history, active, settings, startWorkout, deleteWorkout } = useApp();
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState(null);
  const [range, setRange] = useState('12w');
  const [program, setProgram] = useState('');
  const [liftChoice, setLift] = useState(null);
  const unit = settings.unit;
  const workouts = useMemo(() => [...history, ...(active?.sets.length ? [active] : [])], [history, active]);
  const o = useMemo(() => overview(workouts, unit), [workouts, unit]);
  const recordIds = useMemo(() => recordSetIds(workouts), [workouts]);
  // Filters: date range and program apply to every tab except Overview.
  const from = rangeFrom(range);
  const filtered = useMemo(() => filterWorkouts(workouts, { from: from ?? undefined, program: program || undefined }), [workouts, from, program]);
  const liftsList = useMemo(() => lifts(workouts), [workouts]);
  const lift = liftChoice && liftsList.some((l) => l.key === liftChoice) ? liftChoice : liftsList[0]?.key ?? null;
  const programs = useMemo(() => [...new Set(workouts.map((w) => w.program).filter(Boolean))], [workouts]);
  const filterProps = { liftsList, lift, setLift, range, setRange, programs, program, setProgram };

  const remove = (w) =>
    Alert.alert('Delete this workout?', `${w.name}, ${w.sets.length} sets. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWorkout(w.id) },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
      <Text style={[type.h1, { marginBottom: 16 }]}>Progression</Text>
      <Chips
        options={[['overview', 'Overview'], ['strength', 'Strength'], ['consistency', 'Consistency'], ['volume', 'Volume'], ['performance', 'Performance'], ['prs', 'PRs']]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? <Comparisons history={history} unit={unit} /> : null}
      {/* Records are all-time, so the PRs tab has no filters. */}
      {tab !== 'overview' && tab !== 'prs' ? <Filters {...filterProps} showLift={tab === 'strength' || tab === 'performance'} /> : null}
      {tab === 'overview' ? (
        <>
          <Card style={{ marginTop: 14 }}>
            <Text style={type.title}>Total Strength (Est. 1RM)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <Text style={type.bigGreen}>{pct(o.strengthChangePct)}</Text>
              <Text style={type.body}>vs. last 4 weeks</Text>
            </View>
            <LineChart points={o.strength.map((p) => ({ label: p.label, value: p.total }))} />
          </Card>
          <View style={st.grid}>
            <Tile icon="dumbbell" title="Est. 1RM" value={o.topLift ? `${o.topLift.e1rm} ${unit}` : '—'} sub={o.topLift ? `${exerciseName(o.topLift.exercise)} (${signed(o.topLift.delta)} ${unit})` : 'log a set'} />
            <Tile icon="layers-outline" title="Volume" value={pct(o.volumeChangePct)} sub="vs. prior 4 weeks" />
            <Tile icon="target" title="Consistency" value={`${o.consistency.pct}%`} sub={`(${o.consistency.weeks} / ${o.consistency.of} weeks)`} />
            <Tile icon="trophy" title="PRs" value={String(o.prs.count)} sub={`(+${o.prs.newThisWeek} new)`} />
          </View>
          <Text style={[type.h2, { marginTop: 24 }]}>History</Text>
          {!history.length ? <Text style={[type.body, { marginTop: 8 }]}>Finished workouts show up here.</Text> : null}
          {history.slice().sort((a,b) => b.startedAt.localeCompare(a.startedAt)).map((w) => (
            <HistoryItem
              key={w.id}
              workout={w}
              records={recordIds}
              canRepeat={!active}
              onRepeat={() => { startWorkout(`${w.name} (repeat)`, repeatPlan(w)); go('Coach'); }}
              onEdit={() => setEditing(w.id)}
              onDelete={() => remove(w)}
            />
          ))}
        </>
      ) : null}

      {tab === 'strength' ? <StrengthView workouts={filtered} lift={lift} unit={unit} /> : null}
      {tab === 'consistency' ? <ConsistencyView workouts={filtered} allWorkouts={workouts} from={from} goal={settings.weeklyGoal} /> : null}
      {tab === 'volume' ? <VolumeView workouts={filtered} unit={unit} from={from} /> : null}
      {tab === 'performance' ? <PerformanceView workouts={filtered} lift={lift} unit={unit} /> : null}
      {tab === 'prs' ? <RecordsView workouts={workouts} unit={unit} /> : null}
      {editing ? <EditWorkoutSheet workoutId={editing} onClose={() => setEditing(null)} /> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  tile: { width: '48%', flexGrow: 1, alignItems: 'center', paddingVertical: 16 },
});
