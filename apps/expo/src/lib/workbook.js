// Excel export (.xlsx) of the saved workout data. The app's own storage stays the source of truth;
// the workbook is regenerated from it each time, so exporting again never duplicates sessions.
// Sheets: Gym Attendance, Workout History, Workout Split, Progression Analytics (with formulas).
// Charts are left to Excel (Insert > Chart on the analytics tables); writing chart XML by hand
// would add a lot of untested surface for little value.
import { strToU8, zipSync } from 'fflate';

import { addDays, attendance, completedWorkouts, dayKey, daysBetween, deviceTimeZone, WEEKDAY_NAMES, WEEKDAYS, weekdayOf, weekStartOf, workoutMinutes } from './attendance.js';
import { exerciseName } from './exercises.js';
import { exerciseSessions } from './progression.js';
import { isRestDayFor, planFor } from './schedule.js';

const SHEETS = ['Gym Attendance', 'Workout History', 'Workout Split', 'Progression Analytics'];
const fmt = (key) => `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(0, 4)}`;
const STATUS = { completed: 'Completed', missed: 'Missed', rest: 'Rest', scheduled: 'Scheduled' };
const splitName = (w) => w.planned?.name ?? String(w.name ?? '').split(' · ').at(-1) ?? '';
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export const workbookFilename = (now = new Date(), timeZone = deviceTimeZone()) => `jimbro-workouts-${dayKey(now, timeZone)}.xlsx`;

