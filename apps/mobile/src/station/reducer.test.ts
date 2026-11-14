import { describe, expect, it } from "vitest";
import { applyStationEvent, initialStation } from "./reducer";

const rep = (seq: number, index: number, tut = 2000) => ({
  type: "rep", seq, index, tut_ms: tut, movement: "curl", athlete_id: "me",
});

describe("applyStationEvent", () => {
  it("tracks the live rep count and last TUT", () => {
    let s = applyStationEvent(initialStation, rep(1, 1, 1800));
    s = applyStationEvent(s, rep(2, 2, 2200));
    expect(s.reps).toBe(2);
    expect(s.lastTutMs).toBe(2200);
    expect(s.movement).toBe("curl");
  });

  it("ignores duplicate and out-of-order events by seq", () => {
    let s = applyStationEvent(initialStation, rep(5, 1));
    s = applyStationEvent(s, rep(5, 1));
    s = applyStationEvent(s, rep(3, 9));
    expect(s.reps).toBe(1);
    expect(s.seq).toBe(5);
  });

  it("a new set starts after a saved set is announced", () => {
    let s = applyStationEvent(initialStation, rep(1, 1));
    s = applyStationEvent(s, { type: "set", seq: 2, exercise: "curl", reps: 1, weight: 10, unit: "kg" });
    expect(s.lastSet).toEqual({ exercise: "curl", reps: 1, weight: 10, unit: "kg" });
    expect(s.reps).toBe(0);
    s = applyStationEvent(s, rep(3, 1));
    expect(s.reps).toBe(1);
  });

  it("rep index restarting (client reset) resets the count", () => {
    let s = applyStationEvent(initialStation, rep(1, 1));
    s = applyStationEvent(s, rep(2, 2));
    s = applyStationEvent(s, rep(3, 1));
    expect(s.reps).toBe(1);
  });

  it("hello restores the last event and resets seq after a server restart", () => {
    let s = applyStationEvent(initialStation, rep(40, 3));
    s = applyStationEvent(s, { type: "hello", last: rep(2, 1) });
    expect(s.seq).toBe(2);
    expect(s.reps).toBe(1);
    s = applyStationEvent(s, { type: "hello", last: null });
    expect(s.seq).toBe(0);
  });

  it("button press is surfaced and unknown events are ignored", () => {
    let s = applyStationEvent(initialStation, { type: "button", seq: 1 });
    expect(s.buttonPresses).toBe(1);
    s = applyStationEvent(s, { type: "weird", seq: 2 });
    expect(s.seq).toBe(2);
  });
});
