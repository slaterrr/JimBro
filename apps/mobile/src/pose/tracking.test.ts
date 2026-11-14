import { describe, expect, it } from "vitest";
import { ARM_LANDMARKS, assessTracking, type Landmark } from "./tracking";

const lm = (visibility: number): Landmark => ({ x: 0.5, y: 0.5, z: 0, visibility });
const body = (vis: number): Landmark[] => Array.from({ length: 33 }, () => lm(vis));

describe("assessTracking", () => {
  it("reports lost when no pose is detected", () => {
    expect(assessTracking(null)).toEqual({ status: "lost", confidence: 0 });
    expect(assessTracking([])).toEqual({ status: "lost", confidence: 0 });
  });

  it("reports ok when required landmarks are confidently visible", () => {
    const result = assessTracking(body(0.9));
    expect(result.status).toBe("ok");
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it("reports low when the weakest required landmark is below threshold", () => {
    const pose = body(0.9);
    pose[ARM_LANDMARKS.left.wrist] = lm(0.2);
    pose[ARM_LANDMARKS.right.wrist] = lm(0.2);
    expect(assessTracking(pose).status).toBe("low");
  });

  it("accepts either arm being fully visible", () => {
    const pose = body(0.9);
    pose[ARM_LANDMARKS.left.elbow] = lm(0.1);
    expect(assessTracking(pose).status).toBe("ok");
  });

  it("treats missing visibility and truncated arrays as untrusted", () => {
    const pose = body(0.9).slice(0, 12);
    expect(assessTracking(pose).status).toBe("lost");
    const noVis = body(0.9).map(({ x, y, z }) => ({ x, y, z }));
    expect(assessTracking(noVis).status).toBe("low");
  });

  it("respects a custom threshold", () => {
    expect(assessTracking(body(0.6), 0.7).status).toBe("low");
    expect(assessTracking(body(0.6), 0.5).status).toBe("ok");
  });
});
