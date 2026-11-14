// LiveSession keeps per-rep landmark clips (never video) for form review, with a memory cap.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { body } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { LiveSession } from './live.js';

const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
const CLEAN = (p) => ({ upperArm: 5, elbow: 170 - 125 * p });
const SWING = (p) => ({ upperArm: 5 + 35 * p, elbow: 170 - 125 * p });

/** Curl set at 20 fps: each entry {args, downMs} is one rep, with rest in between. */
function curlSet(reps) {
  const frames = [];
  let t = 0;
  const push = (args, p) => { frames.push({ t, pose: body(args(p)) }); t += 50; };
  for (let i = 0; i < 20; i++) push(CLEAN, 0);
  for (const { args = CLEAN, upMs = 1000, downMs = 1000 } of reps) {
    for (let u = 0; u < upMs; u += 50) push(args, ease(u / upMs));
    for (let i = 0; i < 4; i++) push(args, 1);
    for (let u = 0; u < downMs; u += 50) push(args, 1 - ease(u / downMs));
    for (let i = 0; i < 14; i++) push(CLEAN, 0);
  }
  return frames;
}

const run = (reps) => {
  const s = new LiveSession('curl');
  for (const f of curlSet(reps)) s.frame(f.t, f.pose);
  return s;
};

describe('LiveSession clips', () => {
  it('keeps flagged reps plus the best clean rep, each analysed', () => {
    const s = run([{}, {}, { args: SWING }, {}, { downMs: 300 }]);
    assert.equal(s.count, 5);
    const clips = s.clips;
    const flagged = clips.filter((c) => !c.analysis.ok);
    assert.deepEqual(flagged.map((c) => c.index), [3, 5]);
    assert.equal(flagged[0].analysis.faults[0].id, 'upper_arm_swing');
    assert.ok(flagged[1].analysis.faults.some((f) => f.id === 'fast_lowering'));
    const clean = clips.filter((c) => c.analysis.ok);
    assert.equal(clean.length, 1);
    for (const c of clips) {
      assert.ok(c.frames.length > 10 && c.frames.length <= 60, String(c.frames.length));
      assert.equal(c.frames[0].pose.length, 33);
    }
  });

  it('caps memory: at most 60 frames per clip and a bounded number of clips', () => {
    const s = run(Array.from({ length: 16 }, () => ({ args: SWING, upMs: 2500, downMs: 2500 })));
    assert.equal(s.count, 16);
    assert.ok(s.clips.length <= 11, String(s.clips.length));
    assert.ok(s.clips.every((c) => c.frames.length <= 60));
  });

  it('reset clears clips', () => {
    const s = run([{ args: SWING }]);
    assert.equal(s.clips.length, 1);
    s.reset();
    assert.equal(s.clips.length, 0);
  });
});
