import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Comparisons } from '../components/Comparisons.js';
import { useApp } from '../AppState.js';
import { BarChart, LineChart } from '../components/Charts.js';
import { HealthConnect } from '../components/HealthConnect.js';
import { Card, Chips, Dropdown, Field, Icon, PrimaryButton, Segmented, Sheet } from '../components/kit.js';
import { ACTIVITY_LABELS } from '../lib/activityLevel.js';
import { compareSessions, comparePeriods, historyNewestFirst } from '../lib/compare.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { describeGoal, goalProgress, GOAL_TYPES, weeklyCheckIn } from '../lib/goals.js';
import { MUSCLE_GROUPS } from '../lib/muscles.js';
import { personalRecords, trend } from '../lib/progress.js';
import { overview, weeklyVolume } from '../lib/stats.js';
import { estimate1RM, repeatPlan } from '../lib/tools.js';
import { R, T, type } from '../theme.js';

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
  const { history, active, settings, startWorkout, deleteWorkout, plan, goals, addGoal, removeGoal } = useApp();
  const [adding, setAdding] = useState(false);
  const [health, setHealth] = useState(false);
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
      <Segmented options={[['overview', 'Overview'], ['strength', 'Strength'], ['volume', 'Volume'], ['prs', 'PRs'], ['history', 'History'], ['goals', 'Goals']]} value={tab} onChange={setTab} />

      {tab === 'overview' ? <Comparisons history={history} unit={unit} /> : null}
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

      {tab === 'history' ? (
        <HistoryTab
          workouts={workouts}
          history={history}
          unit={unit}
          active={active}
          onRepeat={(w) => { startWorkout(`${w.name} (repeat)`, repeatPlan(w)); go('Coach'); }}
          onDelete={remove}
        />
      ) : null}

      {tab === 'goals' ? (
        <>
          <CheckInCard checkIn={weeklyCheckIn({ history, active, plan, goals })} />
          <Card style={{ marginTop: 12 }} onPress={() => setHealth(true)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="heart-pulse" color={T.accent} />
              <View style={{ flex: 1 }}>
                <Text style={type.title}>Estimate my activity level</Text>
                <Text style={type.small}>
                  {settings.activityLevel ? `Saved: ${ACTIVITY_LABELS[settings.activityLevel] ?? settings.activityLevel}` : 'From your health app history, on this phone only.'}
                </Text>
              </View>
            </View>
          </Card>
          <HealthConnect visible={health} onClose={() => setHealth(false)} />
          <Text style={[type.h2, { marginTop: 24 }]}>Goals</Text>
          {!goals.length ? <Text style={[type.body, { marginTop: 8 }]}>Set a measurable goal; it's checked against what you log.</Text> : null}
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              progress={goalProgress(g, workouts)}
              onRemove={() =>
                Alert.alert('Remove this goal?', describeGoal(g), [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removeGoal(g.id) },
                ])
              }
            />
          ))}
          <PrimaryButton onPress={() => setAdding(true)}>Add goal</PrimaryButton>
          <AddGoalSheet visible={adding} unit={unit} onClose={() => setAdding(false)} onAdd={(g) => { addGoal(g); setAdding(false); }} />
        </>
      ) : null}
    </ScrollView>
  );
}

