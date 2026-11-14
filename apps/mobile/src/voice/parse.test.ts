import { describe, expect, it } from "vitest";
import { parseSetUtterance } from "./parse";

describe("parseSetUtterance", () => {
  it.each([
    ["10 reps of curls at 20 pounds", { exercise: "curl", reps: 10, weight: 20, unit: "lb" }],
    ["squat 5 reps 100 kilos rpe 8", { exercise: "squat", reps: 5, weight: 100, unit: "kg", rpe: 8 }],
    ["bench press 8 at 60 kg", { exercise: "bench", reps: 8, weight: 60, unit: "kg" }],
    ["ten curls at twenty pounds", { exercise: "curl", reps: 10, weight: 20, unit: "lb" }],
    ["did 12 pull ups", { exercise: "pull_up", reps: 12, weight: 0 }],
    ["deadlift 3 reps 140.5 kg RPE 9.5", { exercise: "deadlift", reps: 3, weight: 140.5, unit: "kg", rpe: 9.5 }],
    ["overhead press 6 reps 30 lbs", { exercise: "shoulder_press", reps: 6, weight: 30, unit: "lb" }],
  ])("parses %s", (text, expected) => {
    expect(parseSetUtterance(text)).toMatchObject(expected);
  });

  it("returns null when no exercise or reps can be found", () => {
    expect(parseSetUtterance("hello jim how are you")).toBeNull();
    expect(parseSetUtterance("curls")).toBeNull();
  });

  it("does not guess a unit that was not spoken", () => {
    expect(parseSetUtterance("curls 10 reps 20")?.unit).toBeUndefined();
  });

  it("ignores an out-of-range RPE", () => {
    expect(parseSetUtterance("curls 10 reps 20 kg rpe 14")?.rpe).toBeUndefined();
  });
});
