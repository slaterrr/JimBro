# Jim Bro — Shared project context

Paste this at the top of every role prompt.

```
PROJECT: Jim Bro, an AI gym companion that uses the device camera to track
exercises, count reps and give coaching feedback.

STACK
- Frontend: React + TypeScript + Tailwind CSS (Vite)
- Computer vision: TypeScript, MediaPipe Pose Landmarker (runs in the browser)
- Backend: Python, FastAPI, SQLite (SQLAlchemy or SQLModel)

REPO LAYOUT
/frontend        React app
/frontend/src/cv CV modules (owned by the CV engineer, consumed by the frontend)
/shared          Shared TypeScript types (single source of truth for data shapes)
/backend         FastAPI app

SCOPE FOR V1
- Exercise: squats only. Do not add other exercises until squat tracking is reliable.
- No user accounts in v1 unless the backend role says otherwise. Use a single local user.

SHARED DATA CONTRACT (all roles must conform; changes require updating all three)
type MetricSource = "measured" | "estimated";

interface Metric {
  value: number;
  unit: string;            // "deg", "ms", "%", "reps"
  source: MetricSource;    // measured = directly observed; estimated = inferred
  confidence?: number;     // 0–1, required when source === "estimated"
}

type SquatPhase = "standing" | "descending" | "bottom" | "ascending";

interface PoseFrame {               // live, not persisted
  timestamp: number;
  phase: SquatPhase;
  kneeAngle: number | null;         // null if landmarks below confidence threshold
  hipAngle: number | null;
  landmarksVisible: boolean;
}

interface RepEvent {                // emitted once per completed, valid rep
  repNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  minKneeAngle: Metric;             // measured
  depthReached: boolean;
  formFlags: FormFlag[];
}

interface FormFlag {
  code: string;                     // e.g. "SHALLOW_DEPTH", "UNEVEN_TEMPO"
  message: string;
  source: MetricSource;
}

interface WorkoutSession {
  id: string;
  exercise: "squat";
  startedAt: string;                // ISO 8601
  endedAt: string | null;
  reps: RepEvent[];
  summary: {
    totalReps: number;
    avgRepDurationMs: Metric;
    tempoConsistency: Metric;       // e.g. coefficient of variation of rep durations
    depthConsistency: Metric;
  } | null;
}

HONESTY RULE (applies to every role)
Never present a metric as measured unless the camera can actually observe it.
Every metric shown to the user must be labelled measured or estimated.
Do not invent or hardcode live workout data. Mock data is allowed only behind
an explicit dev flag (for example VITE_USE_MOCKS=true) and must never appear in production builds.
```
