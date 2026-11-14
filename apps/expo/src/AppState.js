import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { restBefore } from './lib/analytics.js';
import { GOAL_LABEL, migrateData } from './lib/migrate.js';
import { personalRecords } from './lib/progress.js';
import { mergeHistory, parseImport } from './lib/tools.js';

// Everything lives on this phone: no server, no account.
const KEY = 'jimbro.data.v2';
export const DEFAULT_SETTINGS = { tone: 'friendly', speak: false, unit: 'lb', weeklyGoal: 3, restSeconds: 90 };
const EMPTY = { settings: DEFAULT_SETTINGS, active: null, history: [], plan: null };


export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        setData(migrateData(JSON.parse(raw), EMPTY, DEFAULT_SETTINGS));
      })
      .catch(() => setNotice('Phone storage unavailable; data will not be kept.'))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => setNotice('Could not save to phone storage.'));
  }, [data, ready]);

  const settings = data.settings;
  const update = (patch) => setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const say = useCallback((text) => { if (settings.speak) Speech.speak(text); }, [settings.speak]);

  /** All logged sets in order, including the workout in progress. */
  const allSets = [...data.history, ...(data.active ? [data.active] : [])].flatMap((w) => w.sets);

  const startWorkout = (name, planned = null) =>
    setData((d) => ({
      ...d,
      active: {
        id: newId(),
        name: name || 'Strength session',
        startedAt: new Date().toISOString(),
        sets: [],
        planned,
        // The training program a plan day came from, for filtering progress.
        program: planned && d.plan?.goal ? GOAL_LABEL[d.plan.goal] ?? d.plan.goal : null,
      },
    }));

  /** Log a set (starting a workout if needed). Returns the set and any record it beat. */
  const logSet = (body, workoutName = 'Quick log') => {
    const workouts = [...data.history, ...(data.active ? [data.active] : [])];
    const record = personalRecords(workouts, body).find((r) => r.exercise === body.exercise && r.unit === body.unit);
    const isPR = Boolean(record && (record.is_new_heaviest || record.is_new_volume));
    const set = { completed: true, ...body, id: newId(), loggedAt: new Date().toISOString(), pr: isPR };
    setData((d) => {
      const cur = d.active ?? { id: newId(), name: workoutName, startedAt: set.loggedAt, sets: [], planned: null };
      // Rest = time since the previous set in this workout (when under 10 minutes), unless given.
      const rest = set.restSec ?? restBefore({ sets: [...cur.sets, set] })[set.id] ?? null;
      return { ...d, active: { ...cur, sets: [...cur.sets, { ...set, restSec: rest }] } };
    });
    return { set, isPR };
  };

  const deleteSet = (id) => setData((d) => (d.active ? { ...d, active: { ...d.active, sets: d.active.sets.filter((x) => x.id !== id) } } : d));

  const finishWorkout = () =>
    setData((d) => {
      if (!d.active) return d;
      if (!d.active.sets.length) return { ...d, active: null }; // nothing logged: discard
      return { ...d, active: null, history: [...d.history, { ...d.active, finishedAt: new Date().toISOString() }] };
    });

  const deleteWorkout = (id) => setData((d) => ({ ...d, history: d.history.filter((w) => w.id !== id) }));

  /** Apply `fn` to the workout with this id, in history or the active one. */
  const editWorkoutById = (d, id, fn) => ({
    ...d,
    history: d.history.map((w) => (w.id === id ? fn(w) : w)),
    active: d.active?.id === id ? fn(d.active) : d.active,
  });

  /** Edit a workout's own fields (name, notes, program). */
  const updateWorkout = (id, patch) => setData((d) => editWorkoutById(d, id, (w) => ({ ...w, ...patch })));

  /** Edit a logged set anywhere in history. Records and stats are recomputed from history, so nothing goes stale. */
  const updateSet = (workoutId, setId, patch) =>
    setData((d) => editWorkoutById(d, workoutId, (w) => ({ ...w, sets: w.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) })));

  /** Remove one set from any workout; a finished workout left with no sets is removed too. */
  const removeSet = (workoutId, setId) =>
    setData((d) => {
      const next = editWorkoutById(d, workoutId, (w) => ({ ...w, sets: w.sets.filter((s) => s.id !== setId) }));
      return { ...next, history: next.history.filter((w) => w.sets.length) };
    });

  /** Restore an export: merges workouts by id; returns how many were added. Throws on bad input. */
  const importData = (text) => {
    const incoming = parseImport(text);
    const merged = mergeHistory(data.history, incoming.history);
    setData((d) => migrateData({ ...d, history: mergeHistory(d.history, incoming.history), plan: d.plan ?? incoming.plan }, EMPTY, DEFAULT_SETTINGS));
    return merged.length - data.history.length;
  };

  const savePlan = (plan) => setData((d) => ({ ...d, plan }));
  const exportJSON = () => JSON.stringify({ format: 'jimbro-phone-export-v1', exportedAt: new Date().toISOString(), ...data }, null, 2);
  const eraseAll = () => setData({ ...EMPTY, settings: data.settings });

  const value = {
    ready, notice, setNotice, settings, update, say,
    active: data.active, history: data.history, plan: data.plan, allSets,
    startWorkout, logSet, deleteSet, finishWorkout, deleteWorkout, updateWorkout, updateSet, removeSet,
    importData, savePlan, exportJSON, eraseAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
