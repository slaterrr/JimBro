// Contract tests for the Expo app's pure logic. Run: npm test (node --test).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, createApi } from './api.js';
import { normalizeServer, wsUrl, pwaUrl } from './config.js';
import { EXERCISES, exerciseName } from './exercises.js';
import { fallbackReply, localPlan } from './offline.js';
import { parseSetUtterance } from './parse.js';
import { SetQueue } from './queue.js';
import { applyStationEvent, initialStation, repsSinceLastSet } from './station.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), _m: m };
};

const reply = (status, body) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });

describe('config', () => {
  it('normalizes a typed Pi address to the LAN HTTP API', () => {
    assert.equal(normalizeServer('jimbro.local'), 'http://jimbro.local:8080');
    assert.equal(normalizeServer(' 192.168.1.20 '), 'http://192.168.1.20:8080');
    assert.equal(normalizeServer('http://10.0.0.5:9000/'), 'http://10.0.0.5:9000');
    assert.equal(normalizeServer('https://jimbro.local'), 'http://jimbro.local:8080');
    assert.equal(normalizeServer(''), null);
    assert.equal(normalizeServer('bad host!'), null);
  });
  it('derives websocket and PWA urls', () => {
    assert.equal(wsUrl('http://jimbro.local:8080', '/v1/station'), 'ws://jimbro.local:8080/v1/station');
    assert.equal(pwaUrl('http://10.0.0.5:8080'), 'https://10.0.0.5/');
  });
});

describe('exercises', () => {
  it('maps the six API lifts to display names', () => {
    assert.deepEqual(EXERCISES.map((e) => e.id), ['curl', 'squat', 'bench', 'deadlift', 'shoulder_press', 'pull_up']);
    assert.equal(exerciseName('shoulder_press'), 'Shoulder press');
    assert.equal(exerciseName('mystery'), 'mystery');
  });
});

