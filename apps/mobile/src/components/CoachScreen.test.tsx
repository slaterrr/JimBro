import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoachScreen } from "./CoachScreen";

const reply = {
  text: "Next curls: 21 kg x 10.",
  tone: "hard",
  source: "fallback",
  suggestion: { exercise: "curl", weight: 21, unit: "kg", reps: 10, rationale: "easy" },
};

function mockFetch(body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("CoachScreen", () => {
  it("sends the message with the chosen tone and shows Jim's reply", async () => {
    const fetchFn = mockFetch(reply);
    const speak = vi.fn();
    render(<CoachScreen onLogSet={vi.fn()} speak={speak} listen={null} />);
    fireEvent.change(screen.getByLabelText(/tone/i), { target: { value: "hard" } });
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "what next?" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /send/i })));
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/v1/coach");
    expect(JSON.parse(init.body)).toEqual({ message: "what next?", tone: "hard" });
    expect(screen.getByText(reply.text)).toBeInTheDocument();
    expect(speak).toHaveBeenCalledWith(reply.text);
    expect(screen.getByText(/offline coach/i)).toBeInTheDocument();
  });

  it("requires confirmation before a voice-detected set is logged", async () => {
    mockFetch(reply);
    const onLogSet = vi.fn().mockResolvedValue(undefined);
    let deliver: (t: string) => void = () => {};
    const listen = (cb: (t: string) => void) => {
      deliver = cb;
      return () => {};
    };
    render(<CoachScreen onLogSet={onLogSet} speak={vi.fn()} listen={listen} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: /hold to talk/i }));
    act(() => deliver("10 curls at 20 pounds rpe 7"));
    expect(onLogSet).not.toHaveBeenCalled();
    expect(screen.getByText(/log 10 × curl at 20 lb/i)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /confirm/i })));
    expect(onLogSet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ exercise: "curl", reps: 10, weight: 20, unit: "lb", rpe: 7, source: "voice" }),
    );
  });

  it("discarding a voice draft logs nothing", () => {
    mockFetch(reply);
    const onLogSet = vi.fn();
    let deliver: (t: string) => void = () => {};
    render(<CoachScreen onLogSet={onLogSet} speak={vi.fn()} listen={(cb) => ((deliver = cb), () => {})} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: /hold to talk/i }));
    act(() => deliver("10 curls at 20 pounds"));
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onLogSet).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("hides push-to-talk when speech recognition is unavailable", () => {
    render(<CoachScreen onLogSet={vi.fn()} speak={vi.fn()} listen={null} />);
    expect(screen.queryByRole("button", { name: /hold to talk/i })).not.toBeInTheDocument();
  });
});
