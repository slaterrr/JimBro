import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetForm } from "./SetForm";

describe("SetForm", () => {
  it("logs a manual set for any of the six lifts with explicit units and RPE", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SetForm sessionId="s1" onSubmit={onSubmit} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Bicep curl", "Squat", "Bench press", "Deadlift", "Shoulder press", "Pull-up",
    ]);
    fireEvent.change(screen.getByLabelText(/exercise/i), { target: { value: "bench" } });
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/unit/i), { target: { value: "lb" } });
    fireEvent.change(screen.getByLabelText(/^reps/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/rpe/i), { target: { value: "7.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save set/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [id, body] = onSubmit.mock.calls[0];
    expect(typeof id).toBe("string");
    expect(body).toEqual({
      session_id: "s1", exercise: "bench", weight: 60, unit: "lb", reps: 8, rpe: 7.5,
      source: "manual", reps_detail: [], confidence: null, model_version: null,
    });
  });

  it("prefills camera-counted reps and sends per-rep timing", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const detail = [{ index: 1, concentric_ms: 800, peak_pause_ms: 100, eccentric_ms: 1200 }];
    render(<SetForm sessionId="s1" onSubmit={onSubmit} exercise="squat" camera={{ reps: detail, confidence: 0.8 }} />);
    expect(screen.getByLabelText(/^reps/i)).toHaveValue(1);
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /save set/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][1]).toMatchObject({
      exercise: "squat", source: "camera", reps: 1, reps_detail: detail, confidence: 0.8,
    });
  });

  it("drops camera timing if the user edits the rep count", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const detail = [{ index: 1, concentric_ms: 800, peak_pause_ms: 100, eccentric_ms: 1200 }];
    render(<SetForm sessionId="s1" onSubmit={onSubmit} camera={{ reps: detail, confidence: 0.8 }} />);
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^reps/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save set/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][1]).toMatchObject({ reps: 2, reps_detail: [], source: "manual" });
  });

  it("blocks invalid input", () => {
    render(<SetForm sessionId="s1" onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /save set/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: "-3" } });
    fireEvent.change(screen.getByLabelText(/^reps/i), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /save set/i })).toBeDisabled();
  });
});