export function buildWorkbook({ history = [], plan = null, unit = 'lb', timeZone = deviceTimeZone(), now = new Date() } = {}) {
  const workouts = completedWorkouts(history).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const today = dayKey(now, timeZone);
  const program = plan?.program ?? null;
  const schedule = program && plan?.schedule?.programId === program.id ? plan.schedule : null;
  const ctx = schedule ? { schedule, program, history: workouts, today } : null;
  const byDay = new Map();
  for (const w of workouts) {
    const k = dayKey(w.startedAt, timeZone);
    byDay.set(k, [...(byDay.get(k) ?? []), w]);
  }

  // Sheet 1: attendance, one row per day (completed, missed, rest and scheduled days when a schedule exists).
  const attendanceRows = [['Date', 'Day', 'Split', 'Status', 'Duration']];
  const first = [...byDay.keys(), ...(schedule ? [schedule.startDate] : [])].sort()[0];
  if (first) {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const done = byDay.get(d) ?? [];
      const p = ctx ? planFor(d, ctx) : null;
      if (!done.length && (!p || !STATUS[p.status])) continue;
      const minutes = done.reduce((t, w) => t + (workoutMinutes(w) ?? 0), 0);
      const split = done.length ? [...new Set(done.map(splitName).filter(Boolean))].join(' + ') || p?.name || '' : p?.name ?? '';
      attendanceRows.push([fmt(d), WEEKDAY_NAMES[weekdayOf(d)], split, done.length ? 'Completed' : STATUS[p.status], done.length ? `${minutes} min` : '']);
    }
  }

  // Sheet 2: every saved set.
  const historyRows = [['Date', 'Exercise', 'Split', 'Set', 'Target Reps', 'Actual Reps', 'Weight']];
  for (const w of workouts) {
    const n = {};
    for (const s of w.sets) {
      n[s.exercise] = (n[s.exercise] ?? 0) + 1;
      historyRows.push([fmt(dayKey(w.startedAt, timeZone)), exerciseName(s.exercise), splitName(w), n[s.exercise], s.target ?? '', s.reps ?? 0, s.weight > 0 ? `${s.weight} ${s.unit ?? unit}` : 'bodyweight']);
    }
  }

  // Sheet 3: the current schedule (or plan days), with prescriptions.
  const splitRows = [['Day', 'Session', 'Exercise', 'Sets', 'Target Reps', 'Rest', 'Effort (RPE)']];
  const itemRow = (day, session, i) => [day, session, exerciseName(i.exercise), i.sets, `${i.reps_low}–${i.reps_high}`, `${i.rest_sec ?? Math.round((i.rest_min ?? 0) * 60)} s`, i.rpe_low != null ? `${i.rpe_low}–${i.rpe_high}` : ''];
  if (schedule) {
    const week = Math.min(program.weeks.length, Math.max(1, Math.floor(daysBetween(schedule.startDate, today) / 7) + 1));
    splitRows.push([`Week ${week} of ${program.weeks.length}${program.weeks[week - 1].deload ? ' (deload)' : ''}`, program.name, '', '', '', '', '']);
    for (const wd of WEEKDAYS) {
      const idx = schedule.week[wd];
      if (idx == null) { splitRows.push([WEEKDAY_NAMES[wd], 'Rest', '', '', '', '', '']); continue; }
      const s = program.weeks[week - 1].sessions[idx];
      for (const i of s.items) splitRows.push(itemRow(WEEKDAY_NAMES[wd], s.name, i));
    }
  } else if (plan?.days?.length) {
    for (const d of plan.days) for (const i of d.items) splitRows.push(itemRow(`Day ${d.day}`, d.name ?? `Day ${d.day}`, i));
  } else splitRows.push(['No plan saved yet', '', '', '', '', '', '']);

  // Sheet 4: analytics. Summary cells are formulas over sheets 1-2 (with cached values).
  const a = attendance(workouts, { now, timeZone, isRestDay: schedule ? isRestDayFor(schedule) : undefined });
  const missed = attendanceRows.filter((r) => r[3] === 'Missed').length;
  const sets = historyRows.length - 1;
  const volume = workouts.reduce((t, w) => t + w.sets.reduce((x, s) => x + (s.reps ?? 0) * (s.weight ?? 0), 0), 0);
  const withTarget = workouts.flatMap((w) => w.sets).filter((s) => Number.isFinite(s.target));
  const analytics = [
    ['Summary', 'Value'],
    ['Gym days (lifetime)', { f: 'COUNTIF(\'Gym Attendance\'!D:D,"Completed")', v: a.lifetime }],
    ['Missed scheduled workouts', { f: 'COUNTIF(\'Gym Attendance\'!D:D,"Missed")', v: missed }],
    ['Workout completion rate', { f: 'IFERROR(B2/(B2+B3),"")', v: a.lifetime + missed ? round(a.lifetime / (a.lifetime + missed), 3) : '' }],
    ['Sets logged', { f: "COUNTA('Workout History'!A:A)-1", v: sets }],
    ['Sets that hit the target', { f: "SUMPRODUCT(--('Workout History'!F2:F100000>='Workout History'!E2:E100000),--('Workout History'!E2:E100000<>\"\"))", v: withTarget.filter((s) => s.reps >= s.target).length }],
    [`Training volume (reps × weight, ${unit})`, round(volume, 0)],
    ['Gym days this week', a.thisWeek],
    ['Gym days this month', a.thisMonth],
    ['Current streak (gym days)', a.currentStreak],
    ['Longest streak (gym days)', a.longestStreak],
    [],
    ['Weekly attendance', ''],
    ['Week of', 'Gym days'],
  ];
  for (let k = 7; k >= 0; k -= 1) {
    const start = addDays(weekStartOf(today), -7 * k);
    analytics.push([fmt(start), a.days.filter((d) => d >= start && d < addDays(start, 7)).length]);
  }
  analytics.push([], ['Monthly attendance', ''], ['Month', 'Gym days']);
  for (let k = 5; k >= 0; k -= 1) {
    const m = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - k, 1)).toISOString().slice(0, 7);
    analytics.push([`${m.slice(5)}/${m.slice(0, 4)}`, a.days.filter((d) => d.startsWith(m)).length]);
  }
  analytics.push([], ['Exercise progress', ''], ['Exercise', 'Sessions', 'First top set', 'Latest top set', 'Best est. 1RM', 'Heaviest set', 'Volume', 'Avg actual − target reps']);
  const exercises = [...new Set(workouts.flatMap((w) => w.sets.map((s) => s.exercise)))].sort();
  for (const ex of exercises) {
    const units = [...new Set(workouts.flatMap((w) => w.sets.filter((s) => s.exercise === ex).map((s) => s.unit ?? unit)))].sort();
    for (const u of units) {
      const ss = exerciseSessions(workouts, ex, u);
      if (!ss.length) continue;
      const top = (s) => (s.top.weight > 0 ? `${s.top.reps} × ${s.top.weight} ${u}` : `${s.top.reps} reps`);
      const all = workouts.flatMap((w) => w.sets).filter((s) => s.exercise === ex && (s.unit ?? unit) === u);
      const diffs = all.filter((s) => Number.isFinite(s.target)).map((s) => s.reps - s.target);
      const heaviest = Math.max(...all.map((s) => s.weight ?? 0));
      analytics.push([exerciseName(ex), ss.length, top(ss[0]), top(ss.at(-1)), heaviest > 0 ? round(Math.max(...ss.map((s) => s.best)), 1) : '', heaviest > 0 ? `${heaviest} ${u}` : 'bodyweight', round(all.reduce((t, s) => t + (s.reps ?? 0) * (s.weight ?? 0), 0), 0), diffs.length ? round(diffs.reduce((t, x) => t + x, 0) / diffs.length, 2) : '']);
    }
  }

  return { sheets: [attendanceRows, historyRows, splitRows, analytics].map((rows, i) => ({ name: SHEETS[i], rows })) };
}

// ---------- .xlsx writer (inline strings, no shared strings table) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (n) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

function cellXml(v, ref, bold) {
  const style = bold ? ' s="1"' : '';
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v.f) {
    const cached = v.v == null || v.v === '' ? '' : typeof v.v === 'number' ? `<v>${v.v}</v>` : `<v>${esc(v.v)}</v>`;
    return `<c r="${ref}"${style}${typeof v.v === 'number' ? '' : ' t="str"'}><f>${esc(v.f)}</f>${cached}</c>`;
  }
  if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(rows) {
  const widths = [];
  rows.forEach((r) => r.forEach((v, i) => { widths[i] = Math.min(48, Math.max(widths[i] ?? 8, String(v?.v ?? v ?? '').length + 2)); }));
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(v, `${col(ci)}${ri + 1}`, ri === 0 || (r.length <= 2 && r[1] === ''))).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const MTIME = new Date('2026-01-01T00:00:00Z'); // fixed, so the same data gives the same bytes

/** Workbook -> .xlsx bytes (Uint8Array). */
export function toXlsx(book) {
  const n = book.sheets.length;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${book.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${book.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
  book.sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows); });
  const zipped = {};
  for (const [k, v] of Object.entries(files)) zipped[k] = [strToU8(v), { mtime: MTIME }];
  return zipSync(zipped, { level: 6 });
}
