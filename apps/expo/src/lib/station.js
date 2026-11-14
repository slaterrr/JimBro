// Live rep feed from the Pi (/v1/station). Events carry a server `seq`; anything not
// newer than what we applied is a duplicate or arrived out of order.
export const initialStation = { seq: 0, reps: [], movement: null, lastSet: null };

export function applyStationEvent(state, event) {
  if (event.type === 'hello') {
    const reset = { ...state, seq: 0 }; // the Pi may have restarted: trust its counter
    return event.last ? applyStationEvent(reset, event.last) : reset;
  }
  const seq = Number(event.seq ?? 0);
  if (seq <= state.seq) return state;
  const next = { ...state, seq };
  if (event.type === 'rep') {
    const rep = {
      index: event.index,
      concentric_ms: event.concentric_ms,
      peak_pause_ms: event.peak_pause_ms,
      eccentric_ms: event.eccentric_ms,
    };
    const reps = event.index === 1 ? [rep] : [...state.reps, rep];
    return { ...next, reps, movement: event.movement ?? state.movement };
  }
  if (event.type === 'set') return { ...next, reps: [], lastSet: event };
  return next;
}

/** Live reps as `reps_detail` for a set, renumbered from 1. */
export const repsSinceLastSet = (state) => state.reps.map((r, i) => ({ ...r, index: i + 1 }));
