// Excel export: four sheets from saved data, formulas, deterministic, no duplicate sessions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import { buildProgram, programToPlan } from './program.js';
import { createSchedule } from './schedule.js';
import { buildWorkbook, toXlsx } from './workbook.js';

const FULL_GYM = ['barbell', 'dumbbells', 'bench', 'cable', 'machine', 'pullup_bar', 'dip_bars', 'kettlebell'];
const program = buildProgram({ goal: 'muscle', experience: 'experienced', daysPerWeek: 3, minutes: 60, equipment: FULL_GYM, avoid: [], weeks: 8, split: 'ppl' }, { id: 'p1', now: '2026-11-09T12:00:00.000Z' });
const schedule = createSchedule(program, { startDate: '2026-11-09', timeZone: 'UTC' });
const plan = { ...programToPlan(program), schedule };
const w = (id, date, minutes, sets, name = 'Week 1 · Day 1 · Push') => ({
  id, name, startedAt: `${date}T15:00:00.000Z`, finishedAt: new Date(new Date(`${date}T15:00:00.000Z`).getTime() + minutes * 60000).toISOString(),
  planned: { name: name.split(' · ').at(-1) }, sets: sets.map(([reps, target], i) => ({ id: `${id}-${i}`, exercise: 'bench', reps, target, weight: 135, unit: 'lb' })),
});
const history = [
  w('a', '2026-11-09', 65, [[8, 8], [8, 8], [7, 8]]),
  w('b', '2026-11-13', 60, [[9, 8]], 'Week 1 · Day 3 · Legs'),
];
const opts = { history, plan, unit: 'lb', timeZone: 'UTC', now: new Date('2026-11-14T12:00:00.000Z') };

const sheetXml = (bytes) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith('xl/worksheets/')).map(([k, v]) => [k, strFromU8(v)]));
};

describe('buildWorkbook', () => {
  const book = buildWorkbook(opts);
  const sheet = (name) => book.sheets.find((s) => s.name === name);

  it('has the four sheets', () => {
    assert.deepEqual(book.sheets.map((s) => s.name), ['Gym Attendance', 'Workout History', 'Workout Split', 'Progression Analytics']);
  });

  it('attendance: completed and missed days with split and duration', () => {
    const rows = sheet('Gym Attendance').rows;
    assert.deepEqual(rows[0], ['Date', 'Day', 'Split', 'Status', 'Duration']);
    const row = (d) => rows.find((r) => r[0] === d);
    assert.deepEqual(row('11/09/2026'), ['11/09/2026', 'Monday', 'Push', 'Completed', '65 min']);
    assert.equal(row('11/11/2026')[3], 'Missed');
    assert.equal(row('11/13/2026')[3], 'Completed');
  });

  it('history: one row per set with target and actual reps', () => {
    const rows = sheet('Workout History').rows;
    assert.deepEqual(rows[0], ['Date', 'Exercise', 'Split', 'Set', 'Target Reps', 'Actual Reps', 'Weight']);
    assert.deepEqual(rows[1], ['11/09/2026', 'Bench press', 'Push', 1, 8, 8, '135 lb']);
    assert.deepEqual(rows[3], ['11/09/2026', 'Bench press', 'Push', 3, 8, 7, '135 lb']);
    assert.equal(rows.length, 1 + 4);
  });

  it('split: weekdays with sessions, exercises, sets and rep targets; rest days listed', () => {
    const rows = sheet('Workout Split').rows;
    assert.ok(rows.some((r) => r[0] === 'Monday' && r[1] === 'Push' && typeof r[3] === 'number'));
    assert.ok(rows.some((r) => r[0] === 'Tuesday' && r[1] === 'Rest'));
  });

  it('analytics uses formulas over the other sheets', () => {
    const cells = sheet('Progression Analytics').rows.flat();
    assert.ok(cells.some((c) => c?.f && /COUNTIF\('Gym Attendance'/.test(c.f)));
    assert.ok(cells.some((c) => c?.f && /Workout History/.test(c.f)));
  });

  it('a retried sync with duplicate sessions does not duplicate rows', () => {
    const dup = buildWorkbook({ ...opts, history: [...history, history[0]] });
    assert.deepEqual(dup, book);
  });
});

describe('toXlsx', () => {
  it('writes a valid workbook, identical bytes for the same data', () => {
    const a = toXlsx(buildWorkbook(opts));
    const b = toXlsx(buildWorkbook(opts));
    assert.deepEqual(a, b);
    const files = unzipSync(a);
    assert.ok(files['[Content_Types].xml'] && files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']);
    const sheets = sheetXml(a);
    assert.equal(Object.keys(sheets).length, 4);
    assert.match(sheets['xl/worksheets/sheet1.xml'], /11\/09\/2026/);
    assert.match(sheets['xl/worksheets/sheet4.xml'], /<f>/);
    assert.match(strFromU8(files['xl/workbook.xml']), /Gym Attendance/);
  });
});
