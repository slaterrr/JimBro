import { useEffect, useReducer, useState } from "react";
import { LiveClient, type LiveStatus } from "../live/client";
import { applyStationEvent, initialStation } from "./reducer";

const NAMES: Record<string, string> = {
  curl: "Bicep curl", squat: "Squat", shoulder_press: "Shoulder press", bench: "Bench press",
  deadlift: "Deadlift", pull_up: "Pull-up",
};

/** Full-screen display for the Pi's own monitor (kiosk browser at /station). */
export function Station() {
  const [state, dispatch] = useReducer(applyStationEvent, initialStation);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const url = `${location.origin.replace(/^http/, "ws")}/v1/station`;
    const client = new LiveClient(url, (e) => dispatch(e as never), WebSocket, setStatus);
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => {
      client.close();
      clearInterval(t);
    };
  }, []);

  const press = () => void fetch("/v1/station/button", { method: "POST" }).catch(() => undefined);

  return (
    <main className="station" onClick={press}>
      <header className="row" style={{ justifyContent: "space-between" }}>
        <strong>JimBro Station</strong>
        <span className={`badge ${status === "open" ? "ok" : "low"}`}>{status}</span>
        <span className="muted">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </header>
      <section className="station-main">
        <div className="muted">{state.movement ? NAMES[state.movement] ?? state.movement : "Waiting for a set…"}</div>
        <div className="station-count" data-testid="station-reps">{state.reps}</div>
        <div className="muted">reps</div>
        {state.lastTutMs !== null && (
          <div className="station-sub">last rep est. TUT {(state.lastTutMs / 1000).toFixed(1)}s</div>
        )}
      </section>
      {state.lastSet && (
        <footer className="station-sub">
          Saved: {NAMES[state.lastSet.exercise] ?? state.lastSet.exercise} · {state.lastSet.reps} reps @ {state.lastSet.weight} {state.lastSet.unit}
        </footer>
      )}
    </main>
  );
}
