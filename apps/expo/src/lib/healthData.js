// Health history sources -> { daily: [{date, steps?, activeKcal?, exerciseMin?}], workouts: [{date, minutes, type}] }.
// Read-only, on-device. Nothing here uploads anything.
//
// Sources:
//  1. Apple Health export (Health app > profile > Export All Health Data -> export.zip; unzip in Files, pick export.xml).
//     The file can be gigabytes, so it is parsed as a stream: only <Record> / <Workout> start tags are looked at,
//     and only step count, active energy, exercise time and workouts are kept (summed per day).
//  2. A simple CSV: date,steps,active_kcal,exercise_min (works for Google Fit / Health Connect exports reshaped by hand).
//  3. Native HealthKit / Health Connect. These need native code, which Expo Go does not have. A development build can
//     pass a small module to registerNativeHealth(); until then the native source reports "unavailable" (no crash).

const TYPES = {
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'activeKcal',
  HKQuantityTypeIdentifierAppleExerciseTime: 'exerciseMin',
};
const ENERGY_TO_KCAL = { kcal: 1, Cal: 1, cal: 0.001, kJ: 1 / 4.184, J: 1 / 4184 };
const TIME_TO_MIN = { min: 1, s: 1 / 60, ms: 1 / 60000, hr: 60, h: 60, d: 1440 };

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};
const round1 = (n) => Math.round(n * 10) / 10;

/** Streaming parser: push(string chunk) any number of times, then result(). Keeps only a partial tag in memory. */
export function createHealthXmlParser() {
  const days = new Map();
  const workouts = [];
  let buf = '';

  const add = (date, key, v) => {
    const d = days.get(date) ?? {};
    d[key] = round1((d[key] ?? 0) + v);
    days.set(date, d);
  };

  const handle = (tag) => {
    if (tag.startsWith('Record ')) {
      const a = attrs(tag);
      const key = TYPES[a.type];
      const v = Number(a.value);
      if (!key || !a.startDate || !Number.isFinite(v) || v < 0) return;
      const factor = key === 'activeKcal' ? ENERGY_TO_KCAL[a.unit] : key === 'exerciseMin' ? TIME_TO_MIN[a.unit] ?? 1 : 1;
      if (factor === undefined) return;
      add(a.startDate.slice(0, 10), key, v * factor);
    } else if (tag.startsWith('Workout ')) {
      const a = attrs(tag);
      const minutes = Number(a.duration) * (TIME_TO_MIN[a.durationUnit] ?? 1);
      if (!a.startDate || !Number.isFinite(minutes) || minutes <= 0) return;
      workouts.push({ date: a.startDate.slice(0, 10), minutes: round1(minutes), type: (a.workoutActivityType ?? '').replace(/^HKWorkoutActivityType/, '') });
    }
  };

  return {
    push(chunk) {
      buf += chunk;
      let i = 0;
      for (;;) {
        const lt = buf.indexOf('<', i);
        if (lt < 0) { buf = ''; return; }
        const gt = buf.indexOf('>', lt);
        if (gt < 0) { buf = buf.slice(lt); return; }
        handle(buf.slice(lt + 1, gt));
        i = gt + 1;
      }
    },
    result() {
      const daily = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, ...d }));
      return { daily, workouts: [...workouts].sort((a, b) => (a.date < b.date ? -1 : 1)) };
    },
  };
}

export function parseHealthXml(text) {
  const p = createHealthXmlParser();
  p.push(text);
  return p.result();
}

/** Bytes -> string for the XML scanner. Tags we read are ASCII, so a byte-per-char decode is enough and needs no TextDecoder. */
export function bytesToAscii(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

/** CSV with a header containing date and any of steps, active_kcal, exercise_min. */
export function parseHealthCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { daily: [], workouts: [] };
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = { date: head.indexOf('date'), steps: head.indexOf('steps'), activeKcal: head.indexOf('active_kcal'), exerciseMin: head.indexOf('exercise_min') };
  if (col.date < 0) throw new Error('CSV needs a "date" column (YYYY-MM-DD).');
  const daily = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    const date = cells[col.date];
    if (!/^\d{4}-\d{2}-\d{2}/.test(date ?? '')) continue;
    const row = { date: date.slice(0, 10) };
    for (const k of ['steps', 'activeKcal', 'exerciseMin']) {
      const raw = col[k] >= 0 ? cells[col[k]] : '';
      const v = raw === '' || raw === undefined ? NaN : Number(raw);
      if (Number.isFinite(v) && v >= 0) row[k] = v;
    }
    if (Object.keys(row).length > 1) daily.push(row);
  }
  return { daily, workouts: [] };
}

const NEEDS_BUILD = 'Reading Apple Health or Health Connect directly needs a development build of JimBro (it does not work in Expo Go). You can import a health export file instead.';

/**
 * Wrap a native health module. Expected shape (implemented in a dev build with e.g. @kingstinct/react-native-healthkit
 * or react-native-health-connect): { requestRead(): Promise<boolean>, dailyTotals(days): Promise<daily[]>, workouts(days): Promise<workouts[]> }.
 * Only read permissions are ever requested.
 */
export function nativeHealthAdapter(mod) {
  const ok = !!mod && ['requestRead', 'dailyTotals', 'workouts'].every((k) => typeof mod[k] === 'function');
  return {
    available: ok,
    reason: ok ? null : NEEDS_BUILD,
    async read(days = 90) {
      if (!ok) throw new Error(NEEDS_BUILD);
      if (!(await mod.requestRead())) throw new Error('Health access was not allowed. Nothing was read.');
      const [daily, workouts] = await Promise.all([mod.dailyTotals(days), mod.workouts(days)]);
      return { daily: daily ?? [], workouts: workouts ?? [] };
    },
  };
}

let registered = null;
/** A development build calls this at startup with its native module. Expo Go never does. */
export const registerNativeHealth = (mod) => { registered = mod; };
export const nativeHealth = () => nativeHealthAdapter(registered);
