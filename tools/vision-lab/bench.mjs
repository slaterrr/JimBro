// CPU benchmark of the counting and coaching logic on THIS machine (not a phone, and not MediaPipe
// inference, which runs in the WebView/iframe). Replays the real fixtures many times.
//   node bench.mjs [repeats]
import { readdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';

import { createCoach } from '../../apps/expo/src/lib/coachEngine.js';
import { createVisionSession } from '../../apps/expo/src/lib/visionEngine.js';

const repeats = Number(process.argv[2] ?? 50);
const dir = new URL('./fixtures/', import.meta.url);
const clips = readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).map((c) => ({
  movement: c.movement, frames: c.frames.map((f) => ({ t: f.t, pose: f.pose && f.pose.map(([x, y, visibility]) => ({ x, y, visibility })) })),
}));
const times = [];
let frames = 0;
for (let r = 0; r < repeats; r += 1) {
  for (const c of clips) {
    const coach = createCoach({ sessionId: 'b', frequency: 'normal' });
    const v = createVisionSession({ exerciseId: c.movement, sessionId: 'b', onEvent: (e) => coach.handle(e) });
    for (const f of c.frames) {
      const t0 = process.hrtime.bigint();
      v.frame(f.t, f.pose);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      frames += 1;
    }
    v.finishSet({ target: null });
    coach.completeSet({ weight: 100, unit: 'lb', rir: 2 });
  }
}
times.sort((a, b) => a - b);
const q = (p) => (1000 * times[Math.min(times.length - 1, Math.floor(p * times.length))]).toFixed(1);
console.log(`machine: ${cpus()[0]?.model ?? 'unknown'} | node ${process.version}`);
console.log(`${frames} frames (${clips.length} real clips x ${repeats}): per-frame engine time median ${q(0.5)} µs, p95 ${q(0.95)} µs, p99 ${q(0.99)} µs, max ${(1000 * times.at(-1)).toFixed(0)} µs`);
console.log(`budget at 20 fps: 50 ms per frame; pose inference is separate (see the in-app fps readout)`);
