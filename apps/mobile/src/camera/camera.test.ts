import { describe, expect, it, vi } from "vitest";
import { cameraErrorMessage, classifyCameraError, startCamera, stopStream } from "./camera";

const domErr = (name: string) => Object.assign(new Error(name), { name });

describe("classifyCameraError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "not-found"],
    ["OverconstrainedError", "not-found"],
    ["NotReadableError", "in-use"],
    ["AbortError", "unknown"],
  ])("maps %s to %s", (name, kind) => {
    expect(classifyCameraError(domErr(name))).toBe(kind);
  });

  it("handles non-error throwables", () => {
    expect(classifyCameraError("boom")).toBe("unknown");
  });

  it("has a human message for every kind", () => {
    for (const kind of ["denied", "not-found", "in-use", "insecure", "unknown"] as const) {
      expect(cameraErrorMessage(kind).length).toBeGreaterThan(10);
    }
  });
});

describe("startCamera", () => {
  it("fails as insecure when mediaDevices is unavailable", async () => {
    await expect(startCamera(undefined, "user")).rejects.toMatchObject({ kind: "insecure" });
  });

  it("requests video only with the chosen facing mode", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const result = await startCamera({ getUserMedia } as unknown as MediaDevices, "environment");
    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  });

  it("wraps permission failures with a kind", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domErr("NotAllowedError"));
    await expect(
      startCamera({ getUserMedia } as unknown as MediaDevices, "user"),
    ).rejects.toMatchObject({ kind: "denied" });
  });
});

describe("stopStream", () => {
  it("stops every track and tolerates null", () => {
    const stop = vi.fn();
    stopStream({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(() => stopStream(null)).not.toThrow();
  });
});
