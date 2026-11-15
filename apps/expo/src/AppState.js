import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { applyDelete, applyUpdate } from './lib/intents.js';
import { applyCoachSet } from './lib/coachSetChat.js';
import { appendWorkoutSet } from './lib/workoutLogging.js';
import { DEFAULT_GOAL_SETTINGS, migrateGoalSettings } from './lib/fitnessGoal.js';
import { migrateGoals } from './lib/goals.js';
import { missionPlanned, missionStart, missionStep } from './lib/mission.js';
import { isOnboarded } from './lib/onboarding.js';
import { migrateSettings } from './lib/personas.js';
import { createVoice, migrateVoiceSettings, VOICE_SETTINGS_VERSION } from './lib/sound.js';
import { personalRecords } from './lib/progress.js';
import { mergeHistory, parseImport } from './lib/tools.js';
import { createConversation } from './lib/conversation.js';
import { chronologicalHistory } from './lib/historyOrder.js';
import { withSavedPlan } from './lib/planVersions.js';
import { createSchedule } from './lib/schedule.js';
import { deviceTimeZone } from './lib/attendance.js';
import { isRetiredExercise, migrateRetiredExercises, withoutRetiredExercises } from './lib/retiredExercises.js';

// Everything lives on this phone: no server, no account.
const KEY = 'jimbro.data.v2';
export const DEFAULT_SETTINGS = { persona: 'coach', speak: true, voiceVersion: VOICE_SETTINGS_VERSION, unit: 'lb', weeklyGoal: 3, onboarded: false, ...DEFAULT_GOAL_SETTINGS }; // rest is curated per set (lib/rest.js); old saves may still carry restSeconds, which is ignored
const EMPTY = { settings: DEFAULT_SETTINGS, active: null, history: [], plan: null, planVersions: [], goals: [] };

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const Ctx = createContext(null);
const LiveCameraCtx = createContext(null);
export const useApp = () => useContext(Ctx);
export const useLiveCamera = () => useContext(LiveCameraCtx);

/** Ephemeral, camera-derived session summary. Frame/landmark data never enters app state. */
function LiveCameraProvider({ activeId, children }) {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    if (snapshot && snapshot.sessionId !== activeId) setSnapshot(null);
  }, [activeId, snapshot]);

  const publish = useCallback((input) => {
    if (!activeId || input?.sessionId !== activeId) return;
    const next = {
      sessionId: activeId,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
      exercise: typeof input.exercise === 'string' ? input.exercise : null,
      reps: Number.isInteger(input.reps) && input.reps >= 0 ? input.reps : 0,
      trackingPct: Number.isFinite(input.trackingPct) ? Math.max(0, Math.min(100, Math.round(input.trackingPct))) : null,
    };
    setSnapshot((current) => current && current.sessionId === next.sessionId
      && current.exercise === next.exercise && current.reps === next.reps && current.trackingPct === next.trackingPct
      ? current
      : next);
  }, [activeId]);

  const clear = useCallback((sessionId) => {
    setSnapshot((current) => !sessionId || current?.sessionId === sessionId ? null : current);
  }, []);

  const value = useMemo(() => ({ snapshot, publish, clear }), [snapshot, publish, clear]);
  return <LiveCameraCtx.Provider value={value}>{children}</LiveCameraCtx.Provider>;
}

