// Regenerates workouts.xlsx (a minimal but valid Excel workbook) for importWorkouts tests.
// Run: node src/lib/fixtures/import/make-xlsx.mjs
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

const shared = ['Date', 'Lift', 'Sets', 'Reps', 'Load', 'Unit', 'Pull Up', 'kg', 'Shoulder Press', 'Leg extension'];
const s = (i) => `<c t="s"><v>${i}</v></c>`;
const n = (v) => `<c><v>${v}</v></c>`;
const inl = (t) => `<c t="inlineStr"><is><t>${t}</t></is></c>`;
// Row 2 date is an Excel serial (46328 = 2026-11-02); row 3 is a text date; row 4 is an unknown lift.
const rows = [
  [s(0), s(1), s(2), s(3), s(4), s(5)],
  [n(46328), s(6), n(4), n(6), n(10), s(7)],
  [inl('2026-11-04'), s(8), n(3), n(10), n(20), s(7)],
  [inl('2026-11-04'), s(9), n(3), n(12), n(30), s(7)],
];
const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
  .map((r, i) => `<row r="${i + 1}">${r.map((c, j) => c.replace('<c', `<c r="${'ABCDEF'[j]}${i + 1}"`)).join('')}</row>`)
  .join('')}</sheetData></worksheet>`;
const sst = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
const zip = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Log" sheetId="1"/></sheets></workbook>'),
  'xl/sharedStrings.xml': strToU8(sst),
  'xl/worksheets/sheet1.xml': strToU8(sheet),
});
writeFileSync(new URL('./workouts.xlsx', import.meta.url), zip);
