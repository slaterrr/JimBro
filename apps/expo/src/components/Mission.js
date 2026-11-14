// Workout Mission UI. MissionCard: Jim's proposed session in the Home chat (confirm first).
// MissionPanel: the Coach screen's hands-free runner (position -> set -> check -> rest -> summary).
// All decisions come from lib/mission.js; this file only shows them and forwards events.
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Text, TouchableOpacity, View } from 'react-native';

import { useApp } from '../AppState.js';
import { exerciseName } from '../lib/exercises.js';
import { cameraSwap, currentTarget, missionSummary } from '../lib/mission.js';
import { assessFatigue } from '../lib/performance.js';
import { afterSetLines, recLine } from '../lib/perfCoach.js';
import { recommendNext } from '../lib/recommend.js';
import { T, type } from '../theme.js';
import { Card, Chips, Field, PrimaryButton } from './kit.js';

const CHECK_AUTO_MS = 8000; // the quick check confirms itself (hands-free) unless a weight is needed
// "How many more could you have done?" (reps in reserve, as the user reports it; 4 means 4+).
const RIRS = [0, 1, 2, 3, 4];

const load = (t) => (t.weight === null ? 'your weight' : t.weight > 0 ? `${t.weight} ${t.unit}` : 'bodyweight');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** What Jim says at the start of a set. */
export const announce = (t) =>
  `Set ${t.setNo} of ${t.sets}. ${exerciseName(t.exercise)}, ${t.weight === null ? '' : t.weight > 0 ? `${t.weight} ${t.unit === 'lb' ? 'pounds' : 'kilos'}, ` : ''}${t.reps} reps.${t.camera ? '' : ' Tap plus for each rep.'}`;

