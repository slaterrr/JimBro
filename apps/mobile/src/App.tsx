import { useCallback, useState } from "react";
import type { ExerciseId, RepDetail } from "./api/client";
import { LiveWorkout, type RepEvent } from "./components/LiveWorkout";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import { SetForm } from "./components/SetForm";
import type { Movement } from "./pose/angles";
import { useWorkout } from "./state/useWorkout";

type Tab = "train" | "log";

const toDetail = (r: RepEvent): RepDetail => ({
  index: r.index,
  concentric_ms: r.concentric_ms,
  peak_pause_ms: r.peak_pause_ms,
  eccentric_ms: r.eccentric_ms,
});

export function App() {
  const [tab, setTab] = useState<Tab>("train");
  const workout = useWorkout();
  const [camera, setCamera] = useState<{ movement: Movement; reps: RepDetail[] }>({ movement: "curl", reps: [] });
  const onReps = useCallback(
    (reps: RepEvent[], movement: Movement) => setCamera({ movement, reps: reps.map(toDetail) }),
    [],
  );

  return (
    <main className="app">
      <header className="top">
        <h1>JimBro</h1>
        {workout.sessionId && <button onClick={workout.endWorkout}>End workout</button>}
      </header>
      {workout.notice && <p className="muted small" role="status">{workout.notice}</p>}
      {workout.pending > 0 && <p className="small" style={{ color: "var(--warn)" }}>{workout.pending} set(s) waiting to sync</p>}

      {tab === "train" && (
        <>
          <LiveWorkout onRepsChange={onReps} />
          {camera.reps.length > 0 && (
            <>
              <h2>Save this set</h2>
              <SetForm
                sessionId={workout.sessionId ?? ""}
                exercise={camera.movement as ExerciseId}
                camera={{ reps: camera.reps, confidence: null }}
                onSubmit={workout.logSet}
              />
            </>
          )}
        </>
      )}

      {tab === "log" && (
        <>
          <h2>Log a set manually</h2>
          <SetForm sessionId={workout.sessionId ?? ""} onSubmit={workout.logSet} />
          <SessionSummaryCard summary={workout.summary} />
        </>
      )}

      <p className="muted small">
        Video stays on your phone; only joint angles go to the Pi. TUT is estimated
        movement-phase timing, not measured muscle tension. Not a clinical assessment.
      </p>
      <nav className="tabs">
        {(["train", "log"] as Tab[]).map((t) => (
          <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
            {t === "train" ? "Train" : "Log"}
          </button>
        ))}
      </nav>
    </main>
  );
}
