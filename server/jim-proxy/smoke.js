// Live smoke test against the real Claude API, through the proxy's own handleChat.
// Run:  cd server/jim-proxy && npm ci && ANTHROPIC_API_KEY=... npm run smoke
// (or after `ant auth login`, without the env var). Costs a few cents. Prints no key or bodies.
// Exit code 0 only when all checks pass. `--one`: single call; `--checks=read,write`: only those checks.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import Anthropic from '@anthropic-ai/sdk';

import { buildContext } from '../../apps/expo/src/lib/jimAI.js';
import { analyzeRecording } from '../../apps/expo/src/lib/visionEngine.js';
import { handleChat, MODEL } from './jim.js';
import { handlePhysique } from './physique.js';

const context = {
  unit: 'lb',
  recentSets: [
    { id: 's1', exercise: 'squat', reps: 5, weight: 225, unit: 'lb', rpe: 8, date: '2026-11-10' },
    { id: 's2', exercise: 'squat', reps: 5, weight: 235, unit: 'lb', rpe: 8.5, date: '2026-11-13' },
  ],
  prs: [{ exercise: 'squat', unit: 'lb', heaviest: { reps: 5, weight: 235 } }],
  goals: [],
  weeklyCheckIn: { wins: ['2 workouts'], misses: [], suggestion: 'Keep going.' },
  lastSetReport: null,
  workout: { today: 'Today is Plan day 2: deadlift 3 sets of 5.', setsLeft: "There's no planned workout running." },
};

const base = new Anthropic({ timeout: 60_000, maxRetries: 1 });
const log = [];
// Records model / stop reason / tokens per call without touching request or response bodies.
const client = {
  messages: { create: async (req) => record(await base.messages.create(req)) },
  beta: { messages: { create: async (req) => record(await base.beta.messages.create(req)) } },
};
function record(res) {
  log.push({ model: res.model, stop: res.stop_reason, out: res.usage?.output_tokens });
  return res;
}

// Real vision measurements: the real squat clip (landmarks only) through the app's vision engine,
// logged as a camera set, then Claude is asked about it with the normal context snapshot.
const fx = JSON.parse(readFileSync(new URL('../../tools/vision-lab/fixtures/fs_squat_rear.landmarks.json', import.meta.url), 'utf8'));
const rec = analyzeRecording(fx.frames.map((f) => ({ t: f.t, pose: f.pose && f.pose.map(([x, y, visibility]) => ({ x, y, visibility })) })), { exerciseId: 'squat' });
const visionContext = buildContext({
  history: [{ id: 'w1', name: 'Smoke', startedAt: new Date().toISOString(), sets: [{ id: 'v1', exercise: 'squat', reps: rec.count, target: 2, weight: 135, unit: 'lb', rir: 3, rpe: 7, source: 'camera', reps_detail: rec.reps }] }],
  settings: { unit: 'lb' },
});

// A synthetic test image (no person: a grey gradient with a dark disc), so no consent question arises.
// The route should run end to end and decline it as not a physique photo.
function syntheticPng(size = 96) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const disc = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 4) ** 2;
      const v = disc ? 40 : 120 + Math.round((100 * x) / size);
      raw.fill(v, y * (size * 3 + 1) + 1 + x * 3, y * (size * 3 + 1) + 4 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const checks = [
  { id: 'plain', name: 'plain reply', ask: 'Hi Jim. In one sentence, what should I train today?', ok: (r) => r.reply.length > 5 && !r.refused },
  { id: 'read', name: 'read tool (squat history)', ask: 'How is my squat going?', ok: (r) => /2[23]5/.test(r.reply) && log.length >= 2 },
  { id: 'write', name: 'write tool -> proposal', ask: 'Log 3 sets of 10 shoulder presses at 25 pounds.', ok: (r) => r.proposals.length === 1 && r.proposals[0].type === 'log' && r.proposals[0].sets.length === 3 },
  {
    id: 'vision', name: 'real vision measurements -> coaching', context: visionContext,
    ask: 'How did my last squat set go, and should I change the weight next time?',
    // Must use the measured set (2 reps, 135 lb) and never claim bar speed in m/s from relative data.
    ok: (r) => /\b2\b|two/i.test(r.reply) && /135/.test(r.reply) && !/m\/s|met(er|re)s? per second/i.test(r.reply),
  },
  {
    id: 'physique', name: 'photo route with a synthetic non-person image', run: () => handlePhysique({ consent: true, image: { media_type: 'image/png', data: syntheticPng() }, fitnessGoal: 'muscle', physiqueGoal: '', focusMuscles: [] }, client),
    ok: (r) => r.ok === false && ['not_physique', 'no_proposal', 'declined'].includes(r.reason),
    show: (r) => `ok=${r.ok} reason=${r.reason ?? '-'}`,
  },
];

// --one: just the plain reply. --checks=read,write: only the named checks (plain, read, write).
const pick = process.argv.find((a) => a.startsWith('--checks='))?.slice(9).split(',');
const run = pick ? checks.filter((c) => pick.includes(c.id)) : process.argv.includes('--one') ? checks.slice(0, 1) : checks;
let failed = 0;
console.log(`model ${MODEL}, fallbacks ${process.env.JIM_FALLBACKS === '0' ? 'off' : 'on'}`);
for (const c of run) {
  log.length = 0;
  const t0 = Date.now();
  try {
    const r = c.run ? await c.run() : await handleChat({ messages: [{ role: 'user', content: c.ask }], context: c.context ?? context, persona: 'coach' }, client);
    const pass = c.ok(r);
    failed += pass ? 0 : 1;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}  ${Date.now() - t0} ms  calls=${log.length}  ${log.map((l) => `${l.model}/${l.stop}/${l.out}tok`).join(' ')}`);
    console.log(`      ${c.show ? c.show(r) : `reply: ${r.reply.slice(0, 220)}${r.proposals.length ? `  proposals: ${r.proposals.map((p) => p.summary).join(' | ')}` : ''}`}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${c.name}  ${e.status ?? ''} ${e.name}: ${String(e.message).slice(0, 200)}`);
    if (e.status === 400 && /fallback|beta/i.test(String(e.message))) console.log('      hint: run again with JIM_FALLBACKS=0');
    if (e.status === 401 || /authentication method/i.test(String(e.message))) console.log('      hint: no valid API key or `ant auth login` profile found (set ANTHROPIC_API_KEY in this shell)');
  }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
