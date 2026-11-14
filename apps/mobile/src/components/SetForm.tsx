import { useEffect, useState } from "react";
import { type ExerciseId, newId, type RepDetail, type SetPayload, type Unit } from "../api/client";

export const EXERCISES: { id: ExerciseId; name: string }[] = [
  { id: "curl", name: "Bicep curl" },
  { id: "squat", name: "Squat" },
  { id: "bench", name: "Bench press" },
  { id: "deadlift", name: "Deadlift" },
  { id: "shoulder_press", name: "Shoulder press" },
  { id: "pull_up", name: "Pull-up" },
];

interface Props {
  sessionId: string;
  onSubmit: (id: string, body: SetPayload) => Promise<void>;
  exercise?: ExerciseId;
  camera?: { reps: RepDetail[]; confidence: number | null };
  initial?: Partial<Pick<SetPayload, "weight" | "unit" | "reps" | "rpe">>;
  source?: SetPayload["source"];
}

export function SetForm({ sessionId, onSubmit, exercise: initialExercise = "curl", camera, initial, source }: Props) {
  const [exercise, setExercise] = useState<ExerciseId>(initialExercise);
  const [weight, setWeight] = useState(initial?.weight?.toString() ?? "");
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "kg");
  const [reps, setReps] = useState(String(camera?.reps.length ?? initial?.reps ?? ""));
  const [rpe, setRpe] = useState(initial?.rpe?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => setExercise(initialExercise), [initialExercise]);
  useEffect(() => {
    if (camera) setReps(String(camera.reps.length));
  }, [camera]);

  const w = Number(weight);
  const r = Number(reps);
  const p = rpe === "" ? null : Number(rpe);
  const valid =
    weight !== "" && reps !== "" && w >= 0 && Number.isInteger(r) && r >= 0 &&
    (p === null || (p >= 1 && p <= 10));
  const usesCamera = camera !== undefined && camera.reps.length === r;

  const save = async () => {
    setBusy(true);
    try {
      await onSubmit(newId(), {
        session_id: sessionId,
        exercise,
        weight: w,
        unit,
        reps: r,
        rpe: p,
        source: usesCamera ? "camera" : (source ?? "manual"),
        reps_detail: usesCamera ? camera.reps : [],
        confidence: usesCamera ? camera.confidence : null,
        model_version: usesCamera ? "reps-v1" : null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (valid) void save(); }}>
      <div className="grid2">
        <label>
          Exercise
          <select value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseId)}>
            {EXERCISES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label>
          Reps
          <input type="number" inputMode="numeric" min={0} value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
        <label>
          Weight
          <input type="number" inputMode="decimal" min={0} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </label>
        <label>
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label>
          RPE (optional)
          <input type="number" inputMode="decimal" min={1} max={10} step="0.5" value={rpe} onChange={(e) => setRpe(e.target.value)} />
        </label>
      </div>
      {camera && !usesCamera && <p className="muted small">Rep count edited: per-rep timing won't be saved.</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" type="submit" disabled={!valid || busy}>Save set</button>
      </div>
    </form>
  );
}
