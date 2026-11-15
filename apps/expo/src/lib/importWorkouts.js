// Import past workouts from a CSV or Excel (.xlsx) sheet. Pure: bytes in, workouts + a list of
// skipped rows out. Nothing is written here; the UI shows a preview and the user confirms, then
// the result goes through the existing export importer (tools.js parseImport/mergeHistory).
// Unknown exercise names are reported, never guessed.
import { strFromU8, unzipSync } from 'fflate';

const MAX_SETS_PER_ROW = 20;
const MAX_ROWS = 5000;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- CSV ----------
function delimiterOf(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch] += 1;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n ? best : ',';
}

/** CSV text -> rows of strings. Quotes, "" escapes, CRLF; blank lines dropped; , ; or tab. */
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const d = delimiterOf(src.split(/\r?\n/, 1)[0]);
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- XLSX (zip of XML; first worksheet only) ----------
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const textRuns = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** .xlsx bytes -> rows of strings from the first worksheet. */
export function readXlsx(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new Error('That file is not a readable Excel workbook.');
  }
  const sheetName = files['xl/worksheets/sheet1.xml'] ? 'xl/worksheets/sheet1.xml' : Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('That Excel workbook has no sheets.');
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1])) : [];
  const xml = strFromU8(files[sheetName]);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textRuns(body);
      else if (v != null) val = unxml(v);
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push('');
      row[at] = val;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// ---------- headers + values ----------
const HEADER_RULES = [
  ['date', /\b(date|day|when)\b/],
  ['unit', /^units?$/],
  ['sets', /\bsets?\b/],
  ['reps', /\b(reps?|repetitions|rep count)\b/],
  ['rpe', /\brpe\b/],
  ['weight', /\b(weight|load|lbs?|kgs?)\b/],
  ['exercise', /\b(exercise|lift|movement|name)\b/],
];

/** Header row -> { field: column index }. Throws when date, exercise or reps is missing. */
export function mapHeaders(header) {
  const out = {};
  header.forEach((h, i) => {
    const n = norm(h);
    const rule = HEADER_RULES.find(([field, re]) => out[field] === undefined && re.test(n));
    if (rule) out[rule[0]] = i;
  });
  if (out.date === undefined || out.exercise === undefined || out.reps === undefined) {
    throw new Error('The sheet needs columns for date, exercise and reps (sets, weight and unit are optional).');
  }
  return out;
}

