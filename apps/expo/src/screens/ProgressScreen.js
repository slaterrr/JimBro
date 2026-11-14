import React, { useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { personalRecords, streak, trend } from '../lib/progress.js';
import { estimate1RM, repeatPlan } from '../lib/tools.js';
import { Button, C, Card, Choice, Kicker, Metric, Title, s } from '../ui.js';

function HistoryItem({ workout, onRepeat, onDelete, canRepeat }) {
  const [open, setOpen] = useState(false);
  const volume = workout.sets.reduce((t, x) => t + x.weight * x.reps, 0);
  return (
    <View style={s.set}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)}>
        <Text style={s.rowText}>
          {open ? '▾' : '▸'} {workout.name} · {new Date(workout.startedAt).toLocaleDateString()}
        </Text>
        <Text style={s.body}>{workout.sets.length} sets · volume {Math.round(volume)}</Text>
      </TouchableOpacity>
      {open ? (
        <>
          {workout.sets.map((x) => (
            <Text key={x.id} style={s.body}>
              {x.pr ? '🏆 ' : ''}{exerciseName(x.exercise)} · {x.reps} × {x.weight} {x.unit}{x.rpe ? ` · RPE ${x.rpe}` : ''}{x.source === 'camera' ? ' · 📷' : ''}
            </Text>
          ))}
          <View style={s.inputRow}>
            <View style={s.inputHalf}><Button secondary disabled={!canRepeat} onPress={onRepeat}>Repeat</Button></View>
            <View style={s.inputHalf}><Button secondary onPress={onDelete}>Delete</Button></View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const pct = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export function ProgressScreen({ go }) {
  const { history, active, startWorkout, deleteWorkout } = useApp();
  const repeat = (w) => {
    startWorkout(`${w.name} (repeat)`, repeatPlan(w));
    go('Workout');
  };
  const remove = (w) =>
    Alert.alert('Delete this workout?', `${w.name}, ${w.sets.length} sets. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWorkout(w.id) },
    ]);
  const [exercise, setExercise] = useState('curl');
  const workouts = useMemo(() => [...history, ...(active?.sets.length ? [active] : [])], [history, active]);
  const t = useMemo(() => trend(workouts, exercise), [workouts, exercise]);
  const records = useMemo(() => personalRecords(workouts), [workouts]);
  const sets = workouts.flatMap((w) => w.sets);
  const units = Object.entries(t);

  return (
    <>
      <Kicker>THE WORK ADDS UP</Kicker>
      <Title>Progress</Title>
      <View style={s.metrics}>
        <Metric title="WORKOUTS" value={history.length} />
        <Metric title="REPS" value={sets.reduce((n, x) => n + x.reps, 0)} />
        <Metric title="STREAK" value={`${streak(history)} wk`} />
      </View>

      <Card>
        <Choice title="Exercise" options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
        {!units.length ? <Text style={[s.body, { marginTop: 12 }]}>Log {exerciseName(exercise).toLowerCase()} to start tracking it.</Text> : null}
        {units.map(([unit, u]) => (
          <View key={unit} style={s.set}>
            <Text style={s.bigStat}>{pct(u.top_weight_change_pct)}</Text>
            <Text style={s.body}>Top weight, first → latest of {u.points.length} sessions ({unit})</Text>
            <Text style={s.rowText}>
              Volume {pct(u.volume_change_pct)}{u.tut_change_pct !== null ? `  ·  Est. TUT/rep ${pct(u.tut_change_pct)}` : ''}
            </Text>
            {u.points.slice(-6).map((p, i) => (
              <Text key={i} style={s.body}>
                {p.date} · top {p.top_weight} {unit} · volume {Math.round(p.volume)}{p.avg_tut_ms ? ` · TUT ${(p.avg_tut_ms / 1000).toFixed(1)}s` : ''}
              </Text>
            ))}
          </View>
        ))}
        <Text style={s.fine}>kg and lb are never mixed; % change compares your first and latest session.</Text>
      </Card>

      <Card>
        <Kicker>PERSONAL RECORDS</Kicker>
        {!records.length ? <Text style={s.body}>Your records will show up here.</Text> : null}
        {records.map((r) => (
          <View key={`${r.exercise}${r.unit}`} style={s.set}>
            <Text style={s.rowText}>🏆 {exerciseName(r.exercise)} ({r.unit})</Text>
            <Text style={s.body}>
              Heaviest {r.heaviest.weight} × {r.heaviest.reps} · Most reps {r.most_reps.reps} @ {r.most_reps.weight} · Best set {Math.round(r.best_set_volume)}
            </Text>
            {(() => {
              const e1rm = Math.max(0, ...workouts.flatMap((w) => w.sets).filter((x) => x.exercise === r.exercise && x.unit === r.unit).map((x) => estimate1RM(x) ?? 0));
              return e1rm ? <Text style={[s.body, { color: C.green }]}>Estimated 1RM ≈ {e1rm} {r.unit}</Text> : null;
            })()}
          </View>
        ))}
        {records.length ? <Text style={s.fine}>1RM is estimated (Epley) from sets of 10 reps or fewer. Don't max out from an estimate.</Text> : null}
      </Card>

      <Card>
        <Kicker>HISTORY</Kicker>
        {!history.length ? <Text style={s.body}>Finished workouts will show up here.</Text> : null}
        {history.slice().reverse().map((w) => (
          <HistoryItem key={w.id} workout={w} canRepeat={!active} onRepeat={() => repeat(w)} onDelete={() => remove(w)} />
        ))}
        {active && history.length ? <Text style={s.fine}>Finish your current workout to repeat a past one.</Text> : null}
      </Card>
    </>
  );
}