export function AppProvider({ children, storageKey = KEY, account = null, onSignOut = null }) {
  const conversationRef = useRef(null);
  if (!conversationRef.current) conversationRef.current = createConversation();
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState(null);
  // Saving starts only after a successful load: if reading or migrating saved data fails, writing
  // the empty starting state would overwrite the user's workouts.
  const [canSave, setCanSave] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (raw) {
          const saved = migrateRetiredExercises(JSON.parse(raw));
          setData({ ...EMPTY, ...saved, history: chronologicalHistory(saved.history ?? []), settings: { ...DEFAULT_SETTINGS, ...migrateGoalSettings(migrateVoiceSettings(migrateSettings(saved.settings))), onboarded: isOnboarded(saved.settings, saved.history) }, goals: migrateGoals(saved.goals) });
        }
        setCanSave(true);
      })
      .catch(() => setNotice("Couldn't read your saved workouts. Nothing was overwritten; changes this session won't be saved."))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready && canSave) AsyncStorage.setItem(storageKey, JSON.stringify(data)).catch(() => setNotice('Could not save to phone storage.'));
  }, [data, ready, canSave, storageKey]);

  const settings = data.settings;
  const update = (patch) => setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  // All speech goes through lib/sound.js (persona voice, on/off, interruptions, iOS silent mode).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const voice = useMemo(() => createVoice(
    { speak: (t, o) => Speech.speak(t, o), stop: () => Speech.stop(), setAudioMode: setAudioModeAsync },
    () => settingsRef.current,
  ), []);
  useEffect(() => { voice.enableAudio(); }, [voice]);
  // Device voices for the picker; until they load Jim uses the device default (lib/voices.js).
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    let alive = true;
    Speech.getAvailableVoicesAsync?.().then((raw) => { if (alive) setVoices(voice.setAvailableVoices(raw)); }).catch(() => {});
    return () => { alive = false; };
  }, [voice]);
  const say = voice.say;

  /** All logged sets in order, including the workout in progress. */
  const allSets = [...data.history, ...(data.active ? [data.active] : [])].flatMap((w) => w.sets);

  // A second start while a workout is open (double tap, retried request) keeps the open one.
  const startWorkout = (name, planned = null) =>
    setData((d) => (d.active ? d : { ...d, active: { id: newId(), name: name || 'Strength session', startedAt: new Date().toISOString(), sets: [], planned: withoutRetiredExercises(planned) } }));

  /** Logging requires an explicitly started workout. */
  const logSet = (body) => {
    if (isRetiredExercise(body?.exercise)) { setNotice('That exercise is no longer available.'); return null; }
    if (!data.active) {
      setNotice('Start a workout before recording a set.');
      return null;
    }
    const workoutId = data.active.id;
    const workouts = [...data.history, ...(data.active ? [data.active] : [])];
    const record = personalRecords(workouts, body).find((r) => r.exercise === body.exercise && r.unit === body.unit);
    const isPR = Boolean(record && (record.is_new_heaviest || record.is_new_volume));
    const set = { id: newId(), ...body, loggedAt: new Date().toISOString(), pr: isPR };
    setData((d) => appendWorkoutSet(d, set, workoutId));
    return { set, isPR };
  };

  /** Remove a set from the active workout or from history. */
  const deleteSet = (id) => setData((d) => applyDelete(d, id));

  /** Change fields of one set (active or history). Nothing else is recomputed. */
  const updateSet = (id, changes) => setData((d) => applyUpdate(d, id, changes));

  const finishWorkout = () =>
    setData((d) => {
      if (!d.active) return d;
      if (!d.active.sets.length) return { ...d, active: null }; // nothing logged: discard
      return { ...d, active: null, history: chronologicalHistory([...d.history, { ...d.active, finishedAt: new Date().toISOString() }]) };
    });

  const deleteWorkout = (id) => setData((d) => ({ ...d, history: d.history.filter((w) => w.id !== id) }));

  /** Restore an export: merges workouts by id; returns how many were added. Throws on bad input. */
  const importData = (text) => {
    const incoming = parseImport(text);
    const merged = mergeHistory(data.history, incoming.history);
    setData((d) => ({ ...d, history: mergeHistory(d.history, incoming.history), plan: d.plan ?? incoming.plan }));
    return merged.length - data.history.length;
  };

  // Workout Mission (lib/mission.js): a confirmed, time-boxed session that the Coach screen
  // runs hands-free. Its state lives here so it survives switching tabs.
  const startMission = (planned) =>
    setData((d) => ({
      ...d,
      active: d.active ?? { id: newId(), name: `Mission: ${planned.title}`, startedAt: new Date().toISOString(), sets: [], planned: missionPlanned(planned) },
      mission: { state: missionStart(planned), startedAt: Date.now() },
    }));
  const stepMission = (event) =>
    setData((d) => {
      if (!d.mission) return d;
      const state = missionStep(d.mission.state, event);
      if (state === d.mission.state) return d;
      const active = event.type === 'adjust_targets' && d.active?.planned?.mission
        ? { ...d.active, planned: missionPlanned(state.mission) }
        : d.active;
      return { ...d, active, mission: { ...d.mission, state } };
    });
  const endMission = () => setData((d) => ({ ...d, mission: null }));

  // Coach saves the workout set and advances the session in one state update.
  const saveCoachSet = (request) => {
    const workoutId = data.active?.id;
    if (!workoutId) return null;
    const body = request.set;
    if (isRetiredExercise(body?.exercise)) return null;
    const workouts = [...data.history, data.active];
    const record = personalRecords(workouts, body).find((r) => r.exercise === body.exercise && r.unit === body.unit);
    const now = Date.now();
    const set = {
      ...body, id: newId(), loggedAt: new Date(now).toISOString(),
      pr: Boolean(record && (record.is_new_heaviest || record.is_new_volume)),
    };
    setData((d) => applyCoachSet(d, { ...request, workoutId, set, now }));
    return set.id;
  };
  const clearCoachRest = (until) => setData((d) => {
    if (d.active?.coachRest?.until !== until) return d;
    return { ...d, active: { ...d.active, coachRest: null } };
  });

  // Saving keeps the previous plan in planVersions (lib/planVersions.js).
  const savePlan = (plan) => setData((d) => withSavedPlan(d, withoutRetiredExercises(plan)));
  // Weekly schedule for the saved program (lib/schedule.js). Edits don't create plan versions.
  const saveSchedule = (schedule) => setData((d) => (d.plan?.program?.id === schedule.programId ? { ...d, plan: { ...d.plan, schedule } } : d));
  const createDefaultSchedule = (program) => createSchedule(program, { timeZone: deviceTimeZone() });
  // Goals: measurable targets checked against logged history (see lib/goals.js).
  const addGoal = (goal) => setData((d) => ({ ...d, goals: [...(d.goals ?? []), { id: newId(), createdAt: new Date().toISOString(), ...goal }] }));
  const removeGoal = (id) => setData((d) => ({ ...d, goals: (d.goals ?? []).filter((g) => g.id !== id) }));
  const exportJSON = () => JSON.stringify({ format: 'jimbro-phone-export-v1', exportedAt: new Date().toISOString(), ...data }, null, 2);
  const eraseAll = () => { conversationRef.current.clear(); setData({ ...EMPTY, settings: data.settings }); };

  const value = {
    account, signOut: onSignOut,
    conversation: conversationRef.current,
    goals: data.goals ?? [], addGoal, removeGoal,
    mission: data.mission ?? null, startMission, stepMission, endMission,
    ready, notice, setNotice, settings, update, say, voice, voices,
    active: data.active, history: data.history, plan: data.plan, planVersions: data.planVersions ?? [], allSets,
    startWorkout, logSet, saveCoachSet, clearCoachRest, deleteSet, updateSet, finishWorkout, deleteWorkout, importData, savePlan, saveSchedule, createDefaultSchedule, exportJSON, eraseAll,
  };
  return (
    <Ctx.Provider value={value}>
      <LiveCameraProvider activeId={data.active?.id ?? null}>{children}</LiveCameraProvider>
    </Ctx.Provider>
  );
}
