// End-to-end check of the Expo app's data layer against a real JimBro server.
//   JIMBRO_API=http://127.0.0.1:8080 npm test
// Skipped when JIMBRO_API is not set (CI runs it against a freshly started server).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApi } from './api.js';
import { wsUrl } from './config.js';
import { SetQueue } from './queue.js';
import { applyStationEvent, initialStation } from './station.js';

const BASE = process.env.JIMBRO_API;
const memoryStorage = () => {
  const m = new Map();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
};

describe('Expo data layer against a live Pi API', { skip: !BASE && 'set JIMBRO_API to run' }, () => {
  const athlete = `expo${Date.now().toString(36)}`;
  const api = createApi({ base: BASE, athlete });

  it('logs sets through the offline queue and reads them back', async () => {
    const q = new SetQueue(api, memoryStorage());
    const set = { exercise: 'curl', weight: 20, unit: 'lb', reps: 8, rpe: 7, source: 'manual', reps_detail: [] };
    await q.submit(`${athlete}-1`, 'local-1', set);
    await q.submit(`${athlete}-1`, 'local-1', set); // retry is idempotent
    assert.deepEqual(await q.pending(), []);
    const serverId = await q.sessionFor('local-1');
    const summary = await api.summary(serverId);
    assert.equal(summary.total_reps, 8);
    assert.deepEqual(summary.volume, { lb: 160 });
  });

  it('gets coach, plan, progress and leaderboard in the shapes the screens use', async () => {
    const reply = await api.coach('what next?', 'hard');
    assert.ok(reply.text && ['ai', 'fallback'].includes(reply.source));
    assert.equal(reply.suggestion.exercise, 'curl');
    const plan = await api.plan({ goal: 'general', days_per_week: 2, minutes_per_session: 45, equipment: ['dumbbells'] });
    assert.equal(plan.days.length, 2);
    const progress = await api.progress('curl');
    assert.ok(progress.by_unit.lb.points.length >= 1);
    await api.saveMe('Expo Test', true);
    const board = await api.leaderboard('reps');
    assert.ok(board.entries.some((e) => e.display_name === 'Expo Test'));
    await api.saveMe('Expo Test', false);
  });

  it('receives live events over the station websocket', async () => {
    const ws = new WebSocket(wsUrl(BASE, '/v1/station'));
    let state = initialStation;
    const got = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no station event')), 5000);
      ws.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        state = applyStationEvent(state, ev);
        if (ev.type === 'hello') fetch(`${BASE}/v1/station/button`, { method: 'POST' });
        if (ev.type === 'button') { clearTimeout(timer); resolve(ev); }
      };
    });
    const ev = await got;
    ws.close();
    assert.ok(ev.seq >= 1 && state.seq === ev.seq);
  });
});