const STRIP = new Set(['barbell', 'bb', 'dumbbell', 'dumbbells', 'db', 'back', 'standing', 'seated', 'walking', 'conventional', 'flat', 'strict']);
const ALIASES = {
  squat: 'squat',
  bench: 'bench', 'bench press': 'bench',
  deadlift: 'deadlift', 'dead lift': 'deadlift',
  ohp: 'shoulder_press', 'overhead press': 'shoulder_press', 'shoulder press': 'shoulder_press', 'military press': 'shoulder_press',
  'pull up': 'pull_up', pullup: 'pull_up', 'chin up': 'pull_up', chinup: 'pull_up',
  lunge: 'lunge',
};
const singular = (w) => (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Exercise name -> catalog id, or null when it is not a known name (never a fuzzy guess). */
export function matchExercise(name) {
  const words = norm(name).split(' ').filter(Boolean).map(singular);
  while (words.length > 1 && STRIP.has(words[0])) words.shift();
  return ALIASES[words.join(' ')] ?? null;
}

const pad = (n) => String(n).padStart(2, '0');
function isoDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 1990 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** ISO, US m/d/yyyy, or an Excel serial day number -> 'YYYY-MM-DD' (else null). */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return isoDate(+m[3], +m[1], +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return null;
}

const unitOf = (s) => (/^(kg|kgs|kilos?|kilograms?)$/.test(s) ? 'kg' : /^(lb|lbs|pounds?)$/.test(s) ? 'lb' : null);
const hash = (s) => [...s].reduce((h, c) => ((h * 33) ^ c.charCodeAt(0)) >>> 0, 5381).toString(36);

/** Rows (header first) -> { workouts, skipped[{line, reason, raw}], setCount, rowCount, summary }. */
export function importRows(rows, { unit = 'lb' } = {}) {
  if (!rows.length) throw new Error('The sheet is empty.');
  if (rows.length > MAX_ROWS + 1) throw new Error(`That sheet has more than ${MAX_ROWS} rows.`);
  const cols = mapHeaders(rows[0]);
  const headerUnit = cols.weight !== undefined ? unitOf(norm(rows[0][cols.weight]).split(' ').at(-1)) : null;
  const byDate = new Map();
  const skipped = [];
  let rowCount = 0;
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const get = (f) => (cols[f] === undefined ? '' : String(row[cols[f]] ?? '').trim());
    const skip = (reason) => skipped.push({ line, reason, raw: row.join(', ') });
    const exercise = matchExercise(get('exercise'));
    const date = parseDate(get('date'));
    if (!date) return skip('missing or unreadable date');
    if (!exercise) return skip(`unknown exercise "${get('exercise')}"`);
    const reps = Number(get('reps'));
    if (!/^\d+$/.test(get('reps')) || reps < 1 || reps > 1000) return skip('reps must be a whole number');
    const setsRaw = get('sets');
    const sets = setsRaw === '' ? 1 : Number(setsRaw);
    if (!/^\d+$/.test(setsRaw || '1') || sets < 1 || sets > MAX_SETS_PER_ROW) return skip(`sets must be 1-${MAX_SETS_PER_ROW}`);
    const w = norm(get('weight'));
    let weight = 0;
    let cellUnit = null;
    if (w && !/^(bw|body ?weight|bodyweight)$/.test(w)) {
      const raw = get('weight').replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/);
      if (!raw) return skip('weight is not a number');
      weight = Number(raw[1]);
      cellUnit = raw[2] ? unitOf(raw[2].toLowerCase()) : null;
    }
    if (!(weight >= 0 && weight <= 2000)) return skip('weight must be 0-2000');
    const rpeRaw = get('rpe');
    const rpe = rpeRaw === '' ? null : Number(rpeRaw);
    if (rpe !== null && !(rpe >= 1 && rpe <= 10)) return skip('rpe must be 1-10');
    const setUnit = unitOf(norm(get('unit'))) ?? cellUnit ?? headerUnit ?? unit;
    rowCount += 1;
    if (!byDate.has(date)) byDate.set(date, []);
    for (let k = 0; k < sets; k += 1) byDate.get(date).push({ exercise, reps, weight, unit: setUnit, rpe });
  });
  const workouts = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    const id = `import-${date}-${hash(JSON.stringify(list))}`;
    const at = `${date}T12:00:00.000Z`;
    return {
      id, name: 'Imported workout', startedAt: at, finishedAt: at, planned: null,
      sets: list.map((s, k) => ({ id: `${id}-${k}`, ...s, source: 'import', reps_detail: [], loggedAt: at, pr: false })),
    };
  });
  const setCount = workouts.reduce((n, w) => n + w.sets.length, 0);
  const summary = `${setCount} sets from ${rowCount} rows over ${workouts.length} days; ${skipped.length} rows skipped.`;
  return { workouts, skipped, setCount, rowCount, summary };
}

/** { name, bytes | text } -> importRows result. Throws a human message for unsupported files. */
export function parseWorkoutFile({ name = '', bytes, text }, opts = {}) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  let rows;
  if (ext === 'xlsx') rows = readXlsx(bytes);
  else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') rows = parseCSV(text ?? strFromU8(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  else throw new Error('Pick a CSV or Excel (.xlsx) file.');
  return importRows(rows, opts);
}

/** Workouts -> text accepted by AppState.importData (the existing export format). */
export const toExport = (workouts) => JSON.stringify({ format: 'jimbro-phone-export-v1', history: workouts });
