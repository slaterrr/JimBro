import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport } from './tools.js';
const file = patch => JSON.stringify({ format: 'jimbro-phone-export-v1', history: [{ id: 'session', startedAt: '2026-11-14T22:00:00Z', sets: [], ...patch }] });
test('imports reject invalid calendar dates and reversed sessions', () => {
  for (const startedAt of ['not-a-date', '2026-02-30', '2026-13-01', '']) assert.throws(() => parseImport(file({ startedAt })), /invalid date/);
  assert.throws(() => parseImport(file({ finishedAt: '2026-11-13T22:00:00Z' })), /invalid date/);
});
test('valid import timestamps retain their original timezone and identity', () => {
  const startedAt = '2026-11-14T17:00:00-05:00';
  const result = parseImport(file({ startedAt }));
  assert.equal(result.history[0].startedAt, startedAt);
  assert.equal(result.history[0].id, 'session');
});
