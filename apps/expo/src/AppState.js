import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { createApi } from './lib/api.js';
import { DEFAULT_SERVER, wsUrl } from './lib/config.js';
import { SetQueue } from './lib/queue.js';
import { applyStationEvent, initialStation } from './lib/station.js';

const SETTINGS_KEY = 'jimbro.settings.v1';
const WORKOUT_KEY = 'jimbro.workout.v1';
const DEFAULT_SETTINGS = { server: DEFAULT_SERVER, athlete: 'me', tone: 'friendly', speak: false, unit: 'lb' };

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function useStationFeed(base, enabled) {
  const [state, dispatch] = useReducer(applyStationEvent, initialStation);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let ws;
    let closed = false;
    let attempt = 0;
    let timer;
    const connect = () => {
      ws = new WebSocket(wsUrl(base, '/v1/station'));
      ws.onopen = () => { attempt = 0; setConnected(true); };
      ws.onmessage = (e) => {
        try { dispatch(JSON.parse(e.data)); } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(500 * 2 ** attempt, 10000));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [base, enabled]);
  return { station: state, stationConnected: connected };
}

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [workout, setWorkout] = useState({ active: null, history: [] });
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(null); // null = unknown yet
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(SETTINGS_KEY), AsyncStorage.getItem(WORKOUT_KEY)])
      .then(([s, w]) => {
        if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
        if (w) setWorkout({ active: null, history: [], ...JSON.parse(w) });
      })
      .catch(() => setNotice('Phone storage unavailable; data will not be kept.'))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => { if (ready) AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {}); }, [settings, ready]);
  useEffect(() => { if (ready) AsyncStorage.setItem(WORKOUT_KEY, JSON.stringify(workout)).catch(() => {}); }, [workout, ready]);

  const api = useMemo(() => createApi({ base: settings.server, athlete: settings.athlete }), [settings.server, settings.athlete]);
  const queue = useMemo(
    () => new SetQueue(api, AsyncStorage, (_id, e) => setNotice(`The Pi rejected a set: ${e.message}`)),
    [api],
  );

  const sync = useCallback(async () => {
    try {
      await api.status();
      setOnline(true);
      await queue.flush();
    } catch {
      setOnline(false);
    }
    setPending((await queue.pending()).length);
  }, [api, queue]);

  useEffect(() => {
    if (!ready) return undefined;
    sync();
    const t = setInterval(sync, 15000);
    return () => clearInterval(t);
  }, [ready, sync]);

  const { station, stationConnected } = useStationFeed(settings.server, ready && online === true);

  const say = useCallback((text) => { if (settings.speak) Speech.speak(text); }, [settings.speak]);
  const update = (patch) => setSettings((cur) => ({ ...cur, ...patch }));

  const startWorkout = (name) =>
    setWorkout((w) => ({ ...w, active: { id: newId(), name: name || 'Strength session', startedAt: new Date().toISOString(), sets: [] } }));

  /** Log a set; starts a workout first if none is active (e.g. a set told to Jim). */
  const logSet = useCallback(async (body, workoutName = 'Logged with Jim') => {
    const active = workout.active ?? { id: newId(), name: workoutName, startedAt: new Date().toISOString(), sets: [] };
    const id = newId();
    const set = { id, ...body, loggedAt: new Date().toISOString() };
    setWorkout((w) => {
      const cur = w.active && w.active.id === active.id ? w.active : active;
      return { ...w, active: { ...cur, sets: [...cur.sets, set] } };
    });
    await queue.submit(id, active.id, body);
    const left = (await queue.pending()).length;
    setPending(left);
    setNotice(left ? 'Saved on your phone; it will sync when the Pi is reachable.' : 'Set saved to your Pi.');
    return set;
  }, [workout.active, queue]);

  const finishWorkout = useCallback(async () => {
    const active = workout.active;
    if (!active) return;
    setWorkout((w) => ({ active: null, history: [...w.history, { ...w.active, finishedAt: new Date().toISOString() }].slice(-200) }));
    const serverId = await queue.sessionFor(active.id);
    if (serverId) api.endSession(serverId).catch(() => {});
  }, [workout.active, queue, api]);

  const value = {
    ready, settings, update, api, online, pending, notice, setNotice, sync, say,
    workout, startWorkout, logSet, finishWorkout, station, stationConnected,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
