import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chronologicalHistory, sessionOptions } from './historyOrder.js';

const first = { id: 'morning', startedAt: '2026-11-05T08:00:00-05:00', name: 'DEMO Upper Body' };
const second = { id: 'evening', startedAt: '2026-11-05T18:00:00-05:00', name: 'DEMO Lower Body' };
test('chronological storage uses actual timestamps and preserves stable IDs without mutating input', () => {
  const input = [second, first];
  assert.deepEqual(chronologicalHistory(input).map(w => w.id), ['morning', 'evening']);
  assert.equal(input[0], second);
});
test('date-only choices disambiguate sessions chronologically without exposing names or times', () => {
  const options = sessionOptions([second, first]);
  assert.deepEqual(options.map(o => o.key), ['evening', 'morning']);
  assert.match(options[0].label, /Session 2$/);
  assert.match(options[1].label, /Session 1$/);
  assert.ok(options.every(o => !/DEMO|Body|18:|08:/.test(o.label)));
  assert.ok(!sessionOptions([first])[0].label.includes('Session'));
});
