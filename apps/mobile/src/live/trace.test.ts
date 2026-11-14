import { describe, expect, it } from "vitest";
import { TraceRecorder, traceFilename } from "./trace";

describe("TraceRecorder", () => {
  it("records samples as CSV matching the evaluator format", () => {
    const r = new TraceRecorder();
    r.add(1000.4, 170.123, 0.9);
    r.add(1033, 160, 0.85);
    expect(r.size).toBe(2);
    expect(r.csv()).toBe("t_ms,angle,confidence\n1000,170.12,0.9\n1033,160,0.85\n");
    r.clear();
    expect(r.size).toBe(0);
  });

  it("caps memory use by dropping the oldest samples", () => {
    const r = new TraceRecorder(3);
    for (let i = 0; i < 5; i++) r.add(i, i, 1);
    expect(r.csv().split("\n")[1]).toBe("2,2,1");
  });

  it("builds evaluator-compatible filenames with sanitised tags", () => {
    expect(traceFilename("curl", 10, { side: "Left", light: "dim room" })).toBe(
      "curl_true10_side-left_light-dimroom.csv",
    );
    expect(traceFilename("squat", 0, {})).toBe("squat_true0.csv");
  });
});
