import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanBuilder } from "./PlanBuilder";

afterEach(() => vi.unstubAllGlobals());

describe("PlanBuilder", () => {
  it("requests a plan with the chosen constraints and renders its days", async () => {
    const plan = {
      goal: "strength",
      notes: ["n"],
      days: [{ day: 1, estimated_minutes: 40, items: [{ exercise: "squat", sets: 4, reps_low: 3, reps_high: 5, rest_min: 3 }] }],
    };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => plan });
    vi.stubGlobal("fetch", fetchFn);
    render(<PlanBuilder />);
    fireEvent.change(screen.getByLabelText(/goal/i), { target: { value: "strength" } });
    fireEvent.change(screen.getByLabelText(/days per week/i), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText(/pull-up bar/i));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /build plan/i })));
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({ goal: "strength", days_per_week: 1, minutes_per_session: 45 });
    expect(body.equipment).toContain("pullup_bar");
    expect(screen.getByText(/day 1/i)).toBeInTheDocument();
    expect(screen.getByText(/squat/i)).toBeInTheDocument();
  });

  it("disables build with no equipment", () => {
    render(<PlanBuilder />);
    fireEvent.click(screen.getByLabelText(/dumbbells/i));
    fireEvent.click(screen.getByLabelText(/barbell/i));
    expect(screen.getByRole("button", { name: /build plan/i })).toBeDisabled();
  });
});
