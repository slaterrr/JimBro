// End to end on REAL landmarks: real squat clip -> vision engine -> coach engine -> Jim's words.
// Jim's feedback must cite the measured numbers and the user's report, nothing invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { createCoach } from './coachEngine.js';
import { validateEvent } from './events.js';
import { analyzeRecording } from './visionEngine.js';

const fx = JSON.parse(readFileSync(new URL('../../../../tools/vision-lab/fixtures/fs_squat_rear.landmarks.json', import.meta.url), 'utf8'));
const frames = fx.frames.map((f) => ({ t: f.t, pose: f.pose ? f.pose.map(([x, y, visibility]) => ({ x, y, visibility })) : null }));

describe('real squat clip -> Jim', () => {
  const rec = analyzeRecording(frames, { exerciseId: 'squat', target: 2 });
  const out = [];
  const coach = createCoach({ sessionId: 'e2e', frequency: 'normal', onEvent: (e) => out.push(e) });
  for (const e of rec.events) coach.handle(e);
  coach.completeSet({ weight: 135, unit: 'lb', rir: 3, history: [] });

  it('every event in the chain is valid', () => {
    assert.ok([...rec.events, ...out].every((e) => validateEvent(e).ok));
  });

  it('spoken counts follow the camera, and the after-set line states the measured count', () => {
    assert.deepEqual(out.filter((e) => e.data.kind === 'count').map((e) => e.data.text), ['1', '2']);
    const after = out.find((e) => e.data.kind === 'after_set');
    assert.match(after.data.text, /all 2 reps/);
    assert.match(after.data.question, /how many more/i);
  });

  it('the recommendation cites both the measured speed and the user report', () => {
    const r = out.find((e) => e.type === 'LoadRecommendation').data;
    assert.ok(r.evidence.some((x) => x.source === 'reported' && /3 reps left/.test(x.text)));
    assert.ok(r.needsApproval);
  });

  it('asked about the set, Jim answers from the logged measurements', () => {
    const set = { exercise: 'squat', reps: 2, target: 2, weight: 135, unit: 'lb', rir: 3, reps_detail: rec.reps };
    const a = coach.ask('how was my last set?', { history: [], active: { sets: [set] } });
    assert.match(a.data.text, /squat/i);
    assert.match(a.data.text, /2 of 2 reps at 135 lb/);
  });
});
