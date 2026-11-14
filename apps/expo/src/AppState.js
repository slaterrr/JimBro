import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { applyDelete, applyUpdate } from './lib/intents.js';
import { migrateGoals } from './lib/goals.js';
import { migrateSettings, speechOptions } from './lib/personas.js';
import { personalRecords } from './lib/progress.js';
import { mergeHistory, parseImport } from './lib/tools.js';

// Everything lives on this phone: no server, no account.
const KEY = 'jimbro.data.v2';
export const DEFAULT_SETTINGS = { persona: 'coach', speak: false, unit: 'lb', weeklyGoal: 3, restSeconds: 90 };
const EMPTY = { settings: DEFAULT_SETTINGS, active: null, history: [], plan: null, goals: [] };

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
        setData({ ...EMPTY, ...saved, settings: { ...DEFAULT_SETTINGS, ...migrateSettings(saved.settings) }, goals: migrateGoals(saved.goals) });
      })
      .catch(() => setNotice('Phone storage unavailable; data will not be kept.'))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => setNotice('Could not save to phone storage.'));
  }, [data, ready]);

  const settings = data.settings;
  const update = (patch) => setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  // Jim speaks with the selected persona's voice. `force` plays even when spoken replies are off; `persona` overrides the voice (persona samples).
  const say = useCallback((text, { force = false, persona = settings.persona } = {}) => {
    if (!text || !(force || settings.speak)) return;
    if (force) Speech.stop();
    Speech.speak(text, speechOptions(persona));
  }, [settings.speak, settings.persona]);

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

  /** Remove a set from the active workout or from history. */
  const deleteSet = (id) => setData((d) => applyDelete(d, id));

  /** Change fields of one set (active or history). Nothing else is recomputed. */
  const updateSet = (id, changes) => setData((d) => applyUpdate(d, id, changes));

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
  // Goals: measurable targets checked against logged history (see lib/goals.js).
  const addGoal = (goal) => setData((d) => ({ ...d, goals: [...(d.goals ?? []), { id: newId(), createdAt: new Date().toISOString(), ...goal }] }));
  const removeGoal = (id) => setData((d) => ({ ...d, goals: (d.goals ?? []).filter((g) => g.id !== id) }));
  const exportJSON = () => JSON.stringify({ format: 'jimbro-phone-export-v1', exportedAt: new Date().toISOString(), ...data }, null, 2);
  const eraseAll = () => setData({ ...EMPTY, settings: data.settings });

  const value = {
    goals: data.goals ?? [], addGoal, removeGoal,
    ready, notice, setNotice, settings, update, say,
    active: data.active, history: data.history, plan: data.plan, allSets,
    startWorkout, logSet, deleteSet, updateSet, finishWorkout, deleteWorkout, importData, savePlan, exportJSON, eraseAll,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
