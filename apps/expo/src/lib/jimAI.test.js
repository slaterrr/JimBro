// Jim AI client: privacy-minimal context, proposal validation, and offline fallback.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { askJim, buildContext, historyFor, proxyUrl, validateProposal } from './jimAI.js';

const NOW = new Date('2026-11-14T12:00:00Z');
const set = (id, exercise, reps, weight, loggedAt, extra = {}) => ({ id, exercise, reps, weight, unit: 'lb', rpe: null, source: 'manual', loggedAt, pr: false, ...extra });
const state = {
  settings: { unit: 'lb', persona: 'analyst', tone: 'friendly' },
  history: [
    { id: 'w0', name: 'Secret name', startedAt: '2026-10-01T10:00:00Z', sets: [set('old', 'squat', 5, 200, '2026-10-01T10:05:00Z')] },
    { id: 'w1', name: 'Leg day', startedAt: '2026-11-10T10:00:00Z', sets: [set('h1', 'squat', 5, 225, '2026-11-10T10:05:00Z', { pr: true })] },
  ],
  active: {
    id: 'w2', name: 'Arms', startedAt: '2026-11-14T11:00:00Z',
    sets: [set('a1', 'curl', 10, 20, '2026-11-14T11:05:00Z', {
      source: 'camera',
      reps_detail: Array.from({ length: 6 }, () => ({ concentric_ms: 800, peak_pause_ms: 100, eccentric_ms: 900 })),
      camera_quality: { frames: 100, okFrames: 95, issues: {}, partials: 0 },
    })],
  },
  goals: [{ id: 'g1', type: 'reps', exercise: 'curl', target: 12 }],
  plan: null,
};

describe('buildContext', () => {
  const c = buildContext(state, NOW);
  it('keeps only the last 14 days of sets with minimal fields', () => {
    assert.deepEqual(c.recentSets.map((s) => s.id), ['h1', 'a1']);
    assert.deepEqual(Object.keys(c.recentSets[0]).sort(), ['date', 'exercise', 'id', 'pr', 'reps', 'rpe', 'source', 'unit', 'weight']);
    assert.equal(c.recentSets[0].date, '2026-11-10');
  });
  it('carries unit, persona, PRs, goals, check-in and last set report', () => {
    assert.equal(c.unit, 'lb');
    assert.equal(c.persona, 'analyst');
    assert.ok(c.prs.some((r) => r.exercise === 'squat' && r.heaviest.weight === 225));
    assert.equal(c.goals.length, 1);
    assert.equal(typeof c.goals[0].pct, 'number');
    assert.match(c.goals[0].label, /curl/);
    assert.ok(Array.isArray(c.weeklyCheckIn.wins));
    assert.equal(c.lastSetReport.movement, 'curl');
    assert.equal(c.lastSetReport.counted, 6);
    assert.equal(c.lastSetReport.trackingPct, 95);
  });
  it('leaks no workout names or workout/goal ids', () => {
    const json = JSON.stringify(c);
    for (const secret of ['Secret name', 'Leg day', 'Arms', '"w1"', '"w2"', '"g1"', 'reps_detail', 'camera_quality']) assert.ok(!json.includes(secret), secret);
  });
  it('falls back to the legacy tone for persona', () => {
    assert.equal(buildContext({ ...state, settings: { unit: 'kg', tone: 'hard' } }, NOW).persona, 'hard');
  });
  it('includes a compact active-session summary and fresh camera result, without identifiers or raw pose data', () => {
    const current = {
      ...state,
      active: {
        ...state.active,
        cameraSnapshot: {
          sessionId: 'device-only-session-id',
          updatedAt: '2026-11-14T11:59:30.000Z',
          exercise: 'curl',
          reps: 8,
          trackingPct: 96,
          frames: [{ landmarks: [{ x: 0.5, y: 0.2 }] }],
        },
      },
    };
    const context = buildContext(current, NOW);
    assert.deepEqual(context.activeSession, {
      startedAt: '2026-11-14T11:00:00Z',
      setCount: 1,
      exercises: ['curl'],
    });
    assert.deepEqual(context.liveCamera, {
      updatedAt: '2026-11-14T11:59:30.000Z',
      exercise: 'curl',
      reps: 8,
      trackingPct: 96,
    });
    const json = JSON.stringify(context);
    for (const secret of ['device-only-session-id', 'sessionId', 'frames', 'landmarks', '0.5']) assert.ok(!json.includes(secret), secret);
  });
  it('does not claim live camera awareness when there is no active camera result', () => {
    const context = buildContext({ ...state, active: { ...state.active, cameraSnapshot: null } }, NOW);
    assert.equal(context.liveCamera, null);
  });
  it('omits a stale camera result while retaining the active workout summary', () => {
    const context = buildContext({
      ...state,
      active: {
        ...state.active,
        cameraSnapshot: { updatedAt: '2026-11-14T11:54:59.999Z', exercise: 'curl', reps: 8, trackingPct: 96 },
      },
    }, NOW);
    assert.equal(context.liveCamera, null);
    assert.deepEqual(context.activeSession, {
      startedAt: '2026-11-14T11:00:00Z',
      setCount: 1,
      exercises: ['curl'],
    });
  });
});

