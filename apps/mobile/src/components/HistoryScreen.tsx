import { useCallback, useEffect, useState } from "react";
import { api, type ExerciseId, post } from "../api/client";
import { EXERCISES } from "./SetForm";
import { TrendChart } from "./TrendChart";

interface TrendPoint { session_id: string; date: string; top_weight: number; volume: number; reps: number; avg_tut_ms: number | null }
interface UnitTrend { points: TrendPoint[]; top_weight_change_pct: number | null; volume_change_pct: number | null; tut_change_pct: number | null }
interface Progress { exercise: ExerciseId; by_unit: Record<string, UnitTrend> }
interface Entry { rank: number; display_name: string; value: number; demo: boolean }
interface Board { week: string; metric: "reps" | "sessions"; entries: Entry[] }
interface Me { id: string; display_name: string | null; leaderboard_opt_in: boolean }

const pct = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${v}%`);

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{value}</div>
      <div className="muted small">{note}</div>
    </div>
  );
}

export function HistoryScreen() {
  const [exercise, setExercise] = useState<ExerciseId>("curl");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [metric, setMetric] = useState<Board["metric"]>("reps");
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    api<Progress>(`/v1/progress/${exercise}`).then(setProgress).catch(() => setProgress(null));
  }, [exercise]);

  const loadBoard = useCallback(() => {
    api<Board>(`/v1/leaderboard?metric=${metric}`).then(setBoard).catch(() => setBoard(null));
  }, [metric]);
  useEffect(loadBoard, [loadBoard]);

  useEffect(() => {
    api<Me>("/v1/athletes/me").then((m) => { setMe(m); setName(m.display_name ?? ""); }).catch(() => undefined);
  }, []);

  const saveProfile = async (optIn: boolean) => {
    setMe(await api<Me>("/v1/athletes/me", { method: "PUT", body: JSON.stringify({ display_name: name, leaderboard_opt_in: optIn }) }));
    loadBoard();
  };

  const units = Object.entries(progress?.by_unit ?? {});

  return (
    <section>
      <label>
        Exercise
        <select value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseId)}>
          {EXERCISES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>

      {units.length === 0 && <p className="muted">No history for this exercise yet.</p>}
      {units.map(([unit, t]) => (
        <div key={unit} className="card">
          <div className="grid2">
            <Stat label="Top weight" value={pct(t.top_weight_change_pct)} note={`first → latest of ${t.points.length} sessions`} />
            <Stat label="Volume" value={pct(t.volume_change_pct)} note={`${unit} × reps, same unit only`} />
          </div>
          {t.tut_change_pct !== null && (
            <p className="muted small">Est. TUT per rep {pct(t.tut_change_pct)} (camera sets only)</p>
          )}
          <TrendChart
            title="Top weight"
            unit={unit}
            points={t.points.map((p) => ({ label: p.date.slice(5), value: p.top_weight }))}
          />
        </div>
      ))}

      <h2>Weekly leaderboard</h2>
      <div className="card">
        <div className="row">
          <label style={{ flex: 1 }}>
            Display name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <button disabled={!name.trim()} onClick={() => void saveProfile(!me?.leaderboard_opt_in)}>
            {me?.leaderboard_opt_in ? "Leave leaderboard" : "Join leaderboard"}
          </button>
        </div>
        <p className="muted small">Opt-in only. Ranked by reps or sessions this week, so units never mix.</p>
        <div className="row">
          <select value={metric} onChange={(e) => setMetric(e.target.value as Board["metric"])} style={{ width: "auto" }}>
            <option value="reps">Total reps</option>
            <option value="sessions">Sessions</option>
          </select>
          <button onClick={() => void post("/v1/demo/seed", {}).then(loadBoard)}>Add demo athletes</button>
        </div>
        {board && (
          <table>
            <thead><tr><th>#</th><th>Athlete</th><th>{metric}</th></tr></thead>
            <tbody>
              {board.entries.map((e) => (
                <tr key={e.display_name}>
                  <td>{e.rank}</td>
                  <td>{e.display_name}{e.demo && <span className="muted small"> · sample data</span>}</td>
                  <td>{e.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {board && <p className="muted small">Week {board.week}</p>}
      </div>
    </section>
  );
}
