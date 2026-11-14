// Minimal harness: replay a real-clip landmark fixture (or simulated frames) through the vision
// engine and the coach engine and print the event timeline. No phone, camera or API key needed.
//   node scripts/engine-harness.mjs                     # list fixtures
//   node scripts/engine-harness.mjs fs_squat_rear       # real-clip landmarks (tools/vision-lab/fixtures)
//   node scripts/engine-harness.mjs sim:curl            # simulated set (logic only)
//   node scripts/engine-harness.mjs fs_squat_rear --json  # every event as JSON lines
import { readdirSync, readFileSync } from 'node:fs';

import { simulateSet } from '../../../tools/vision-lab/lib/simulate.mjs';
import { createCoach } from '../src/lib/coachEngine.js';
import { validateEvent } from '../src/lib/events.js';
import { analyzeRecording } from '../src/lib/visionEngine.js';

const dir = new URL('../../../tools/vision-lab/fixtures/', import.meta.url);
const [arg, flag] = process.argv.slice(2);
if (!arg) {
  console.log('fixtures:', readdirSync(dir).map((f) => f.replace('.landmarks.json', '')).join(', '), '| or sim:<curl|squat|shoulder_press>');
  process.exit(0);
}

let frames;
let exerciseId;
let truth;
if (arg.startsWith('sim:')) {
  exerciseId = arg.slice(4);
  const s = simulateSet(exerciseId, { reps: 8, slowdown: 0.8 });
  frames = s.frames;
  truth = `${s.trueEnds.length} reps (SIMULATED)`;
} else {
  const fx = JSON.parse(readFileSync(new URL(`${arg}.landmarks.json`, dir), 'utf8'));
  exerciseId = fx.movement;
  frames = fx.frames.map((f) => ({ t: f.t, pose: f.pose ? f.pose.map(([x, y, visibility]) => ({ x, y, visibility })) : null }));
  truth = `${fx.reps.length} labeled reps (REAL clip, ${fx.split}${fx.adversarial ? ', adversarial' : ''})`;
}

const rec = analyzeRecording(frames, { exerciseId, target: null, sessionId: 'harness' });
const out = [];
const coach = createCoach({ sessionId: 'harness', frequency: 'normal', onEvent: (e) => out.push(e) });
for (const e of rec.events) coach.handle(e);
coach.completeSet({ weight: 0, unit: 'lb', rir: 2 });
const all = [...rec.events, ...out];
const bad = all.map(validateEvent).filter((v) => !v.ok);

if (flag === '--json') {
  for (const e of all) console.log(JSON.stringify(e));
} else {
  console.log(`${arg}: ${exerciseId}, ${frames.length} frames; truth ${truth}; engine counted ${rec.count}`);
  const counts = {};
  for (const e of all) counts[e.type] = (counts[e.type] ?? 0) + 1;
  console.log('events:', Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' '));
  for (const e of all.filter((x) => ['ExerciseMismatch', 'RepRejected', 'FatigueAssessment', 'LoadRecommendation'].includes(x.type) || (x.type === 'CoachResponse' && x.data.kind !== 'count'))) {
    console.log(`  ${String(e.timestamp).padStart(6)} ${e.type.padEnd(19)} ${e.data.text ?? e.data.guidance ?? e.data.words ?? e.data.action ?? ''}`);
  }
  console.log(bad.length ? `INVALID events: ${bad.length}` : 'all events valid');
}
process.exit(bad.length ? 1 : 0);
