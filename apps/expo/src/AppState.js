import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
        const saved = JSON.parse(raw);
        setData({ ...EMPTY, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } });
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
    setData((d) => ({ ...d, active: { id: newId(), name: name || 'Strength session', startedAt: new Date().toISOString(), sets: [], planned } }));

  /** Log a set (starting a workout if needed). Returns the set and any record it beat. */
  const logSet = (body, workoutName = 'Quick log') => {
    const workouts = [...data.history, ...(data.active ? [data.active] : [])];
    const record = personalRecords(workouts, body).find((r) => r.exercise === body.exercise && r.unit === body.unit);
    const isPR = Boolean(record && (record.is_new_heaviest || record.is_new_volume));
    const set = { id: newId(), ...body, loggedAt: new Date().toISOString(), pr: isPR };
    setData((d) => {
      const cur = d.active ?? { id: newId(), name: workoutName, startedAt: set.loggedAt, sets: [], planned: null };
      return { ...d, active: { ...cur, sets: [...cur.sets, set] } };
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

  /** Restore an export: merges workouts by id; returns how many were added. Throws on bad input. */
  const importData = (text) => {
    const incoming = parseImport(text);
    const merged = mergeHistory(data.history, incoming.history);
    setData((d) => ({ ...d, history: mergeHistory(d.history, incoming.history), plan: d.plan ?? incoming.plan }));
    return merged.length - data.history.length;
  };

  const savePlan = (plan) => setData((d) => ({ ...d, plan }));
  const exportJSON = () => JSON.stringify({ format: 'jimbro-phone-export-v1', exportedAt: new Date().toISOString(), ...data }, null, 2);
  const eraseAll = () => setData({ ...EMPTY, settings: data.settings });

  const value = {
    ready, notice, setNotice, settings, update, say,
    active: data.active, history: data.history, plan: data.plan, allSets,
    startWorkout, logSet, deleteSet, finishWorkout, deleteWorkout, importData, savePlan, exportJSON, eraseAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
