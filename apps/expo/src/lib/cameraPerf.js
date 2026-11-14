// Camera speed as measured by the pose page on the device it runs on (lib/poseHtml.js posts a
// 'perf' message every 2 s). Nothing here is a claim about other devices.
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

export class PerfTracker {
  constructor({ targetFps = 20 } = {}) {
    this.targetFps = targetFps;
    this.windows = [];
  }

  add(m) {
    this.windows.push({ fps: m.fps, inferenceMs: m.inferenceMs, p95Ms: m.p95Ms ?? null, droppedPct: m.droppedPct ?? null });
    if (this.windows.length > 300) this.windows.shift(); // ~10 minutes
  }

  get latest() {
    return this.windows.at(-1) ?? null;
  }

  summary() {
    const w = this.windows;
    if (!w.length) return null;
    const mean = (k) => round(w.reduce((a, x) => a + (x[k] ?? 0), 0) / w.length, 1);
    return {
      windows: w.length, meanFps: mean('fps'), meanInferenceMs: mean('inferenceMs'),
      worstP95Ms: Math.max(...w.map((x) => x.p95Ms ?? 0)), meanDroppedPct: mean('droppedPct'),
      targetFps: this.targetFps, measuredOn: 'this device',
    };
  }
}

/** "19 fps · 21 ms", or null before the first measurement. */
export const perfLabel = (m) => (m ? `${Math.round(m.fps)} fps · ${Math.round(m.inferenceMs)} ms` : null);
