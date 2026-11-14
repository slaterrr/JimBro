import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createHealthXmlParser, nativeHealthAdapter, parseHealthCsv, parseHealthXml } from './healthData.js';

const xml = readFileSync(new URL('./fixtures/health-export-sample.xml', import.meta.url), 'utf8');

test('export.xml: sums steps, energy, exercise per local day; keeps workouts; ignores other types', () => {
  const r = parseHealthXml(xml);
  assert.deepEqual(r.daily, [
    { date: '2026-11-10', steps: 8500, activeKcal: 250.5, exerciseMin: 30 },
    { date: '2026-11-11', steps: 6000, activeKcal: 100 },
  ]);
  assert.deepEqual(r.workouts, [{ date: '2026-11-11', minutes: 45, type: 'TraditionalStrengthTraining' }]);
});

test('streaming: feeding the file in tiny chunks gives the same result', () => {
  const p = createHealthXmlParser();
  for (let i = 0; i < xml.length; i += 17) p.push(xml.slice(i, i + 17));
  assert.deepEqual(p.result(), parseHealthXml(xml));
});

test('CSV: date,steps,active_kcal,exercise_min with header, blanks allowed', () => {
  const r = parseHealthCsv('date,steps,active_kcal,exercise_min\n2026-11-01,7000,300,20\n2026-11-02,,,\n2026-11-03,5000,,\n');
  assert.deepEqual(r.daily, [
    { date: '2026-11-01', steps: 7000, activeKcal: 300, exerciseMin: 20 },
    { date: '2026-11-03', steps: 5000 },
  ]);
});

test('native adapter is unavailable (no crash) when the module is missing, e.g. Expo Go', async () => {
  const a = nativeHealthAdapter(null);
  assert.equal(a.available, false);
  assert.match(a.reason, /development build/i);
  await assert.rejects(a.read(), /development build/i);
});

test('native adapter maps a provided module to daily totals', async () => {
  const mod = { requestRead: async () => true, dailyTotals: async () => [{ date: '2026-11-01', steps: 9000 }], workouts: async () => [] };
  const a = nativeHealthAdapter(mod);
  assert.equal(a.available, true);
  assert.deepEqual(await a.read(), { daily: [{ date: '2026-11-01', steps: 9000 }], workouts: [] });
});
