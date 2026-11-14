import { describe, expect, it, vi } from "vitest";
import { LiveClient, liveUrl } from "./client";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

describe("liveUrl", () => {
  it("maps http(s) origins to ws(s)", () => {
    expect(liveUrl("https://pi.local:8443", "curl")).toBe("wss://pi.local:8443/v1/live/curl");
    expect(liveUrl("http://localhost:5173", "squat")).toBe("ws://localhost:5173/v1/live/squat");
  });
});

describe("LiveClient", () => {
  it("sends samples only while open and parses events", () => {
    FakeSocket.instances = [];
    const onEvent = vi.fn();
    const client = new LiveClient("ws://x/v1/live/curl", onEvent, FakeSocket as never);
    client.sendSample(1, 170, 0.9);
    const ws = FakeSocket.instances[0];
    expect(ws.sent).toHaveLength(0);
    ws.open();
    client.sendSample(2, 160, 0.8);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "sample", t: 2, angle: 160, confidence: 0.8 });
    ws.onmessage?.({ data: JSON.stringify({ type: "rep", index: 1 }) });
    ws.onmessage?.({ data: "not json" });
    expect(onEvent).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("reconnects with backoff after an unexpected close, not after close()", () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const onStatus = vi.fn();
    const client = new LiveClient("ws://x", () => {}, FakeSocket as never, onStatus);
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting");
    vi.advanceTimersByTime(600);
    expect(FakeSocket.instances).toHaveLength(2);
    client.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
