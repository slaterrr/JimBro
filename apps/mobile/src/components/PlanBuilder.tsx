import { useState } from "react";
import { post } from "../api/client";

type Goal = "strength" | "hypertrophy" | "general";
interface Item { exercise: string; sets: number; reps_low: number; reps_high: number; rest_min: number }
interface Plan { goal: Goal; notes: string[]; days: { day: number; estimated_minutes: number; items: Item[] }[] }

const EQUIPMENT = [
  ["dumbbells", "Dumbbells"],
  ["barbell", "Barbell"],
  ["pullup_bar", "Pull-up bar"],
  ["bodyweight", "Bodyweight"],
] as const;

export function PlanBuilder() {
  const [goal, setGoal] = useState<Goal>("general");
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(45);
  const [equipment, setEquipment] = useState<string[]>(["dumbbells", "barbell"]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setEquipment((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  const build = async () => {
    setError(null);
    try {
      setPlan(await post<Plan>("/v1/plans", { goal, days_per_week: days, minutes_per_session: minutes, equipment }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build plan");
    }
  };

  return (
    <div className="card">
      <strong>Weekly plan</strong>
      <div className="grid2" style={{ marginTop: 8 }}>
        <label>Goal
          <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
            <option value="general">General fitness</option>
            <option value="strength">Strength</option>
            <option value="hypertrophy">Muscle size</option>
          </select>
        </label>
        <label>Days per week
          <input type="number" min={1} max={6} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
        <label>Minutes per session
          <input type="number" min={10} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {EQUIPMENT.map(([id, name]) => (
          <label key={id} className="row" style={{ gap: 4 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={equipment.includes(id)} onChange={() => toggle(id)} />
            {name}
          </label>
        ))}
      </div>
      <button className="primary" style={{ marginTop: 8 }} disabled={!equipment.length} onClick={() => void build()}>
        Build plan
      </button>
      {error && <p className="error">{error}</p>}
      {plan && (
        <div>
          {plan.days.map((d) => (
            <div key={d.day} style={{ marginTop: 10 }}>
              <strong>Day {d.day}</strong> <span className="muted small">~{Math.round(d.estimated_minutes)} min</span>
              <ul>
                {d.items.map((i) => (
                  <li key={i.exercise}>
                    {i.exercise.replace("_", " ")}: {i.sets} × {i.reps_low}–{i.reps_high}, rest {i.rest_min} min
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {plan.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
        </div>
      )}
    </div>
  );
}
