import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { importRows, mapHeaders, matchExercise, parseCSV, parseWorkoutFile, readXlsx, toExport } from './importWorkouts.js';
import { parseImport } from './tools.js';

const fx = (name) => readFileSync(new URL(`./fixtures/import/${name}`, import.meta.url));

describe('parseCSV', () => {
  it('handles quotes, embedded commas, CRLF and blank lines', () => {
    assert.deepEqual(parseCSV('a,"b, c",d\r\n\r\n1,"say ""hi""",3\n'), [['a', 'b, c', 'd'], ['1', 'say "hi"', '3']]);
  });
  it('detects semicolon-separated files', () => {
    assert.deepEqual(parseCSV('date;exercise;reps\n2026-10-01;squat;5'), [['date', 'exercise', 'reps'], ['2026-10-01', 'squat', '5']]);
  });
});

describe('mapHeaders', () => {
  it('matches messy header names tolerantly', () => {
    const m = mapHeaders([' Workout Date ', 'Exercise Name', '# Sets', 'Reps', 'Weight (lbs)', 'Units', 'Notes']);
    assert.deepEqual(m, { date: 0, exercise: 1, sets: 2, reps: 3, weight: 4, unit: 5 });
  });
  it('accepts Lift / Load / Day synonyms and reports missing required columns', () => {
    assert.deepEqual(mapHeaders(['Day', 'Lift', 'Load', 'Rep count']), { date: 0, exercise: 1, weight: 2, reps: 3 });
    assert.throws(() => mapHeaders(['foo', 'bar']), /date.*exercise.*reps/i);
  });
});

describe('matchExercise', () => {
  it('maps common names to catalog ids', () => {
    for (const [name, id] of [['Back Squat', 'squat'], ['BB Bench Press', 'bench'], ['OHP', 'shoulder_press'], ['Chin-ups', 'pull_up'], ['Deadlifts', 'deadlift'], ['Walking lunges', 'lunge'], ['pull up', 'pull_up']]) {
      assert.equal(matchExercise(name), id, name);
    }
  });
  it('does not guess variations it does not know', () => {
    for (const name of ['Romanian deadlift', 'Cable crossover', 'Leg extension', 'Front squat', '']) assert.equal(matchExercise(name), null, name);
  });
});

describe('importRows on a messy CSV', () => {
  const r = parseWorkoutFile({ name: 'messy.csv', bytes: fx('messy.csv') }, { unit: 'lb' });
  it('imports matched rows grouped into one workout per date', () => {
    assert.deepEqual(r.workouts.map((w) => w.startedAt.slice(0, 10)), ['2026-11-01', '2026-11-03']);
    const day1 = r.workouts[0].sets;
    assert.equal(day1.length, 6); // 3 squat + 3 bench
    assert.deepEqual(day1[0], { id: day1[0].id, exercise: 'squat', reps: 5, weight: 225, unit: 'lb', rpe: null, source: 'import', reps_detail: [], loggedAt: '2026-11-01T12:00:00.000Z', pr: false });
    const day3 = r.workouts[1].sets;
    assert.deepEqual(day3.map((s) => [s.exercise, s.weight, s.unit]), [['shoulder_press', 95, 'lb'], ['shoulder_press', 95, 'lb'], ['pull_up', 0, 'lb'], ['pull_up', 0, 'lb'], ['pull_up', 0, 'lb']]);
  });
  it('reports unmatched and bad rows with line numbers and reasons instead of guessing', () => {
    assert.deepEqual(r.skipped.map((s) => [s.line, s.reason]), [
      [4, 'unknown exercise "Cable crossover"'],
      [7, 'unknown exercise "Bicep Curls"'],
      [8, 'missing or unreadable date'],
      [9, 'unknown exercise "Romanian deadlift"'],
    ]);
    assert.equal(r.setCount, 11);
    assert.match(r.summary, /11 sets from 4 rows over 2 days; 4 rows skipped/);
  });
  it('produces ids that are stable across re-imports (merge dedupes)', () => {
    const again = parseWorkoutFile({ name: 'messy.csv', bytes: fx('messy.csv') }, { unit: 'lb' });
    assert.deepEqual(again.workouts.map((w) => w.id), r.workouts.map((w) => w.id));
  });
  it('round-trips through the existing export validator', () => {
    const parsed = parseImport(toExport(r.workouts));
    assert.equal(parsed.history.length, 2);
  });
});

describe('xlsx', () => {
  it('reads shared strings, inline strings and numbers from the first sheet', () => {
    const rows = readXlsx(fx('workouts.xlsx'));
    assert.deepEqual(rows[0], ['Date', 'Lift', 'Sets', 'Reps', 'Load', 'Unit']);
    assert.deepEqual(rows[1], ['46328', 'Pull Up', '4', '6', '10', 'kg']);
  });
  it('imports with Excel serial dates and the kg unit column', () => {
    const r = parseWorkoutFile({ name: 'Workouts.XLSX', bytes: fx('workouts.xlsx') }, { unit: 'lb' });
    assert.deepEqual(r.workouts.map((w) => w.startedAt.slice(0, 10)), ['2026-11-02', '2026-11-04']);
    assert.deepEqual(r.workouts[0].sets[0], { ...r.workouts[0].sets[0], exercise: 'pull_up', reps: 6, weight: 10, unit: 'kg' });
    assert.equal(r.workouts[1].sets.length, 3);
    assert.deepEqual(r.skipped.map((s) => s.reason), ['unknown exercise "Leg extension"']);
  });
  it('rejects files that are not a workbook', () => {
    assert.throws(() => parseWorkoutFile({ name: 'x.xlsx', bytes: new Uint8Array([1, 2, 3]) }), /Excel/);
    assert.throws(() => parseWorkoutFile({ name: 'x.pdf', bytes: new Uint8Array([1]) }), /CSV or Excel/);
  });
});

describe('limits', () => {
  it('caps sets per row and rejects absurd numbers', () => {
    const r = importRows([['date', 'exercise', 'sets', 'reps', 'weight'], ['2026-11-01', 'squat', '50', '5', '100'], ['2026-11-01', 'squat', '1', '5', '99999']], { unit: 'kg' });
    assert.deepEqual(r.skipped.map((s) => s.reason), ['sets must be 1-20', 'weight must be 0-2000']);
  });
});
