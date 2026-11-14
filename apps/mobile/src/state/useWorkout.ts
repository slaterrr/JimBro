import { useCallback, useEffect, useMemo, useState } from "react";
import { api, post, type Session, type SessionSummary, type SetPayload, SetQueue } from "../api/client";

const SESSION_KEY = "jimbro.session";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Current workout session + offline-safe set logging. */
export function useWorkout() {
  const [sessionId, setSessionId] = useState<string | null>(() => read(SESSION_KEY));
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const queue = useMemo(
    () => new SetQueue(undefined, localStorage, (_id, err) => setNotice(`A set was rejected: ${err.message}`)),
    [],
  );

  const refresh = useCallback(async () => {
    setPending(queue.pending().length);
    if (!sessionId) return setSummary(null);
    try {
      setSummary(await api<SessionSummary>(`/v1/sessions/${sessionId}/summary`));
    } catch {
      /* offline: keep last summary */
    }
  }, [queue, sessionId]);

  useEffect(() => {
    void queue.flush().then(refresh);
    const onOnline = () => void queue.flush().then(refresh);
    window.addEventListener("online", onOnline);
    const timer = setInterval(onOnline, 15_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [queue, refresh]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const s = await post<Session>("/v1/sessions", {});
    localStorage.setItem(SESSION_KEY, s.id);
    setSessionId(s.id);
    return s.id;
  }, [sessionId]);

  const logSet = useCallback(
    async (id: string, body: SetPayload) => {
      const sid = await ensureSession();
      await queue.submit(id, { ...body, session_id: sid });
      setNotice(queue.pending().length ? "Saved on phone; will sync when the Pi is reachable." : "Set saved.");
      await refresh();
    },
    [ensureSession, queue, refresh],
  );

  const endWorkout = useCallback(async () => {
    if (!sessionId) return;
    await post<Session>(`/v1/sessions/${sessionId}/end`, {}).catch(() => undefined);
    localStorage.removeItem(SESSION_KEY);
    setSessionId(null);
    setSummary(null);
    setNotice("Workout ended.");
  }, [sessionId]);

  return { sessionId, summary, notice, pending, logSet, endWorkout, ensureSession, refresh };
}

export type Workout = ReturnType<typeof useWorkout>;
