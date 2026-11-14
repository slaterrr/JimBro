// Real-video regression suite: MediaPipe landmarks recorded from openly licensed clips (no video
// stored). Every counter change must keep these results. Labels were made before predictions.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { replay, scoreClip } from '../lib/evaluate.mjs';

const dir = new URL('../fixtures/', import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.landmarks.json'))) {
  const clip = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  test(`real clip ${clip.clip} (${clip.movement}${clip.adversarial ? ', adversarial' : ''}): ${clip.reps.length} reps, no false reps`, () => {
    const frames = clip.frames.map(({ t, pose }) => ({ t, pose: pose && pose.map(([x, y, visibility]) => ({ x, y, visibility })) }));
    const out = replay(clip.movement, frames);
    const s = scoreClip({ trueEnds: clip.reps.map((r) => r.end_ms), predEnds: out.predEnds });
    assert.deepEqual({ tp: s.tp, fp: s.fp, fn: s.fn }, { tp: clip.reps.length, fp: 0, fn: 0 });
    if (clip.movement === 'squat') assert.equal(out.frames.filter((x) => x.issue === 'exercise_change').length, 0, 'real squat must not look like a lunge');
  });
}