describe('api client', () => {
  it('sends athlete header and JSON, returns parsed body', async () => {
    const calls = [];
    const api = createApi({
      base: 'http://pi:8080', athlete: 'alex',
      fetchImpl: async (url, init) => { calls.push([url, init]); return reply(201, { id: 's1' }); },
    });
    assert.deepEqual(await api.createSession(), { id: 's1' });
    assert.equal(calls[0][0], 'http://pi:8080/v1/sessions');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].headers['X-Athlete-Id'], 'alex');
    assert.equal(calls[0][1].body, '{}');
  });
  it('raises ApiError with status and detail', async () => {
    const api = createApi({ base: 'http://pi:8080', fetchImpl: async () => reply(409, { detail: 'conflict' }) });
    await assert.rejects(api.completeSet('a', {}), (e) => e instanceof ApiError && e.status === 409 && e.message === 'conflict');
  });
  it('turns hangs into a timeout network error', async () => {
    const api = createApi({ base: 'http://pi:8080', timeoutMs: 20, fetchImpl: (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
    await assert.rejects(api.status(), (e) => !(e instanceof ApiError) && /timed out/.test(e.message));
  });
  it('builds every endpoint path', async () => {
    const urls = [];
    const api = createApi({ base: 'http://pi:8080', fetchImpl: async (u, init) => { urls.push(`${init.method} ${u.replace('http://pi:8080', '')}`); return reply(200, {}); } });
    await api.endSession('s 1'); await api.summary('s1'); await api.completeSet('x/y', {});
    await api.coach('hi', 'hard'); await api.plan({}); await api.progress('curl'); await api.leaderboard('sessions');
    await api.me(); await api.saveMe('Al', true); await api.seedDemo(); await api.suggestion('squat'); await api.exercises();
    assert.deepEqual(urls, [
      'POST /v1/sessions/s%201/end', 'GET /v1/sessions/s1/summary', 'POST /v1/sets/x%2Fy/complete',
      'POST /v1/coach', 'POST /v1/plans', 'GET /v1/progress/curl', 'GET /v1/leaderboard?metric=sessions',
      'GET /v1/athletes/me', 'PUT /v1/athletes/me', 'POST /v1/demo/seed', 'GET /v1/suggestions/squat', 'GET /v1/exercises',
    ]);
  });
});

describe('SetQueue', () => {
  const body = (reps = 5) => ({ exercise: 'curl', weight: 10, unit: 'lb', reps, source: 'manual', reps_detail: [] });

  it('creates the server session lazily and maps local session ids', async () => {
    const storage = memoryStorage();
    const sent = [];
    const api = { createSession: async () => ({ id: 'srv-1' }), completeSet: async (id, b) => { sent.push([id, b.session_id]); } };
    const q = new SetQueue(api, storage);
    await q.submit('set-1', 'local-A', body());
    await q.submit('set-2', 'local-A', body());
    assert.deepEqual(sent, [['set-1', 'srv-1'], ['set-2', 'srv-1']]);
    assert.deepEqual(await q.pending(), []);
  });
  it('keeps sets offline across restarts and flushes them later with the same ids', async () => {
    const storage = memoryStorage();
    let online = false;
    const sent = [];
    const api = {
      createSession: async () => { if (!online) throw new TypeError('Network request failed'); return { id: 'srv' }; },
      completeSet: async (id) => { sent.push(id); },
    };
    await new SetQueue(api, storage).submit('set-1', 'local', body());
    const restarted = new SetQueue(api, storage);
    assert.equal((await restarted.pending()).length, 1);
    online = true;
    assert.equal(await restarted.flush(), 1);
    assert.deepEqual(sent, ['set-1']);
  });
  it('drops permanently rejected sets and reports them, retries 5xx', async () => {
    const rejected = [];
    const api5 = { createSession: async () => ({ id: 's' }), completeSet: async () => { throw new ApiError(503, 'busy'); } };
    const q5 = new SetQueue(api5, memoryStorage());
    await q5.submit('a', 'l', body());
    assert.equal((await q5.pending()).length, 1);
    const api4 = { createSession: async () => ({ id: 's' }), completeSet: async () => { throw new ApiError(422, 'bad'); } };
    const q4 = new SetQueue(api4, memoryStorage(), (id, e) => rejected.push([id, e.status]));
    await q4.submit('a', 'l', body());
    assert.deepEqual(await q4.pending(), []);
    assert.deepEqual(rejected, [['a', 422]]);
  });
  it('tolerates corrupt storage', async () => {
    const storage = memoryStorage();
    await storage.setItem('jimbro.queue.v1', '{nope');
    assert.deepEqual(await new SetQueue({}, storage).pending(), []);
  });
});

describe('parseSetUtterance (keyboard dictation / typed)', () => {
  it('parses common phrasings', () => {
    assert.deepEqual(parseSetUtterance('10 curls at 20 pounds rpe 7'), { exercise: 'curl', reps: 10, weight: 20, unit: 'lb', rpe: 7 });
    assert.deepEqual(parseSetUtterance('ten squats at sixty kilos'), { exercise: 'squat', reps: 10, weight: 60, unit: 'kg' });
    assert.deepEqual(parseSetUtterance('did 12 pull ups'), { exercise: 'pull_up', reps: 12, weight: 0 });
    assert.equal(parseSetUtterance('overhead press 6 reps 30 lbs').exercise, 'shoulder_press');
  });
  it('returns null for chat that is not a set', () => {
    assert.equal(parseSetUtterance('how should I train legs?'), null);
  });
});

describe('station feed', () => {
  const rep = (seq, index, tut = 2000) => ({ type: 'rep', seq, index, tut_ms: tut, movement: 'curl', concentric_ms: 800, peak_pause_ms: 200, eccentric_ms: 1000 });
  it('collects live reps until a set is saved and ignores stale seq', () => {
    let s = applyStationEvent(initialStation, { type: 'hello', last: null });
    s = applyStationEvent(s, rep(1, 1));
    s = applyStationEvent(s, rep(2, 2));
    s = applyStationEvent(s, rep(2, 2));
    assert.equal(s.reps.length, 2);
    assert.deepEqual(repsSinceLastSet(s)[1], { index: 2, concentric_ms: 800, peak_pause_ms: 200, eccentric_ms: 1000 });
    s = applyStationEvent(s, { type: 'set', seq: 3, exercise: 'curl', reps: 2 });
    assert.equal(s.reps.length, 0);
    s = applyStationEvent(s, rep(4, 1));
    assert.equal(s.movement, 'curl');
  });
  it('a rep index restart begins a new set', () => {
    let s = applyStationEvent(initialStation, rep(1, 1));
    s = applyStationEvent(s, rep(2, 2));
    s = applyStationEvent(s, rep(3, 1));
    assert.equal(s.reps.length, 1);
  });
});

describe('offline fallbacks', () => {
  it('gives a reply in every tone and a safety reply for pain', () => {
    for (const tone of ['direct', 'friendly', 'silly', 'hard']) assert.ok(fallbackReply('next?', tone).text.length > 10);
    const safety = fallbackReply('sharp pain in my elbow', 'hard');
    assert.equal(safety.source, 'safety');
    assert.match(safety.text, /stop/i);
  });
  it('builds a local plan matching days and equipment', () => {
    const plan = localPlan({ goal: 'strength', days_per_week: 4, minutes_per_session: 45, equipment: ['dumbbells'] });
    assert.equal(plan.days.length, 4);
    assert.ok(plan.days.every((d) => d.items.every((i) => i.exercise !== 'deadlift' && i.exercise !== 'pull_up')));
    assert.equal(plan.source, 'offline');
  });
});
