import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { EXERCISES } from './exercises.js';
import { goalProgress } from './goals.js';
import { parseImport } from './tools.js';

// Team demo data (fictional, from demo-workouts.json on the Expo preview site), verified 2026-11-14.
const raw = readFileSync(new URL('./fixtures/demo-workouts.json', import.meta.url), 'utf8');
const data = JSON.parse(raw);
const sets = data.history.flatMap((w) => w.sets);

test('demo data imports through the app restore path', () => {
  const r = parseImport(raw);
  assert.equal(r.history.length, 14);
});

test('demo data is sane: known lifts, plausible numbers, unique ids, chronological', () => {
  const ids = new Set(EXERCISES.map((e) => e.id));
  assert.equal(new Set(sets.map((s) => s.id)).size, sets.length);
  for (const s of sets) {
    assert.ok(ids.has(s.exercise), s.exercise);
    assert.ok(Number.isInteger(s.reps) && s.reps >= 1 && s.reps <= 30);
    assert.ok(s.weight >= 0 && s.weight < 600);
    assert.ok(s.rpe == null || (s.rpe >= 1 && s.rpe <= 10));
  }
  const starts = data.history.map((w) => w.startedAt);
  assert.deepEqual(starts, [...starts].sort());
});

test('demo data contains no personal information and is clearly labeled', () => {
  assert.doesNotMatch(raw, /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|"(email|phone|athlete|user)"\s*:/i);
  for (const w of data.history) assert.match(w.name, /^DEMO\b/);
});

test('demo data drives a real goal measurement', () => {
  const p = goalProgress({ id: 'g', type: 'strength', exercise: 'squat', metric: 'weight', target: 185, unit: 'lb' }, data.history, new Date('2026-11-13T12:00:00Z'));
  assert.equal(p.current, 135);
  assert.ok(p.pct > 0 && p.pct < 100);
});
