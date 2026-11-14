import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { BarChart, LineChart } from '../components/Charts.js';
import { Card, Chips, Icon, PrimaryButton, Segmented } from '../components/kit.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { personalRecords, trend } from '../lib/progress.js';
import { overview, weeklyVolume } from '../lib/stats.js';
import { estimate1RM, repeatPlan } from '../lib/tools.js';
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

function HistoryItem({ workout, canRepeat, onRepeat, onDelete }) {
  const [open, setOpen] = useState(false);
  const volume = workout.sets.reduce((t, x) => t + x.weight * x.reps, 0);
  return (
    <Card style={{ marginTop: 10 }}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text style={type.title}>{workout.name}</Text>
          <Text style={type.small}>{new Date(workout.startedAt).toLocaleDateString()} · {workout.sets.length} sets · volume {Math.round(volume)}</Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={T.textDim} />
      </TouchableOpacity>
      {open ? (
        <>
          {workout.sets.map((x) => (
            <Text key={x.id} style={[type.body, { marginTop: 6 }]}>
              {x.pr ? '🏆 ' : ''}{exerciseName(x.exercise)} · {x.reps} × {x.weight} {x.unit}{x.rpe ? ` · RPE ${x.rpe}` : ''}{x.source === 'camera' ? ' · 📷' : ''}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <PrimaryButton secondary style={{ flex: 1 }} disabled={!canRepeat} onPress={onRepeat}>Repeat</PrimaryButton>
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
  const [exercise, setExercise] = useState('bench');
  const unit = settings.unit;
  const workouts = useMemo(() => [...history, ...(active?.sets.length ? [active] : [])], [history, active]);
  const o = useMemo(() => overview(workouts, unit), [workouts, unit]);
  const records = useMemo(() => personalRecords(workouts), [workouts]);
  const vol = useMemo(() => weeklyVolume(workouts, unit), [workouts, unit]);
  const t = useMemo(() => trend(workouts, exercise), [workouts, exercise]);

  const remove = (w) =>
    Alert.alert('Delete this workout?', `${w.name}, ${w.sets.length} sets. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWorkout(w.id) },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
      <Text style={[type.h1, { marginBottom: 16 }]}>Progression</Text>
      <Segmented options={[['overview', 'Overview'], ['strength', 'Strength'], ['volume', 'Volume'], ['prs', 'PRs']]} value={tab} onChange={setTab} />

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
          {history.slice().reverse().map((w) => (
            <HistoryItem
              key={w.id}
              workout={w}
              canRepeat={!active}
              onRepeat={() => { startWorkout(`${w.name} (repeat)`, repeatPlan(w)); go('Coach'); }}
              onDelete={() => remove(w)}
            />
          ))}
        </>
      ) : null}

      {tab === 'strength' ? (
        <>
          <Card style={{ marginTop: 14 }}>
            <Chips options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
            {!Object.keys(t).length ? <Text style={[type.body, { marginTop: 12 }]}>No {exerciseName(exercise).toLowerCase()} logged yet.</Text> : null}
            {Object.entries(t).map(([u, tr]) => (
              <View key={u} style={{ marginTop: 14 }}>
                <Text style={type.title}>Top weight ({u})</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={type.bigGreen}>{pct(tr.top_weight_change_pct)}</Text>
                  <Text style={type.body}>first → latest session</Text>
                </View>
                <LineChart points={tr.points.slice(-8).map((p) => ({ label: p.date.slice(5), value: p.top_weight }))} />
                {tr.tut_change_pct !== null ? <Text style={type.small}>Est. TUT per rep {pct(tr.tut_change_pct)} (camera sets)</Text> : null}
              </View>
            ))}
          </Card>
          <Text style={type.small}>1RM is estimated (Epley) from sets of 10 reps or fewer. Never max out from an estimate.</Text>
        </>
      ) : null}

      {tab === 'volume' ? (
        <Card style={{ marginTop: 14 }}>
          <Text style={type.title}>Weekly volume</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={type.bigGreen}>{pct(o.volumeChangePct)}</Text>
            <Text style={type.body}>last 4 weeks vs. prior 4</Text>
          </View>
          <BarChart points={vol.map((v) => ({ label: v.label, value: v.volume }))} unit={unit} />
        </Card>
      ) : null}

      {tab === 'prs' ? (
        <>
          {!records.length ? <Card style={{ marginTop: 14 }}><Text style={type.body}>Your personal records will show up here.</Text></Card> : null}
          {records.map((r) => {
            const e1rm = Math.max(0, ...workouts.flatMap((w) => w.sets).filter((x) => x.exercise === r.exercise && x.unit === r.unit).map((x) => estimate1RM(x) ?? 0));
            return (
              <Card key={`${r.exercise}${r.unit}`} style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="trophy" color={T.purple} />
                  <Text style={type.title}>{exerciseName(r.exercise)} ({r.unit})</Text>
                </View>
                <Text style={[type.body, { marginTop: 6 }]}>
                  Heaviest {r.heaviest.weight} × {r.heaviest.reps} · Most reps {r.most_reps.reps} @ {r.most_reps.weight}
                </Text>
                {e1rm ? <Text style={{ color: T.green, fontWeight: '700', marginTop: 4 }}>Est. 1RM ≈ {e1rm} {r.unit}</Text> : null}
              </Card>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  tile: { width: '48%', flexGrow: 1, alignItems: 'center', paddingVertical: 16 },
});
