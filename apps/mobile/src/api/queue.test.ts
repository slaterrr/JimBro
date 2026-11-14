import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SetQueue, type SetPayload } from "./client";

const payload = (reps = 3): SetPayload => ({
  session_id: "s1", exercise: "curl", weight: 10, unit: "kg", reps, rpe: null,
  source: "manual", reps_detail: [],
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  };
}

describe("SetQueue", () => {
  let storage: Storage;
  beforeEach(() => { storage = memoryStorage(); });

  it("sends immediately when the Pi is reachable", async () => {
    const send = vi.fn().mockResolvedValue({ id: "a" });
    const q = new SetQueue(send, storage);
    await q.submit("a", payload());
    expect(send).toHaveBeenCalledWith("a", payload());
    expect(q.pending()).toEqual([]);
  });

  it("keeps the set with the same id when offline and flushes later", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({});
    const q = new SetQueue(send, storage);
    await q.submit("a", payload());
    expect(q.pending().map((p) => p.id)).toEqual(["a"]);
    // survives a reload
    const reloaded = new SetQueue(send, storage);
    expect(reloaded.pending()).toHaveLength(1);
    expect(await reloaded.flush()).toBe(1);
    expect(send).toHaveBeenLastCalledWith("a", payload());
    expect(reloaded.pending()).toEqual([]);
  });

  it("drops permanently rejected sets but reports them", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(422, "bad"));
    const onRejected = vi.fn();
    const q = new SetQueue(send, storage, onRejected);
    await q.submit("a", payload());
    expect(q.pending()).toEqual([]);
    expect(onRejected).toHaveBeenCalledWith("a", expect.any(ApiError));
  });

  it("retries server errors (5xx) instead of dropping", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(503, "busy"));
    const q = new SetQueue(send, storage);
    await q.submit("a", payload());
    expect(q.pending()).toHaveLength(1);
  });

  it("does not duplicate an id already queued", async () => {
    const send = vi.fn().mockRejectedValue(new TypeError("offline"));
    const q = new SetQueue(send, storage);
    await q.submit("a", payload());
    await q.submit("a", payload());
    expect(q.pending()).toHaveLength(1);
  });

  it("tolerates corrupt storage", () => {
    storage.setItem("jimbro.pendingSets", "{nope");
    expect(new SetQueue(vi.fn(), storage).pending()).toEqual([]);
  });
});
