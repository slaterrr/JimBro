// Live smoke test against the real Claude API, through the proxy's own handleChat.
// Run:  cd server/jim-proxy && npm ci && ANTHROPIC_API_KEY=... npm run smoke
// (or after `ant auth login`, without the env var). Costs a few cents. Prints no key or bodies.
// Exit code 0 only when all three checks pass.
import Anthropic from '@anthropic-ai/sdk';

import { handleChat, MODEL } from './jim.js';

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

const checks = [
  { name: 'plain reply', ask: 'Hi Jim. In one sentence, what should I train today?', ok: (r) => r.reply.length > 5 && !r.refused },
  { name: 'read tool (squat history)', ask: 'How is my squat going?', ok: (r) => /2[23]5/.test(r.reply) && log.length >= 2 },
  { name: 'write tool -> proposal', ask: 'Log 3 sets of 10 curls at 25 pounds.', ok: (r) => r.proposals.length === 1 && r.proposals[0].type === 'log' && r.proposals[0].sets.length === 3 },
];

let failed = 0;
console.log(`model ${MODEL}, fallbacks ${process.env.JIM_FALLBACKS === '0' ? 'off' : 'on'}`);
for (const c of checks) {
  log.length = 0;
  const t0 = Date.now();
  try {
    const r = await handleChat({ messages: [{ role: 'user', content: c.ask }], context, persona: 'coach' }, client);
    const pass = c.ok(r);
    failed += pass ? 0 : 1;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}  ${Date.now() - t0} ms  calls=${log.length}  ${log.map((l) => `${l.model}/${l.stop}/${l.out}tok`).join(' ')}`);
    console.log(`      reply: ${r.reply.slice(0, 160)}${r.proposals.length ? `  proposals: ${r.proposals.map((p) => p.summary).join(' | ')}` : ''}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${c.name}  ${e.status ?? ''} ${e.name}: ${String(e.message).slice(0, 200)}`);
    if (e.status === 400 && /fallback|beta/i.test(String(e.message))) console.log('      hint: run again with JIM_FALLBACKS=0');
    if (e.status === 401) console.log('      hint: no valid API key or `ant auth login` profile found');
  }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
