import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "../live/client";
import { LiveWorkout } from "./LiveWorkout";

function setup() {
  let emit: (e: LiveEvent) => void = () => {};
  const client = { sendSample: vi.fn(), reset: vi.fn(), close: vi.fn() };
  const connect = vi.fn((_m: string, onEvent: (e: LiveEvent) => void) => {
    emit = onEvent;
    return client;
  });
  const onRepsChange = vi.fn();
  render(<LiveWorkout connect={connect} camera={() => <div>camera</div>} onRepsChange={onRepsChange} />);
  return { emit: (e: LiveEvent) => act(() => emit(e)), client, connect, onRepsChange };
}

const rep = (index: number, tut: number): LiveEvent => ({
  type: "rep", index, start_ms: 0, end_ms: tut, concentric_ms: tut / 2,
  peak_pause_ms: 0, eccentric_ms: tut / 2, tut_ms: tut,
});

describe("LiveWorkout", () => {
  it("shows counts and per-rep timing from server events", () => {
    const { emit, onRepsChange } = setup();
    emit(rep(1, 2000));
    emit({ type: "state", state: "rest", count: 1, partials: 1 });
    expect(screen.getByTestId("rep-count")).toHaveTextContent("1");
    expect(screen.getByText(/1 partial/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("2.0s");
    expect(onRepsChange).toHaveBeenLastCalledWith([expect.objectContaining({ index: 1 })]);
  });

  it("reconnects for a new movement and resets the set", () => {
    const { emit, client, connect } = setup();
    emit(rep(1, 1500));
    fireEvent.change(screen.getByLabelText(/movement/i), { target: { value: "squat" } });
    expect(client.close).toHaveBeenCalled();
    expect(connect).toHaveBeenLastCalledWith("squat", expect.any(Function), expect.any(Function));
    expect(screen.getByTestId("rep-count")).toHaveTextContent("0");
  });

  it("reset button clears local reps and asks the server to reset", () => {
    const { emit, client } = setup();
    emit(rep(1, 1500));
    fireEvent.click(screen.getByRole("button", { name: /reset set/i }));
    expect(client.reset).toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