describe('validateProposal', () => {
  const log = { type: 'log', set: { exercise: 'curl', reps: 10, weight: 20, unit: 'lb' }, sets: [{ exercise: 'curl', reps: 10, weight: 20, unit: 'lb' }], summary: 'Log 10 × bicep curl at 20 lb?' };
  it('accepts well-formed intents', () => {
    assert.deepEqual(validateProposal(log, state), log);
    const del = { type: 'delete', target: { setId: 'h1' }, summary: 'Delete?' };
    assert.deepEqual(validateProposal(del, state), del);
    const cor = { type: 'correct', target: { setId: 'a1' }, changes: { weight: 25 }, summary: 'Change?' };
    assert.deepEqual(validateProposal(cor, state), cor);
  });
  it('rejects unknown exercises, negative numbers, unknown sets and odd types', () => {
    const bad = (sets) => ({ ...log, set: sets[0], sets });
    assert.equal(validateProposal(bad([{ exercise: 'zercher_row', reps: 5, weight: 10, unit: 'lb' }]), state), null);
    assert.equal(validateProposal(bad([{ exercise: 'curl', reps: -5, weight: 10, unit: 'lb' }]), state), null);
    assert.equal(validateProposal(bad([{ exercise: 'curl', reps: 5, weight: -10, unit: 'lb' }]), state), null);
    assert.equal(validateProposal(bad([{ exercise: 'curl', reps: 5, weight: 10, unit: 'stone' }]), state), null);
    assert.equal(validateProposal(bad([]), state), null);
    assert.equal(validateProposal({ type: 'delete', target: { setId: 'zzz' }, summary: 'x' }, state), null);
    assert.equal(validateProposal({ type: 'correct', target: { setId: 'a1' }, changes: { reps: 0 }, summary: 'x' }, state), null);
    assert.equal(validateProposal({ type: 'correct', target: { setId: 'a1' }, changes: {}, summary: 'x' }, state), null);
    assert.equal(validateProposal({ type: 'drop_table', summary: 'x' }, state), null);
    assert.equal(validateProposal({ ...log, summary: '' }, state), null);
  });
});

describe('proxyUrl', () => {
  it('prefers env, then app.json extra, and trims trailing slashes', () => {
    assert.equal(proxyUrl({ EXPO_PUBLIC_JIM_PROXY_URL: 'http://a:8787/' }, { jimProxyUrl: 'http://b' }), 'http://a:8787');
    assert.equal(proxyUrl({}, { jimProxyUrl: 'http://b' }), 'http://b');
    assert.equal(proxyUrl({}, {}), null);
  });
});

describe('historyFor', () => {
  it('keeps the last 10 text turns as role/content and drops cards', () => {
    const msgs = Array.from({ length: 14 }, (_, i) => ({ me: i % 2 === 0, text: `m${i}` }));
    msgs.splice(3, 0, { kind: 'confirm', intent: {} });
    const h = historyFor(msgs);
    assert.equal(h.length, 10);
    assert.deepEqual(h.at(-1), { role: 'assistant', content: 'm13' });
    assert.ok(h.every((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'));
  });
});

const okFetch = (body) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => body }; };
  f.calls = calls;
  return f;
};

describe('askJim', () => {
  it('sends history + context and returns validated AI proposals', async () => {
    const good = { type: 'log', set: { exercise: 'curl', reps: 10, weight: 20, unit: 'lb' }, sets: [{ exercise: 'curl', reps: 10, weight: 20, unit: 'lb' }], summary: 'Log 10 × bicep curl at 20 lb?' };
    const bad = { type: 'delete', target: { setId: 'nope' }, summary: 'x' };
    const fetchImpl = okFetch({ reply: 'Confirm and I log it.', proposals: [good, bad] });
    const r = await askJim({ message: '10 curls at 20', history: [{ role: 'assistant', content: 'hi' }], state, url: 'http://x', fetchImpl, now: NOW });
    assert.equal(r.source, 'ai');
    assert.equal(r.reply, 'Confirm and I log it.');
    assert.deepEqual(r.proposals, [good]);
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, 'http://x/chat');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages.at(-1), { role: 'user', content: '10 curls at 20' });
    assert.equal(body.persona, 'analyst');
    assert.ok(body.context.recentSets.length);
  });

  it('never calls the network for pain and returns the safety reply', async () => {
    const fetchImpl = okFetch({});
    const r = await askJim({ message: 'my shoulder hurts', state, url: 'http://x', fetchImpl, now: NOW });
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(r.safety, true);
    assert.match(r.reply, /Stop the set now/);
  });

  it('falls back to rules with no URL', async () => {
    const r = await askJim({ message: '10 curls at 20 pounds', state, url: null, now: NOW });
    assert.equal(r.source, 'offline');
    assert.equal(r.proposals[0].type, 'log');
  });

  it('falls back to rules when the proxy errors, times out or returns junk', async () => {
    const failing = [
      async () => { throw new Error('network'); },
      async () => ({ ok: false, status: 502, json: async () => ({}) }),
      async () => ({ ok: true, json: async () => ({ nope: true }) }),
      (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    ];
    for (const fetchImpl of failing) {
      const r = await askJim({ message: 'what next for squat?', state, url: 'http://x', fetchImpl, timeoutMs: 20, now: NOW });
      assert.equal(r.source, 'offline');
      assert.equal(typeof r.reply, 'string');
      assert.ok(r.reply.length);
    }
  });

  it('offline clarify questions become the reply', async () => {
    const r = await askJim({ message: 'actually 7', state, url: null, now: NOW });
    assert.equal(r.source, 'offline');
    assert.ok(r.reply.length);
    assert.deepEqual(r.proposals, []);
  });
});