function Delta({ label, value }) {
  const color = value === null || value === undefined ? T.textMute : value >= 0 ? T.green : T.amber;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{pct(value)}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const fmt = (v, unit) => (v === null || v === undefined ? '—' : `${v} ${unit}`);

/** Full workout history plus workout-to-workout and month/year comparisons. */
function HistoryTab({ workouts, history, unit, active, onRepeat, onDelete }) {
  const [exercise, setExercise] = useState('curl');
  const [period, setPeriod] = useState('month');
  const s = useMemo(() => compareSessions(workouts, exercise, unit), [workouts, exercise, unit]);
  const p = useMemo(() => comparePeriods(workouts, { period, unit }), [workouts, period, unit]);
  const list = useMemo(() => historyNewestFirst(history), [history]);
  const line = (x) => `${x.label}: ${fmt(x.topWeight, unit)} top · e1RM ${fmt(x.e1rm, unit)} · vol ${fmt(x.volume, unit)}`;
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Text style={type.title}>Workout to workout</Text>
        <View style={{ marginTop: 8 }}>
          <Chips options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
        </View>
        {!s ? (
          <Text style={[type.body, { marginTop: 12 }]}>No {exerciseName(exercise).toLowerCase()} logged yet.</Text>
        ) : (
          <>
            <Text style={[type.body, { marginTop: 12 }]}>{s.text}</Text>
            {s.previous ? (
              <>
                <View style={{ flexDirection: 'row', marginTop: 10 }}>
                  <Delta label="Top weight" value={s.change.topWeightPct} />
                  <Delta label="Est. 1RM" value={s.change.e1rmPct} />
                  <Delta label="Volume" value={s.change.volumePct} />
                </View>
                <Text style={[type.small, { marginTop: 8 }]}>{line(s.current)}</Text>
                <Text style={type.small}>{line(s.previous)}</Text>
              </>
            ) : null}
          </>
        )}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={type.title}>{period === 'month' ? 'Month to month' : 'Year to year'}</Text>
        <Dropdown testID="history-frame" label="Compare by" value={period} options={[['month', 'Month to month'], ['year', 'Year to year']]} onChange={setPeriod} />
        <Text style={[type.body, { marginTop: 12 }]}>{p.text}</Text>
        {p.previous ? (
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Delta label="Sessions" value={p.change.sessionsPct} />
            <Delta label="Total e1RM" value={p.change.e1rmPct} />
            <Delta label="Volume" value={p.change.volumePct} />
          </View>
        ) : null}
        <Text style={[type.small, { marginTop: 8 }]}>
          {p.current.label}: {p.current.sessions} sessions · vol {fmt(p.current.volume, unit)}
          {p.previous ? ` · ${p.previous.label}: ${p.previous.sessions} sessions · vol ${fmt(p.previous.volume, unit)}` : ''}
        </Text>
        {p.exercises.map((e) => (
          <Text key={e.exercise} style={[type.body, { marginTop: 6 }]}>
            {exerciseName(e.exercise)}: e1RM {fmt(e.current?.bestE1rm, unit)}
            {e.previous ? ` (was ${fmt(e.previous.bestE1rm, unit)}, ${pct(e.change?.e1rmPct)})` : ' (no previous data)'}
            {e.current ? ` · vol ${fmt(e.current.volume, unit)}` : ' · none this period'}
            {e.change ? ` (${pct(e.change.volumePct)})` : ''}
          </Text>
        ))}
      </Card>

      <Text style={[type.h2, { marginTop: 24 }]}>All workouts</Text>
      {!list.length ? <Text style={[type.body, { marginTop: 8 }]}>Finished workouts show up here.</Text> : null}
      {list.map((w) => (
        <HistoryItem key={w.id} workout={w} canRepeat={!active} onRepeat={() => onRepeat(w)} onDelete={() => onDelete(w)} />
      ))}
      <Text style={[type.small, { marginTop: 10 }]}>Tap a workout to see its sets. Bodyweight sets add no volume or e1RM.</Text>
    </>
  );
}

