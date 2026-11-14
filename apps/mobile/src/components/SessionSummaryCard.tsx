import type { SessionSummary } from "../api/client";
import { EXERCISES } from "./SetForm";

const name = (id: string) => EXERCISES.find((e) => e.id === id)?.name ?? id;

export function SessionSummaryCard({ summary }: { summary: SessionSummary | null }) {
  if (!summary) return <p className="muted">No sets logged in this workout yet.</p>;
  const volume = Object.entries(summary.volume).map(([u, v]) => `${Math.round(v * 10) / 10} ${u}`);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>This workout</strong>
        <span className="muted small">
          {summary.total_reps} reps · {volume.join(" + ") || "0"} volume
        </span>
      </div>
      <table>
        <thead>
          <tr><th>Exercise</th><th>Load</th><th>Reps</th><th>RPE</th><th>Avg TUT</th></tr>
        </thead>
        <tbody>
          {summary.sets.map((s) => (
            <tr key={s.id}>
              <td>{name(s.exercise)}</td>
              <td>{s.weight} {s.unit}</td>
              <td>{s.reps}{s.source === "camera" ? " 📷" : ""}</td>
              <td>{s.rpe ?? "–"}</td>
              <td>{s.avg_tut_ms === null ? "–" : `${(s.avg_tut_ms / 1000).toFixed(1)}s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
