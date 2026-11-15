import React, { useEffect, useState } from 'react';
import { Alert, Share, Text, TouchableOpacity, Vibration, View } from 'react-native';

import { useApp } from '../AppState.js';
import { suggestNext } from '../lib/coach.js';
import { EXERCISES, exerciseName } from '../lib/exercises.js';
import { streak, weeklyProgress } from '../lib/progress.js';
import { setReport } from '../lib/sessionReport.js';
import { assessFatigue } from '../lib/performance.js';
import { recLine } from '../lib/perfCoach.js';
import { recommendNext } from '../lib/recommend.js';
import { spokenReport } from '../lib/speech.js';
import { loggedText, restText } from '../lib/voice.js';
import { restFor } from '../lib/rest.js';
import { plateBreakdown } from '../lib/tools.js';
import { T, type } from '../theme.js';
import { FormReviewSheet } from './FormReview.js';
import { Card, Chips, Field, Icon, PrimaryButton, Sheet } from './kit.js';
import { PersonaPicker } from './PersonaPicker.js';
import { VoicePicker } from './VoicePicker.js';

const BARBELL = new Set(['squat', 'bench', 'deadlift', 'shoulder_press']);
const RPE = [['', '–'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10']];
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Rest after a set; `rest` comes from restFor() so the length is curated per lift. */
export function RestTimer({ rest, onDone }) {
  const { seconds } = rest;
  const { settings, allSets } = useApp();
  const [line] = useState(() => restText(settings.persona, seconds, allSets.length));
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
      <Text style={[type.body, { textAlign: 'center', marginTop: 2 }]}>{rest.text}</Text>
      <Text style={[type.small, { textAlign: 'center', marginTop: 2 }]}>{line}</Text>
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
const ISSUE_LABEL = { arm_swing: 'arm swing', tracking: 'tracking uncertain', implausible_motion: 'tracking jump', framing: 'out of frame' };

/** Evidence-backed post-set camera report. */
export function SetReportCard({ report, clips = [], movement }) {
  const { say, settings } = useApp();
  const [review, setReview] = useState(false);
  const flagged = (clips ?? []).reduce((n, c) => n + (c.analysis?.faults?.length ?? 0), 0);
  const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;
  return (
    <Card style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={type.title}>Set report</Text>
        <TouchableOpacity onPress={() => say(spokenReport(report, settings.persona))} accessibilityRole="button" accessibilityLabel="Hear report" hitSlop={8}>
          <Text style={[type.small, { color: T.violetText, fontWeight: '700' }]}>🔊 Hear report</Text>
        </TouchableOpacity>
      </View>
      <Text style={type.body}>
        {report.counted} rep{report.counted === 1 ? '' : 's'} counted{report.target ? ` of ${report.target}` : ''}
        {report.partials ? ` · ${report.partials} partial` : ''}
        {report.trackingPct !== null ? ` · tracking ${report.trackingPct}%` : ''}
      </Text>
      {Object.entries(report.issues).length ? (
        <Text style={type.small}>Tracking interruptions: {Object.entries(report.issues).map(([k, n]) => `${n}× ${ISSUE_LABEL[k] ?? 'tracking uncertain'}`).join(', ')}</Text>
      ) : null}
      {report.repDurationsMs.length ? <Text style={type.small}>Rep times: {report.repDurationsMs.map(sec).join(' · ')}</Text> : null}
      {report.tempo ? <Text style={type.small}>Tempo: first 3 avg {sec(report.tempo.firstMs)} → last 3 avg {sec(report.tempo.lastMs)} ({report.tempo.changePct > 0 ? '+' : ''}{report.tempo.changePct}%)</Text> : null}
      {report.rpe != null ? <Text style={type.small}>Your RPE: {report.rpe}</Text> : null}
      {report.suggestions.map((x) => (
        <Text key={x.id} style={[type.small, { color: T.violetText, marginTop: 6 }]}>• {x.text} ({x.evidence})</Text>
      ))}
      {flagged > 0 && movement ? (
        <>
          <PrimaryButton secondary onPress={() => setReview(true)}>Review form ({flagged})</PrimaryButton>
          <FormReviewSheet visible={review} onClose={() => setReview(false)} movement={movement} clips={clips} />
        </>
      ) : null}
    </Card>
  );
}

export function LogSetSheet({ visible, onClose, initial, camera }) {
  const { settings, allSets, logSet, say, active } = useApp();
  const [exercise, setExercise] = useState('bench');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(settings.unit);
  const [reps, setReps] = useState('8');
  const [rpe, setRpe] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setSaved(null);
    setError(null);
    setUnit(initial?.unit ?? settings.unit);
    if (initial?.exercise) setExercise(initial.exercise);
    if (initial?.reps !== undefined) setReps(String(initial.reps));
    if (initial?.weight !== undefined) setWeight(String(initial.weight));
  }, [visible, initial, settings.unit]);

  const hint = suggestNext(allSets.filter((x) => x.exercise === exercise && x.unit === unit));
  const plates = BARBELL.has(exercise) && Number(weight) > 0 ? plateBreakdown(Number(weight), unit) : undefined;

  const save = () => {
    if (!active) { setError('Start a workout before recording a set.'); return; }
    const w = Number(weight || 0);
    const r = Number(reps);
    if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 0) {
      setError('Enter a weight of 0 or more and a whole number of reps.');
      return;
    }
    const fromCamera = Boolean(camera && camera.movement === exercise && camera.reps.length === r);
    const rpeN = rpe === '' ? null : Number(rpe);
    const target = fromCamera ? camera.target ?? null : null;
    // Performance record and an optional next-set suggestion, from measurements and the user's RPE.
    const prior = allSets.filter((x) => x.exercise === exercise);
    const fatigue = assessFatigue({
      movement: exercise, reps: fromCamera ? camera.reps : [], target, completed: r, rpe: rpeN,
      partials: fromCamera ? camera.quality?.partials ?? 0 : 0, partialAfterLastRep: fromCamera ? camera.quality?.partialAfterLastRep ?? false : false,
      weight: w, unit, history: prior,
    });
    const rec = recommendNext({ exercise, unit, weight: w, target: target ?? r, completed: r, rpe: rpeN, fatigue, history: prior, metrics: fatigue.metrics });
    const m = fatigue.metrics;
    const result = logSet({
      exercise, weight: w, unit, reps: r, rpe: rpeN,
      source: fromCamera ? 'camera' : initial?.source ?? 'manual',
      reps_detail: fromCamera ? camera.reps : [],
      ...(fromCamera ? { camera_quality: camera.quality ?? null, target } : {}),
      ...(fromCamera && m ? { metrics: { calibrated: false, meanLiftMs: m.meanLiftMs, velocityLossPct: m.velocityLossPct, romLossPct: m.romLossPct, consistencyCv: m.consistencyCv } } : {}),
      fatigue: fatigue.level,
      rec: rec.action === 'none' ? null : { action: rec.action, weight: rec.weight, reps: rec.reps, accepted: false },
    });
    if (!result) { setError('Start a workout before recording a set.'); return; }
    const { isPR } = result;
    const report = fromCamera
      ? setReport({ movement: exercise, reps: camera.reps, quality: camera.quality, rpe: rpe === '' ? null : Number(rpe), target: camera.target })
      : null;
    say(report
      ? `${isPR ? 'New record! ' : ''}${spokenReport(report, settings.persona)}`
      : loggedText(settings.persona, { exercise, reps: r, weight: w, unit, isPR }, allSets.length));
    setSaved({ isPR, report, fatigue: fatigue.level === 'uncertain' ? null : fatigue.text, next: rec.action === 'none' ? null : `${recLine({ ...rec, unit }, { history: prior.length > 0 }) ?? ''} ${rec.reasons.join(' ')}`.trim(), rest: restFor({ exercise, reps: r, rpe: rpe === '' ? null : Number(rpe), fitnessGoal: settings.fitnessGoal, experience: settings.experience, activityLevel: settings.activityLevel }), text: `${exerciseName(exercise)} · ${r} × ${w} ${unit}` });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Log a set">
      {saved ? (
        <>
          <Card style={{ borderColor: saved.isPR ? T.green : T.border }}>
            <Text style={type.title}>{saved.isPR ? '🏆 New personal record' : 'Set saved'}</Text>
            <Text style={type.body}>{saved.text}</Text>
            {saved.fatigue ? <Text style={[type.small, { marginTop: 6 }]}>{saved.fatigue}</Text> : null}
            {saved.next ? <Text style={[type.small, { marginTop: 4 }]}>Next time: {saved.next}</Text> : null}
          </Card>
          {saved.report ? <SetReportCard report={saved.report} clips={camera?.clips} movement={camera?.movement} /> : null}
          <RestTimer rest={saved.rest} onDone={onClose} />
        </>
      ) : (
        <>
          <Text style={[type.label, { marginBottom: 8 }]}>Exercise</Text>
          <Chips options={EXERCISES.map((e) => [e.id, e.name])} value={exercise} onChange={setExercise} />
          {hint ? (
            <TouchableOpacity onPress={() => { setWeight(String(hint.weight)); setReps(String(hint.reps)); }} style={{ marginTop: 4, minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
          {camera && camera.movement === exercise ? (
            <Text style={[type.small, { marginTop: 10 }]}>📷 {camera.reps.length} camera-counted reps with timing attached.</Text>
          ) : null}
          {error ? <Text style={{ color: T.red, marginTop: 10 }}>{error}</Text> : null}
          <PrimaryButton disabled={!active} onPress={save}>Save set</PrimaryButton>
        </>
      )}
    </Sheet>
  );
}

/** The bell: what happened lately, plus settings and data controls. */
export function ActivitySheet({ visible, onClose, openSetup }) {
  const { settings, update, history, allSets, exportJSON, eraseAll, importData, account, signOut } = useApp();
  const [pasted, setPasted] = useState('');
  const [msg, setMsg] = useState(null);
  const week = weeklyProgress(history, settings.weeklyGoal);
  const prs = allSets.filter((s) => s.pr).slice(-3).reverse();

  const restore = () => {
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
      {openSetup ? <PrimaryButton secondary onPress={openSetup}>Beginner / comeback setup</PrimaryButton> : null}
      <Text style={[type.label, { marginVertical: 8 }]}>Jim's persona</Text>
      <PersonaPicker />
      <Text style={[type.label, { marginVertical: 8 }]}>Spoken replies</Text>
      <Chips options={[[true, 'On'], [false, 'Off']]} value={settings.speak} onChange={(speak) => update({ speak })} />
      <VoicePicker />
      <Text style={[type.label, { marginVertical: 8 }]}>Units</Text>
      <Chips options={[['lb', 'lb'], ['kg', 'kg']]} value={settings.unit} onChange={(unit) => update({ unit })} />
      <Text style={[type.label, { marginVertical: 8 }]}>Weekly goal</Text>
      <Chips options={[1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])} value={settings.weeklyGoal} onChange={(weeklyGoal) => update({ weeklyGoal })} />

      {account ? <>
        <Text style={[type.h2, { marginTop: 24 }]}>Account</Text>
        <Text style={type.body}>Signed in as {account}</Text>
        <PrimaryButton secondary onPress={() => { onClose(); signOut?.(); }}>Sign out</PrimaryButton>
      </> : null}

      <Text style={[type.h2, { marginTop: 24 }]}>Your data</Text>
      <Text style={type.body}>{history.length} workouts on this phone. Nothing is uploaded.</Text>
      <PrimaryButton secondary onPress={() => Share.share({ message: exportJSON(), title: 'JimBro workouts' })}>Export workouts</PrimaryButton>
      <View style={{ marginTop: 12 }}>
        <Field value={pasted} onChangeText={setPasted} multiline placeholder="Paste an export here to restore" style={{ minHeight: 70, textAlignVertical: 'top' }} />
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
