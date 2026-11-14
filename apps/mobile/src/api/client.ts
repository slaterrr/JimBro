/** Typed client for the Pi API plus an offline-safe set submission queue. */

export type ExerciseId = "curl" | "squat" | "bench" | "deadlift" | "shoulder_press" | "pull_up";
export type Unit = "kg" | "lb";

export interface Exercise { id: ExerciseId; name: string; camera_tracking: boolean }
export interface RepDetail { index: number; concentric_ms: number; peak_pause_ms: number; eccentric_ms: number }
export interface SetPayload {
  session_id: string;
  exercise: ExerciseId;
  weight: number;
  unit: Unit;
  reps: number;
  rpe: number | null;
  source: "camera" | "manual" | "voice";
  confidence?: number | null;
  model_version?: string | null;
  reps_detail: RepDetail[];
}
export interface SetRecord extends SetPayload {
  id: string;
  completed_at: string;
  reps_detail: (RepDetail & { tut_ms: number })[];
  avg_tut_ms: number | null;
}
export interface Session { id: string; athlete_id: string; started_at: string; ended_at: string | null; notes: string | null }
export interface SessionSummary extends Session { sets: SetRecord[]; total_reps: number; volume: Partial<Record<Unit, number>> }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const ATHLETE_KEY = "jimbro.athlete";

export function athleteId(): string {
  try {
    return localStorage.getItem(ATHLETE_KEY) || "me";
  } catch {
    return "me";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Athlete-Id": athleteId(), ...init.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const sendSet = (id: string, body: SetPayload) =>
  post<SetRecord>(`/v1/sets/${encodeURIComponent(id)}/complete`, body);

type Sender = (id: string, body: SetPayload) => Promise<unknown>;
interface Pending { id: string; body: SetPayload }

const QUEUE_KEY = "jimbro.pendingSets";

/**
 * Sets are keyed by a client id, so resending after a dropped response is safe:
 * the Pi returns the stored record instead of logging the set twice.
 */
export class SetQueue {
  constructor(
    private readonly send: Sender = sendSet,
    private readonly storage: Storage = localStorage,
    private readonly onRejected: (id: string, error: ApiError) => void = () => {},
  ) {}

  pending(): Pending[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(QUEUE_KEY) ?? "[]");
      return Array.isArray(parsed) ? (parsed as Pending[]) : [];
    } catch {
      return [];
    }
  }

  private save(items: Pending[]) {
    this.storage.setItem(QUEUE_KEY, JSON.stringify(items));
  }

  async submit(id: string, body: SetPayload): Promise<void> {
    if (!this.pending().some((p) => p.id === id)) this.save([...this.pending(), { id, body }]);
    await this.flush();
  }

  /** Try every pending set once; return how many were accepted. */
  async flush(): Promise<number> {
    let sent = 0;
    for (const item of this.pending()) {
      try {
        await this.send(item.id, item.body);
        sent += 1;
      } catch (error) {
        const permanent = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (!permanent) continue;
        this.onRejected(item.id, error);
      }
      this.save(this.pending().filter((p) => p.id !== item.id));
    }
    return sent;
  }
}