function Badge({ onTrack }) {
  const [label, color] = onTrack === true ? ['On track', T.green] : onTrack === false ? ['Off track', T.amber] : ['Not enough data', T.textMute];
  return (
    <View style={[st.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function GoalCard({ goal, progress: p, onRemove }) {
  return (
    <Card style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={[type.title, { flex: 1 }]}>{describeGoal(goal)}</Text>
        <TouchableOpacity accessibilityLabel="Remove goal" onPress={onRemove}>
          <Icon name="trash-can-outline" size={20} color={T.textDim} />
        </TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Text style={type.statGreen}>{p.pct}%</Text>
        <Badge onTrack={p.onTrack} />
        {p.projectedDate ? <Text style={type.small}>ETA {p.projectedDate}</Text> : null}
      </View>
      <View style={st.bar}>
        <View style={[st.barFill, { width: `${p.pct}%` }]} />
      </View>
      <Text style={[type.body, { marginTop: 8 }]}>{p.evidence}</Text>
      <Text style={[type.small, { marginTop: 4, color: T.violetText }]}>Next: {p.nextStep}</Text>
    </Card>
  );
}

function CheckInCard({ checkIn: c }) {
  const a = c.adherence;
  return (
    <Card style={{ marginTop: 14 }}>
      <Text style={type.title}>This week</Text>
      {a ? (
        <>
          <Text style={[type.statGreen, { marginTop: 4 }]}>{a.completed} / {a.planned} planned sessions</Text>
          {a.days.map((d) => (
            <Text key={d.day} style={[type.body, { marginTop: 4 }]}>
              {d.done ? '✓' : '○'} Day {d.day}: {d.items.map((i) => `${exerciseName(i.exercise)} ${i.loggedSets}/${i.plannedSets}`).join(' · ')}
            </Text>
          ))}
        </>
      ) : (
        <Text style={type.small}>No saved plan, so there's nothing to compare against.</Text>
      )}
      {!c.hasData ? <Text style={[type.body, { marginTop: 8 }]}>No workouts logged yet.</Text> : null}
      {c.wins.map((w) => <Text key={w} style={{ color: T.green, marginTop: 6 }}>+ {w}</Text>)}
      {c.misses.map((m) => <Text key={m} style={{ color: T.amber, marginTop: 6 }}>– {m}</Text>)}
      <Text style={[type.small, { marginTop: 8, color: T.violetText }]}>{c.suggestion}</Text>
    </Card>
  );
}

const CAMERA_LIFTS = EXERCISES.filter((e) => e.camera);

function AddGoalSheet({ visible, unit, onClose, onAdd }) {
  const [kind, setKind] = useState('strength');
  const [exercise, setExercise] = useState('bench');
  const [muscle, setMuscle] = useState('');
  const [metric, setMetric] = useState('e1rm');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [perWeek, setPerWeek] = useState(3);
  const [weeks, setWeeks] = useState('4');
  const [cameraOnly, setCameraOnly] = useState(true);
  const n = Number(target);
  const validDeadline = !deadline || /^\d{4}-\d{2}-\d{2}$/.test(deadline);

  const build = () => {
    if (kind === 'consistency') return Number(weeks) >= 1 ? { type: 'consistency', perWeek, weeks: Math.round(Number(weeks)) } : null;
    if (!(n > 0)) return null;
    if (kind === 'strength') return validDeadline ? { type: 'strength', exercise, metric, target: n, unit, ...(deadline ? { deadline } : {}) } : null;
    if (kind === 'volume') return { type: 'volume', ...(muscle ? { muscle } : { exercise }), target: n, unit };
    return { type: 'reps', exercise, target: Math.round(n), cameraOnly };
  };
  const goal = build();

  return (
    <Sheet visible={visible} onClose={onClose} title="Add goal">
      <Chips options={GOAL_TYPES} value={kind} onChange={(k) => { setKind(k); if (k === 'reps' && !CAMERA_LIFTS.some((e) => e.id === exercise)) setExercise('curl'); }} />
      {kind === 'consistency' ? (
        <>
          <Text style={[type.label, { marginTop: 16, marginBottom: 6 }]}>Workouts per week</Text>
          <Chips options={[1, 2, 3, 4, 5, 6].map((x) => [x, String(x)])} value={perWeek} onChange={setPerWeek} />
          <View style={{ marginTop: 12 }}><Field label="For how many weeks" keyboardType="number-pad" value={weeks} onChangeText={setWeeks} /></View>
        </>
      ) : (
        <>
          {kind === 'volume' ? (
            <>
              <Text style={[type.label, { marginTop: 16, marginBottom: 6 }]}>Muscle group (or pick a lift below)</Text>
              <Chips options={[['', 'Lift'], ...MUSCLE_GROUPS.map((m) => [m.id, m.name])]} value={muscle} onChange={setMuscle} />
            </>
          ) : null}
          {kind !== 'volume' || !muscle ? (
            <>
              <Text style={[type.label, { marginTop: 16, marginBottom: 6 }]}>Exercise</Text>
              <Chips options={(kind === 'reps' && cameraOnly ? CAMERA_LIFTS : EXERCISES).map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
            </>
          ) : null}
          {kind === 'strength' ? (
            <>
              <Text style={[type.label, { marginTop: 16, marginBottom: 6 }]}>Measure</Text>
              <Chips options={[['e1rm', 'Est. 1RM'], ['weight', 'Top set weight']]} value={metric} onChange={setMetric} />
            </>
          ) : null}
          {kind === 'reps' ? (
            <>
              <Text style={[type.label, { marginTop: 16, marginBottom: 6 }]}>Counts</Text>
              <Chips options={[[true, 'Camera-verified only'], [false, 'Any logged set']]} value={cameraOnly} onChange={setCameraOnly} />
            </>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Field
              label={kind === 'reps' ? 'Reps in one set' : kind === 'volume' ? `Weekly volume (${unit})` : `Target (${unit})`}
              keyboardType="decimal-pad"
              value={target}
              onChangeText={setTarget}
            />
            {kind === 'strength' ? <Field label="By (YYYY-MM-DD, optional)" value={deadline} onChangeText={setDeadline} placeholder="2026-12-31" /> : null}
          </View>
        </>
      )}
      {goal ? <Text style={[type.small, { marginTop: 10 }]}>{describeGoal(goal)}</Text> : null}
      <PrimaryButton disabled={!goal} onPress={() => onAdd(goal)}>Save goal</PrimaryButton>
    </Sheet>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  tile: { width: '48%', flexGrow: 1, alignItems: 'center', paddingVertical: 16 },
  badge: { borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3 },
  bar: { height: 8, borderRadius: R.pill, backgroundColor: T.surface, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: R.pill, backgroundColor: T.green },
});
