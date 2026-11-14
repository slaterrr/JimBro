/** Reconnecting websocket client for /v1/live/{movement}. Sends angles, never video. */

export type LiveStatus = "connecting" | "open" | "reconnecting" | "closed";
export type LiveEvent =
  | { type: "state"; state: string; count: number; partials: number }
  | {
      type: "rep"; index: number; start_ms: number; end_ms: number;
      concentric_ms: number; peak_pause_ms: number; eccentric_ms: number; tut_ms: number;
    }
  | { type: "error"; detail: string }
  | { type: "pong" };

type SocketCtor = new (url: string) => WebSocket;

export function liveUrl(origin: string, movement: string): string {
  return `${origin.replace(/^http/, "ws")}/v1/live/${movement}`;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly onEvent: (e: LiveEvent) => void,
    private readonly Socket: SocketCtor = WebSocket,
    private readonly onStatus: (s: LiveStatus) => void = () => {},
  ) {
    this.connect();
  }

  private connect() {
    this.onStatus(this.attempt ? "reconnecting" : "connecting");
    const ws = new this.Socket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus("open");
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        this.onEvent(JSON.parse(String(e.data)) as LiveEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.attempt += 1;
      this.onStatus("reconnecting");
      this.timer = setTimeout(() => this.connect(), Math.min(500 * 2 ** (this.attempt - 1), 5000));
    };
  }

  private send(payload: object) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  sendSample(t: number, angle: number, confidence: number) {
    this.send({ type: "sample", t: Math.round(t), angle, confidence });
  }

  reset() {
    this.send({ type: "reset" });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.onStatus("closed");
  }
}
