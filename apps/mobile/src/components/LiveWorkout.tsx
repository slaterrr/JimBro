import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { athleteId } from "../api/client";
import { LiveClient, type LiveEvent, type LiveStatus, liveUrl } from "../live/client";
import { download, TraceRecorder, traceFilename } from "../live/trace";
import { movementAngle, type Movement } from "../pose/angles";
import { CameraView, type PoseFrame } from "./CameraView";

export type RepEvent = Extract<LiveEvent, { type: "rep" }>;

interface Client {
  sendSample(t: number, angle: number, confidence: number): void;
  reset(): void;
  close(): void;
}

type Connect = (
  movement: Movement,
  onEvent: (e: LiveEvent) => void,
  onStatus: (s: LiveStatus) => void,
) => Client;

const defaultConnect: Connect = (movement, onEvent, onStatus) =>
  new LiveClient(`${liveUrl(location.origin, movement)}?athlete=${encodeURIComponent(athleteId())}`, onEvent, WebSocket, onStatus);

export const MOVEMENT_LABEL: Record<Movement, string> = {
  curl: "Bicep curl",
  squat: "Squat",
  shoulder_press: "Shoulder press",
};

interface Props {
  connect?: Connect;
  camera?: ComponentType<{ onFrame: (f: PoseFrame) => void }>;
  onRepsChange?: (reps: RepEvent[], movement: Movement) => void;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function LiveWorkout({ connect = defaultConnect, camera: Camera = CameraView, onRepsChange }: Props) {
  const [movement, setMovement] = useState<Movement>("curl");
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [reps, setReps] = useState<RepEvent[]>([]);
  const [partials, setPartials] = useState(0);
  const [phase, setPhase] = useState("rest");
  const clientRef = useRef<Client | null>(null);
  const traceRef = useRef(new TraceRecorder());
  const [trueReps, setTrueReps] = useState("");
  const [side, setSide] = useState("front");
  const [light, setLight] = useState("normal");
  const onRepsRef = useRef(onRepsChange);
  onRepsRef.current = onRepsChange;

  useEffect(() => {
    setReps([]);
    setPartials(0);
    const client = connect(
      movement,
      (e) => {
        if (e.type === "rep") setReps((r) => [...r, e]);
        if (e.type === "state") {
          setPhase(e.state);
          setPartials(e.partials);
        }
      },
      setStatus,
    );
    clientRef.current = client;
    return () => client.close();
  }, [connect, movement]);

  useEffect(() => onRepsRef.current?.(reps, movement), [reps, movement]);

  const onFrame = useCallback(
    (frame: PoseFrame) => {
      const m = movementAngle(frame.pose, movement);
      if (m) {
        clientRef.current?.sendSample(frame.timestampMs, m.angle, m.confidence);
        traceRef.current.add(frame.timestampMs, m.angle, m.confidence);
      }
    },
    [movement],
  );

  const reset = () => {
    clientRef.current?.reset();
    traceRef.current.clear();
    setReps([]);
    setPartials(0);
  };

  const last = reps.at(-1);
  return (
    <section>
      <div className="row">
        <label style={{ flex: 1 }}>
          Movement
          <select value={movement} onChange={(e) => setMovement(e.target.value as Movement)}>
            {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <span className={`badge ${status === "open" ? "ok" : "low"}`}>Pi: {status}</span>
      </div>
      <Camera onFrame={onFrame} />
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="big" data-testid="rep-count">{reps.length}</div>
          <div className="muted small">reps · {partials} partial · phase {phase}</div>
        </div>
        <div className="muted small" style={{ textAlign: "right" }}>
          {last ? <>Last rep TUT <strong>{sec(last.tut_ms)}</strong></> : "Do a full rep"}
          <br />
          <button onClick={reset}>Reset set</button>
        </div>
      </div>
      {reps.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>Up</th><th>Hold</th><th>Down</th><th>Est. TUT</th></tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.index}>
                <td>{r.index}</td><td>{sec(r.concentric_ms)}</td><td>{sec(r.peak_pause_ms)}</td>
                <td>{sec(r.eccentric_ms)}</td><td>{sec(r.tut_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="card">
        <summary>Evidence: export this set's angle trace</summary>
        <p className="muted small">
          Count the reps yourself (or from a video), then export. Traces contain joint angles
          only. Run <code>python -m jimbro.evaluate traces/</code> to measure accuracy.
        </p>
        <div className="grid2">
          <label>True reps<input type="number" min={0} value={trueReps} onChange={(e) => setTrueReps(e.target.value)} /></label>
          <label>Camera side<input value={side} onChange={(e) => setSide(e.target.value)} /></label>
          <label>Lighting<input value={light} onChange={(e) => setLight(e.target.value)} /></label>
        </div>
        <button
          disabled={trueReps === ""}
          onClick={() => download(traceFilename(movement, Number(trueReps), { side, light }), traceRef.current.csv())}
        >
          Export trace ({traceRef.current.size} samples)
        </button>
      </details>
    </section>
  );
}
