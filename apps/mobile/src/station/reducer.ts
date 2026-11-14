/** Pure state for the Pi station display. Events carry a server `seq`. */

export interface StationState {
  seq: number;
  reps: number;
  movement: string | null;
  lastTutMs: number | null;
  lastSet: { exercise: string; reps: number; weight: number; unit: string } | null;
  buttonPresses: number;
}

export const initialStation: StationState = {
  seq: 0, reps: 0, movement: null, lastTutMs: null, lastSet: null, buttonPresses: 0,
};

type Ev = { type: string; seq?: number; [k: string]: unknown };

export function applyStationEvent(state: StationState, event: Ev): StationState {
  if (event.type === "hello") {
    const last = event.last as Ev | null;
    const reset = { ...state, seq: 0 }; // server may have restarted: trust its counter
    return last ? applyStationEvent(reset, last) : reset;
  }
  const seq = Number(event.seq ?? 0);
  if (seq <= state.seq) return state;
  const next = { ...state, seq };
  switch (event.type) {
    case "rep": {
      const index = Number(event.index);
      return {
        ...next,
        reps: index === 1 ? 1 : Math.max(state.reps + 1, index),
        movement: String(event.movement ?? state.movement),
        lastTutMs: Number(event.tut_ms),
      };
    }
    case "set":
      return {
        ...next,
        reps: 0,
        lastSet: {
          exercise: String(event.exercise), reps: Number(event.reps),
          weight: Number(event.weight), unit: String(event.unit),
        },
      };
    case "button":
      return { ...next, buttonPresses: state.buttonPresses + 1 };
    default:
      return next;
  }
}