export function MissionCard({ mission, onStart, onCancel }) {
  return (
    <Card style={{ marginTop: 10, borderColor: T.accent }}>
      <Text style={type.title}>Mission: {mission.title} · {mission.minutes} min</Text>
      <Text style={type.small}>About {mission.estMinutes} min with warm-up and rests</Text>
      {mission.items.map((i, k) => (
        <View key={k} style={{ marginTop: 10 }}>
          <Text style={[type.body, { color: T.text, fontWeight: '700' }]}>
            {exerciseName(i.exercise)} · {i.sets} × {i.reps} · {load(i)} {i.camera ? '📷' : '✋'}
          </Text>
          <Text style={type.small}>{i.why}</Text>
        </View>
      ))}
      <View style={{ marginTop: 10, gap: 4 }}>
        {mission.reasons.map((r, k) => <Text key={k} style={type.small}>• {r}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrimaryButton style={{ flex: 1 }} onPress={onStart}>Start mission</PrimaryButton>
        <PrimaryButton secondary style={{ flex: 1 }} onPress={onCancel}>Not now</PrimaryButton>
      </View>
    </Card>
  );
}

/**
 * Runs the mission on the Coach screen. Props come from the camera counter:
 * `count`, `lastRepAt` (ms), `tracking` ('ok'|...), `repsDetail()` and `resetCounter()`.
 */
export function MissionPanel({ count, lastRepAt, tracking, repsDetail, resetCounter, setQuality, voiceOn }) {
  const { mission, stepMission, endMission, logSet, finishWorkout, voice, history } = useApp();
  const s = mission.state;
  const t = currentTarget(s);
  const [taps, setTaps] = useState(0);
  const [rir, setRir] = useState(null); // user-reported only; never guessed from video
  const [q, setQ] = useState(null); // camera set quality (partials, unfinished attempt)
  // Seeded from the mission state so a remount (tab switch) mid-check keeps the counted reps.
  const [reps, setReps] = useState(s.pending?.reps ?? 0);
  const [weight, setWeight] = useState(t?.weight == null ? '' : String(t.weight));
  const [restLeft, setRestLeft] = useState(s.phase === 'rest' ? t?.rest_s ?? 0 : 0); // non-zero on a remount mid-rest, so rest isn't skipped
  const okSince = useRef(null);
  const say = (line) => voiceOn && line && voice.say(line, { force: true });

  // Position: start the set once the camera has you (1.5 s of good tracking), or right away for tap lifts.
  useEffect(() => {
    if (s.phase !== 'position' || !t) return undefined;
    if (!t.camera) {
      const id = setTimeout(() => go(), 2500);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => {
      if (tracking === 'ok') {
        okSince.current ??= Date.now();
        if (Date.now() - okSince.current >= 1500) go();
      } else okSince.current = null;
    }, 250);
    return () => clearInterval(id);
    function go() {
      okSince.current = null;
      resetCounter();
      setTaps(0);
      stepMission({ type: 'ready' });
      say(announce(t));
    }
  }, [s.phase, s.i, s.setNo, tracking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set: end it hands-free (target reached + pause, or a long pause).
  useEffect(() => {
    if (s.phase !== 'set' || !t?.camera) return undefined;
    const id = setInterval(() => {
      if (count > 0 && ((count >= t.reps && Date.now() - lastRepAt >= 2000) || Date.now() - lastRepAt >= 6000)) finishSet(count, repsDetail());
    }, 300);
    return () => clearInterval(id);
  }, [s.phase, count, lastRepAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything Jim concludes about a set comes from these measurements and what the user reports.
  const pastSets = [...history.flatMap((w) => w.sets ?? []), ...s.log.map((e) => ({ ...e }))];
  const judge = ({ n, detail, quality, rirNow, w }) => {
    const fatigue = assessFatigue({
      movement: t.exercise, reps: t.camera ? detail : [], target: t.reps, completed: n,
      partials: quality?.partials ?? 0, partialAfterLastRep: quality?.partialAfterLastRep ?? false,
      rir: rirNow, weight: w, unit: t.unit, history: pastSets,
    });
    const rec = recommendNext({
      exercise: t.exercise, unit: t.unit, weight: w, target: t.reps, completed: n, rir: rirNow,
      fatigue, setNo: t.setNo, sets: t.sets, history: pastSets, metrics: fatigue.metrics,
    });
    return { fatigue, rec: { ...rec, unit: t.unit } };
  };

  const finishSet = (n, detail = []) => {
    const quality = t.camera ? setQuality?.() ?? null : null;
    setQ(quality);
    setRir(null);
    setReps(n);
    setWeight(t.weight === null ? '' : String(t.weight));
    stepMission({ type: 'set_done', reps: n, reps_detail: detail });
    const { fatigue, rec } = judge({ n, detail, quality, rirNow: null, w: t.weight });
    const lines = afterSetLines({ completed: n, target: t.reps, fatigue, rec });
    say(`${lines.say} ${lines.ask}`);
  };

  const needsWeight = s.phase === 'check' && t?.weight === null;
  const usedWeight = t?.weight === null ? (weight === '' ? null : Number(weight)) : t?.weight;
  const view = s.phase === 'check' && t
    ? judge({ n: reps, detail: s.pending?.reps_detail ?? [], quality: q, rirNow: rir, w: usedWeight })
    : null;
  const midWorkout = t ? t.setNo < t.sets : false;
  const offer = view && midWorkout && ['increase', 'decrease', 'more_rest', 'fewer_reps'].includes(view.rec.action) ? view.rec : null;

  const confirm = (accepted = false) => {
    const w = usedWeight;
    if (!(w >= 0)) return;
    const pending = s.pending;
    const camera = t.camera && pending?.reps_detail?.length === reps;
    const m = view?.fatigue.metrics;
    const rec = view && view.rec.action !== 'none' ? view.rec : null;
    logSet({
      exercise: t.exercise, weight: w, unit: t.unit, reps, rpe: rir == null ? null : 10 - rir, rir,
      source: camera ? 'camera' : 'manual',
      reps_detail: camera ? pending.reps_detail : [],
      target: t.reps,
      // Performance record (relative measurements; see lib/performance.js) and Jim's suggestion.
      ...(camera && m ? { metrics: { calibrated: false, meanLiftMs: m.meanLiftMs, velocityLossPct: m.velocityLossPct, romLossPct: m.romLossPct, consistencyCv: m.consistencyCv } } : {}),
      fatigue: view?.fatigue.level ?? null,
      rec: rec ? { action: rec.action, weight: rec.weight, reps: rec.reps, accepted: Boolean(accepted && offer) } : null,
    }, `Mission: ${s.mission.title}`);
    stepMission({ type: 'confirm', rpe: rir == null ? null : 10 - rir, weight: w, rec, accepted: Boolean(accepted && offer) });
  };

  // Check: saves itself after a few seconds, keeping the plan unchanged (changes need a tap).
  useEffect(() => {
    if (s.phase !== 'check' || needsWeight) return undefined;
    const id = setTimeout(() => confirm(false), CHECK_AUTO_MS);
    return () => clearTimeout(id);
  }, [s.phase, rir, reps, needsWeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rest: count down, say what changes next, then go back to position.
  useEffect(() => {
    if (s.phase !== 'rest' || !t) return undefined;
    setRestLeft(t.rest_s);
    say(`${s.note ?? ''} Rest ${clock(t.rest_s)}. Next: ${exerciseName(t.exercise)}, ${load(t)}, ${t.reps} reps.`);
    const id = setInterval(() => setRestLeft((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, [s.phase, s.i, s.setNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (s.phase === 'rest' && restLeft <= 0 && t) stepMission({ type: 'rest_done' });
    if (s.phase === 'rest' && restLeft === 10) say('10 seconds.');
  }, [restLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Done: check the result against the plan and say it.
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (s.phase !== 'done') return;
    const r = missionSummary(s.mission, s.log, { startedAt: mission.startedAt, endedAt: Date.now() });
    setSummary(r);
    say(`Mission complete. ${r.lines.join(' ')}`);
  }, [s.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={[type.label, { color: T.accent }]}>MISSION · {s.mission.title.toUpperCase()} · {s.mission.minutes} MIN</Text>
      {s.phase !== 'done' ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => stepMission({ type: 'end' })}>
          <Text style={{ color: T.textDim, fontWeight: '700' }}>End</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (s.phase === 'done') {
    return (
      <Card style={{ marginTop: 14, borderColor: T.green }}>
        {header}
        <Text style={[type.title, { marginTop: 6 }]}>Mission complete</Text>
        {(summary?.lines ?? []).map((l, k) => <Text key={k} style={[type.body, { marginTop: 4 }]}>{l}</Text>)}
        {s.changes.map((c, k) => <Text key={`c${k}`} style={type.small}>• {c}</Text>)}
        {summary?.nextTime?.length ? (
          <>
            <Text style={[type.label, { marginTop: 10 }]}>Next time</Text>
            {summary.nextTime.map((n, k) => <Text key={k} style={type.small}>• {n}</Text>)}
          </>
        ) : null}
        <PrimaryButton onPress={() => { finishWorkout(); endMission(); }}>Finish workout</PrimaryButton>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: 14, borderColor: T.accent }}>
      {header}
      <Text style={[type.title, { marginTop: 6 }]}>
        {exerciseName(t.exercise)} · set {t.setNo} of {t.sets}
      </Text>
      <Text style={type.body}>{t.reps} reps · {load(t)} {t.camera ? '· camera counts' : '· tap to count'}</Text>

      {s.phase === 'position' ? (
        <Text style={[type.small, { marginTop: 8 }]}>
          {t.camera ? (tracking === 'ok' ? 'Got you. Starting…' : 'Get into frame, side-on. The set starts when I can see you.') : 'Get set up. Starting in a moment…'}
        </Text>
      ) : null}
      {s.phase === 'position' && t.camera ? (
        <PrimaryButton secondary onPress={() => { resetCounter(); setTaps(0); stepMission({ type: 'ready' }); say(announce(t)); }}>Start set now</PrimaryButton>
      ) : null}

      {s.phase === 'set' && !t.camera ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <PrimaryButton style={{ flex: 2 }} onPress={() => setTaps((n) => n + 1)}>+1 rep ({taps})</PrimaryButton>
          <PrimaryButton secondary style={{ flex: 1 }} onPress={() => finishSet(taps)}>Done</PrimaryButton>
        </View>
      ) : null}
      {s.phase === 'set' && t.camera ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10 }}>
          <Text style={[type.small, { flex: 1 }]}>The set ends by itself when you finish. {count}/{t.reps}</Text>
          <PrimaryButton secondary onPress={() => finishSet(count, repsDetail())}>Done</PrimaryButton>
        </View>
      ) : null}

      {s.phase === 'check' ? (
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={type.label}>Reps</Text>
            <Step label="One rep less" onPress={() => setReps((n) => Math.max(0, n - 1))}>−</Step>
            <Text style={[type.title, { minWidth: 30, textAlign: 'center' }]}>{reps}</Text>
            <Step label="One rep more" onPress={() => setReps((n) => n + 1)}>+</Step>
          </View>
          {needsWeight ? (
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <Field label={`Weight used (${t.unit})`} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="e.g. 95" returnKeyType="done" />
            </View>
          ) : null}
          {view?.fatigue && view.fatigue.level !== 'uncertain' ? (
            <Text style={[type.small, { marginTop: 8 }]} accessibilityLiveRegion="polite">
              {view.fatigue.text}{view.fatigue.metrics?.meanLiftMs ? ` Avg lift ${(view.fatigue.metrics.meanLiftMs / 1000).toFixed(1)} s (camera, relative).` : ''}
            </Text>
          ) : null}
          <Text style={[type.label, { marginVertical: 6 }]}>How many more could you have done?</Text>
          <Chips options={RIRS.map((n) => [n, n === 4 ? '4+' : String(n)])} value={rir} onChange={(v) => { Keyboard.dismiss(); setRir(v); }} />
          {offer ? (
            <View style={{ marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.accent }}>
              <Text style={[type.body, { color: T.text, fontWeight: '700' }]}>{recLine(offer)}</Text>
              <Text style={type.small}>{offer.reasons.join(' ')}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PrimaryButton style={{ flex: 1 }} disabled={needsWeight && usedWeight == null} onPress={() => confirm(true)}>Use it</PrimaryButton>
                <PrimaryButton secondary style={{ flex: 1 }} disabled={needsWeight && usedWeight == null} onPress={() => confirm(false)}>Keep plan</PrimaryButton>
              </View>
            </View>
          ) : (
            <>
              {view?.rec?.reasons?.length && view.rec.action !== 'none' ? <Text style={[type.small, { marginTop: 8 }]}>{view.rec.reasons.join(' ')}</Text> : null}
              <PrimaryButton disabled={needsWeight && !(Number(weight) >= 0 && weight !== '')} onPress={() => confirm(false)}>
                {needsWeight ? 'Save set' : 'Save set (auto in a few seconds)'}
              </PrimaryButton>
            </>
          )}
        </View>
      ) : null}

      {s.phase === 'rest' ? (
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: T.text, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{clock(restLeft > 0 ? restLeft : t.rest_s)}</Text>
          {s.note ? <Text style={[type.small, { textAlign: 'center' }]}>{s.note}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={() => setRestLeft((x) => x + 30)}>+30s</PrimaryButton>
            <PrimaryButton secondary style={{ flex: 1 }} onPress={() => stepMission({ type: 'rest_done' })}>Skip rest</PrimaryButton>
          </View>
        </View>
      ) : null}

      {!t.camera && cameraSwap(t.exercise) && (s.phase === 'position' || s.phase === 'set') ? (
        <PrimaryButton secondary onPress={() => { say(`Switching to ${exerciseName(cameraSwap(t.exercise)).toLowerCase()}, so the camera can count it.`); stepMission({ type: 'switch', exercise: cameraSwap(t.exercise) }); }}>
          {`Switch to ${exerciseName(cameraSwap(t.exercise))} (camera counts it)`}
        </PrimaryButton>
      ) : null}
      {s.phase !== 'check' ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => stepMission({ type: 'skip' })} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
          <Text style={{ color: T.textDim, fontWeight: '600' }}>Skip {exerciseName(t.exercise).toLowerCase()} →</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

function Step({ children, onPress, label }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: T.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: T.accentText, fontSize: 22, fontWeight: '700' }}>{children}</Text>
    </TouchableOpacity>
  );
}
