// Multi-week training programs (blocks -> weeks -> sessions -> items), generated on the phone.
// Original JimBro plans built from general programming principles: compound strength work plus
// hypertrophy accessories, balanced movement patterns, warm-ups, rest and effort (RPE) targets,
// rule-based progression, substitutions and planned deloads. No external program is copied.
// Loads come only from the user's logged sets; without history the plan says how to choose a
// weight by effort. It never invents weights, one-rep maxes or completed workouts, and never
// prescribes max testing.
import { canDo, exerciseInfo, exerciseName } from './exercises.js';
import { EXERCISE_MUSCLES } from './muscles.js';
import { substitutes } from './substitute.js';

export const PROGRAM_SCHEMA = 'jimbro.program.v1';
export const EQUIPMENT = ['barbell', 'dumbbells', 'bench', 'cable', 'machine', 'pullup_bar', 'dip_bars', 'kettlebell'];
const EQUIPMENT_LABEL = { barbell: 'Barbell + rack', dumbbells: 'Dumbbells', bench: 'Bench', cable: 'Cable station', machine: 'Machines', pullup_bar: 'Pull-up bar', dip_bars: 'Dip bars', kettlebell: 'Kettlebell' };
export const GOALS = { powerbuilding: 'Strength + size (powerbuilding)', strength: 'Get stronger', muscle: 'Build muscle', general: 'General fitness', endurance: 'Muscular endurance', fat_loss: 'Fat-loss support' };
export const EXPERIENCE = { new: 'New to lifting', returning: 'Coming back after a break', experienced: 'Training regularly (1+ year)' };
const PATTERNS = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'dip', 'horizontal_pull', 'vertical_pull', 'elbow_flexion', 'elbow_extension', 'shoulder_abduction'];
const AREAS = { knees: ['squat', 'lunge'], lower_back: ['hinge'], shoulders: ['vertical_push', 'dip'] };
const LIMITS = { days: [2, 5], minutes: [30, 120], weeks: [4, 16] };
const MAX_WEEKLY_SETS_PER_MUSCLE = 20;

export const INTAKE_FIELDS = [
  { id: 'goal', question: 'What is the main goal for this block?', options: Object.entries(GOALS) },
  { id: 'experience', question: 'How much lifting experience do you have?', options: Object.entries(EXPERIENCE) },
  { id: 'daysPerWeek', question: 'How many days a week can you train? Four days gives the upper/lower powerbuilding split.', options: [[2, '2 days'], [3, '3 days'], [4, '4 days'], [5, '5 days']] },
  { id: 'minutes', question: 'How long can each session be, including the warm-up?', options: [[30, '30 min'], [45, '45 min'], [60, '60 min'], [75, '75 min'], [90, '90 min']] },
  { id: 'equipment', multi: true, question: 'What equipment do you have? Pick all that apply.', options: [['full_gym', 'Full gym'], ...EQUIPMENT.map((e) => [e, EQUIPMENT_LABEL[e]]), ['none', 'Bodyweight only']] },
  { id: 'avoid', multi: true, question: 'Anything to work around? I will leave those movements out. (Not medical advice: for pain, see a professional.)', options: [['none', 'Nothing'], ['knees', 'Knees'], ['lower_back', 'Lower back'], ['shoulders', 'Shoulders overhead']] },
  { id: 'weeks', question: 'How long should the block be? Ten weeks is a good default.', options: [[6, '6 weeks'], [8, '8 weeks'], [10, '10 weeks (suggested)'], [12, '12 weeks']] },
];

// ---------- parsing ----------
const WORD_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const num = (s) => {
  const m = /(\d+)/.exec(s);
  if (m) return Number(m[1]);
  const w = Object.keys(WORD_NUM).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(s));
  return w ? WORD_NUM[w] : null;
};
function parseGoal(s) {
  if (/power ?building|strength (and|\+|&) (size|muscle)|size (and|\+|&) strength|\bboth\b/i.test(s)) return 'powerbuilding';
  if (/fat|lean|weight loss|lose weight|\bcut\b/i.test(s)) return 'fat_loss';
  if (/endurance|stamina|conditioning/i.test(s)) return 'endurance';
  if (/muscle|size|hypertroph|bigger|bulk/i.test(s)) return 'muscle';
  if (/strong|strength/i.test(s)) return 'strength';
  if (/general|fitness|health|overall|in shape/i.test(s)) return 'general';
  return null;
}
function parseExperience(s) {
  if (/\bnew\b|beginner|never|first time|novice|just start/i.test(s)) return 'new';
  if (/back|return|break|again|used to|comeback/i.test(s)) return 'returning';
  if (/regular|experienced|years?|advanced|intermediate|consistent|a while/i.test(s)) return 'experienced';
  return null;
}
function parseEquipment(s) {
  if (/full gym|commercial gym|everything|whole gym|all of it/i.test(s)) return [...EQUIPMENT];
  const found = [];
  const add = (id, re) => { if (re.test(s)) found.push(id); };
  add('barbell', /barbell|squat rack|power rack/i);
  add('dumbbells', /dumbbell|\bdbs?\b/i);
  add('bench', /bench/i);
  add('cable', /cable/i);
  add('machine', /machine/i);
  add('pullup_bar', /(pull|chin)[- ]?up bar|pullup bar/i);
  add('dip_bars', /\bdip/i);
  add('kettlebell', /kettlebell/i);
  if (found.length) return found;
  if (/nothing|no equipment|bodyweight|body weight|\bnone\b/i.test(s)) return [];
  return null;
}
function parseAvoid(s) {
  const out = [];
  if (/knee/i.test(s)) out.push(...AREAS.knees);
  if (/back/i.test(s)) out.push(...AREAS.lower_back);
  if (/shoulder/i.test(s)) out.push(...AREAS.shoulders);
  if (out.length) return out;
  if (/\b(none|nothing|no|nope|all good|fine|healthy)\b/i.test(s)) return [];
  return null;
}
const chipValues = (field, value) => {
  const list = Array.isArray(value) ? value : [value];
  if (field === 'equipment') return list.includes('full_gym') ? [...EQUIPMENT] : list.filter((x) => x !== 'none');
  return [...new Set(list.flatMap((x) => AREAS[x] ?? []))];
};

const ERRORS = {
  goal: `Pick a goal: ${Object.values(GOALS).join(', ')}.`,
  experience: 'Tell me if you are new, coming back after a break, or training regularly.',
  daysPerWeek: `Pick ${LIMITS.days[0]} to ${LIMITS.days[1]} days a week.`,
  minutes: `Pick ${LIMITS.minutes[0]} to ${LIMITS.minutes[1]} minutes per session.`,
  equipment: 'Tell me what you have (for example "dumbbells and a bench", "full gym" or "bodyweight only").',
  avoid: 'Tell me which area (knees, lower back, shoulders), or say "none".',
  weeks: `Pick ${LIMITS.weeks[0]} to ${LIMITS.weeks[1]} weeks.`,
};
const inRange = (n, [lo, hi]) => Number.isInteger(n) && n >= lo && n <= hi;

/** Apply one answer (typed text or a chip value). Returns { ok, intake } or { ok: false, error }. */
export function answerIntake(intake, field, input) {
  let value;
  const text = typeof input === 'string' ? input : null;
  if (field === 'goal') value = text != null ? parseGoal(text) : GOALS[input] ? input : null;
  else if (field === 'experience') value = text != null ? parseExperience(text) : EXPERIENCE[input] ? input : null;
  else if (field === 'equipment' || field === 'avoid') value = text != null ? (field === 'equipment' ? parseEquipment(text) : parseAvoid(text)) : chipValues(field, input);
  else if (field === 'minutes') {
    const n = text != null ? (/(\d+(\.\d+)?)\s*(h|hour)/i.test(text) ? Math.round(Number(/(\d+(\.\d+)?)/.exec(text)[1]) * 60) : num(text)) : input;
    value = inRange(n, LIMITS.minutes) ? n : null;
  } else if (field === 'daysPerWeek' || field === 'weeks') {
    const n = text != null ? num(text) : input;
    value = inRange(n, field === 'weeks' ? LIMITS.weeks : LIMITS.days) ? n : null;
  } else return { ok: false, error: 'Unknown question.' };
  if (value == null) return { ok: false, error: ERRORS[field] };
  return { ok: true, intake: { ...intake, [field]: value } };
}

const REQUEST = /\b(program|programme|training block|mesocycle|powerbuilding)\b|\b\d+[- ]?weeks?\b.*\b(plan|block|routine)\b/i;
/** "Build me a 10-week 4-day powerbuilding program" -> { recognized, intake: details given }. */
export function parseProgramRequest(text = '') {
  if (!REQUEST.test(text) || !/\b(build|make|create|design|write|give|plan|start|new|want|need|generate)\b/i.test(text)) return { recognized: false, intake: {} };
  const intake = {};
  const weeks = /(\d+)[- ]?weeks?\b/i.exec(text);
  if (weeks && inRange(Number(weeks[1]), LIMITS.weeks)) intake.weeks = Number(weeks[1]);
  const days = /(\d)[- ]?(days?|x)\b/i.exec(text);
  if (days && inRange(Number(days[1]), LIMITS.days)) intake.daysPerWeek = Number(days[1]);
  const minutes = /(\d{2,3})[- ]?(min|minutes?)\b/i.exec(text);
  if (minutes && inRange(Number(minutes[1]), LIMITS.minutes)) intake.minutes = Number(minutes[1]);
  const goal = parseGoal(text);
  if (goal) intake.goal = goal;
  const equipment = parseEquipment(text.replace(/\bbody ?weight\b/i, ''));
  if (equipment?.length) intake.equipment = equipment;
  return { recognized: true, intake };
}

/** Fill in what the app already knows (saved experience, equipment, limitations). */
export function prefillIntake(parsed = {}, settings = {}) {
  const out = { ...parsed };
  if (out.experience === undefined && EXPERIENCE[settings.experience]) out.experience = settings.experience;
  const equipment = settings.profile?.equipment ?? settings.equipment;
  if (out.equipment === undefined && Array.isArray(equipment)) out.equipment = equipment.filter((e) => EQUIPMENT.includes(e));
  const avoid = settings.profile?.avoid;
  if (out.avoid === undefined && Array.isArray(avoid)) out.avoid = avoid.filter((p) => PATTERNS.includes(p));
  return out;
}

/** The next question to ask, or null when the intake is complete. */
export function nextQuestion(intake = {}) {
  return INTAKE_FIELDS.find((f) => intake[f.id] === undefined) ?? null;
}

export function validateIntake(i = {}) {
  const p = [];
  if (!GOALS[i.goal]) p.push('goal: choose one of the listed goals');
  if (!EXPERIENCE[i.experience]) p.push('experience: new, returning or experienced');
  if (!inRange(i.daysPerWeek, LIMITS.days)) p.push(`days per week must be ${LIMITS.days[0]} to ${LIMITS.days[1]}`);
  if (!inRange(i.minutes, LIMITS.minutes)) p.push(`minutes per session must be ${LIMITS.minutes[0]} to ${LIMITS.minutes[1]}`);
  if (!inRange(i.weeks, LIMITS.weeks)) p.push(`program length must be ${LIMITS.weeks[0]} to ${LIMITS.weeks[1]} weeks`);
  if (!Array.isArray(i.equipment) || i.equipment.some((e) => !EQUIPMENT.includes(e))) p.push('equipment: unknown equipment');
  if (i.avoid !== undefined && (!Array.isArray(i.avoid) || i.avoid.some((x) => !PATTERNS.includes(x)))) p.push('limitations: unknown movement pattern');
  return p;
}

// ---------- templates ----------
// Slot -> exercise candidates in order of preference (the first one the user can safely do wins).
const SLOTS = {
  press_h: ['bench', 'dumbbell_bench', 'push_up'],
  press_v: ['shoulder_press'],
  row: ['bent_over_row', 'seated_cable_row'],
  vpull: ['pull_up', 'chin_up', 'lat_pulldown'],
  triceps: ['tricep_pushdown', 'dips', 'push_up'],
  squat: ['squat', 'goblet_squat'],
  squat_light: ['goblet_squat', 'squat'],
  hinge: ['deadlift', 'romanian_deadlift'],
  hinge_light: ['romanian_deadlift'],
  lunge: ['lunge'],
  chest_acc: ['dumbbell_bench', 'dips', 'push_up'],
  lateral: ['lateral_raise'],
  biceps: ['curl', 'hammer_curl'],
};
const SLOT_WHY = {
  press_h: 'Horizontal press for chest, shoulders and triceps.',
  press_v: 'Overhead press for shoulders and triceps.',
  row: 'Horizontal pull to balance the pressing and train the upper back.',
  vpull: 'Vertical pull for the lats and biceps.',
  triceps: 'Triceps work to support pressing strength.',
  squat: 'Squat pattern for quads and glutes.',
  squat_light: 'Extra squat-pattern volume for the legs.',
  hinge: 'Hip hinge for hamstrings, glutes and back strength.',
  hinge_light: 'Lighter hip hinge for hamstring and glute volume.',
  lunge: 'Single-leg work for balance and leg muscle.',
  chest_acc: 'Chest volume with a different angle from the main press.',
  lateral: 'Side-shoulder volume, hard to train with presses alone.',
  biceps: 'Direct biceps work.',
};
const ROLE_WHY = {
  main: 'Main lift of the day: the compound movement you progress most carefully.',
  secondary: 'Secondary compound: moderate reps for strength and size.',
  accessory: 'Accessory: higher reps for muscle with less joint stress.',
};
const SESSIONS = {
  upperStrength: { name: 'Upper strength', focus: 'Heavy pressing and rowing', slots: [['press_h', 'main'], ['row', 'secondary'], ['press_v', 'secondary'], ['vpull', 'secondary'], ['triceps', 'accessory']] },
  lowerStrength: { name: 'Lower strength', focus: 'Heavy squats plus hinge support', slots: [['squat', 'main'], ['hinge_light', 'secondary'], ['lunge', 'accessory'], ['squat_light', 'accessory']] },
  upperSize: { name: 'Upper hypertrophy', focus: 'Shoulders, back and arms volume', slots: [['press_v', 'secondary'], ['vpull', 'secondary'], ['chest_acc', 'accessory'], ['lateral', 'accessory'], ['biceps', 'accessory'], ['triceps', 'accessory']] },
  lowerSize: { name: 'Lower hypertrophy + deadlift', focus: 'Hinge strength and leg volume', slots: [['hinge', 'main'], ['squat_light', 'secondary'], ['lunge', 'accessory'], ['hinge_light', 'accessory']] },
  armsShoulders: { name: 'Arms & shoulders', focus: 'Extra upper-body volume', slots: [['row', 'secondary'], ['chest_acc', 'accessory'], ['lateral', 'accessory'], ['biceps', 'accessory'], ['triceps', 'accessory']] },
  fullA: { name: 'Full body A', focus: 'Squat and horizontal press', slots: [['squat', 'main'], ['press_h', 'main'], ['row', 'accessory'], ['lateral', 'accessory'], ['biceps', 'accessory']] },
  fullB: { name: 'Full body B', focus: 'Hinge and overhead press', slots: [['hinge', 'main'], ['press_v', 'main'], ['vpull', 'accessory'], ['lunge', 'accessory'], ['triceps', 'accessory']] },
  fullC: { name: 'Full body C', focus: 'Moderate-rep volume', slots: [['squat_light', 'secondary'], ['chest_acc', 'secondary'], ['row', 'accessory'], ['hinge_light', 'accessory'], ['biceps', 'accessory']] },
};
const FILL = ['squat', 'push_up', 'lunge', 'goblet_squat', 'dumbbell_bench', 'bent_over_row', 'romanian_deadlift', 'chin_up', 'lat_pulldown'];
const MIN_ITEMS = 3;
const SPLITS = { 2: ['fullA', 'fullB'], 3: ['fullA', 'fullB', 'fullC'], 4: ['upperStrength', 'lowerStrength', 'upperSize', 'lowerSize'], 5: ['upperStrength', 'lowerStrength', 'upperSize', 'lowerSize', 'armsShoulders'] };
// [sets, reps low, reps high, RPE low, RPE high, rest seconds]
const SCHEME = {
  powerbuilding: { main: [4, 3, 5, 7, 8.5, 180], secondary: [3, 6, 8, 7, 8.5, 150], accessory: [3, 10, 15, 7, 9, 75] },
  strength: { main: [5, 3, 5, 7, 8.5, 180], secondary: [3, 5, 8, 7, 8.5, 150], accessory: [2, 8, 12, 7, 8.5, 90] },
  muscle: { main: [3, 6, 10, 7, 8.5, 150], secondary: [3, 8, 12, 7, 9, 120], accessory: [3, 10, 15, 7.5, 9, 75] },
  general: { main: [3, 5, 8, 6.5, 8, 150], secondary: [3, 8, 12, 6.5, 8, 90], accessory: [2, 10, 15, 6.5, 8, 60] },
  fat_loss: { main: [3, 6, 10, 6.5, 8, 120], secondary: [3, 8, 12, 6.5, 8, 75], accessory: [2, 12, 15, 6.5, 8, 45] },
  endurance: { main: [3, 8, 12, 6, 7.5, 90], secondary: [2, 12, 15, 6, 7.5, 60], accessory: [2, 15, 20, 6, 8, 45] },
};
const WORK_MIN_PER_SET = 0.75;
const TRANSITION_MIN = 1;
const warmupMinutes = (limit) => (limit >= 45 ? 8 : 6);

export const sessionMinutes = (items, limit = 60) =>
  Math.round((warmupMinutes(limit) + items.reduce((t, i) => t + i.sets * (WORK_MIN_PER_SET + i.rest_sec / 60) + TRANSITION_MIN, 0)) * 10) / 10;

const isBeginner = (i) => i.experience !== 'experienced';
const maxLevel = (i) => (isBeginner(i) ? 2 : 3);
const LOWER = new Set(['squat', 'hinge', 'lunge']);
const BODYWEIGHT = new Set(['push_up', 'pull_up', 'chin_up', 'dips']);
const isBodyweight = (id) => BODYWEIGHT.has(id) || exerciseInfo(id).needs.every((g) => g.includes('bodyweight'));

function allowed(id, intake) {
  const info = exerciseInfo(id);
  return Boolean(info) && canDo(id, intake.equipment) && !(intake.avoid ?? []).includes(info.pattern) && info.level <= maxLevel(intake);
}

/** Library exercises this intake can use (equipment, limitations, experience). */
export const allowedFor = (id, intake) => allowed(id, intake);

/** Substitution options for an exercise within the program's constraints. */
export function programSubstitutes(exercise, intake) {
  return substitutes(exercise, { equipment: intake.equipment, avoid: intake.avoid ?? [], level: maxLevel(intake) - 1 }).options.filter((o) => allowed(o.exercise, intake));
}

function latestSet(history, exercise) {
  let best = null;
  for (const w of history ?? []) for (const s of w.sets ?? []) {
    if (s.exercise !== exercise || !(s.reps > 0)) continue;
    if (!isBodyweight(exercise) && !(s.weight > 0)) continue;
    if (!best || String(s.loggedAt ?? w.startedAt ?? '') >= String(best.loggedAt ?? '')) best = { ...s, loggedAt: s.loggedAt ?? w.startedAt };
  }
  return best;
}

function firstLoad(exercise, history, rpeHigh) {
  const name = exerciseName(exercise).toLowerCase();
  const last = latestSet(history, exercise);
  if (last && last.weight > 0) {
    const effort = last.rpe != null ? ` at RPE ${last.rpe}` : '';
    const advice = last.rpe == null
      ? ' Start there and rate the first set (RPE) so Jim can adjust.'
      : last.rpe <= rpeHigh - 1.5 ? ' Start there; add the smallest step if the first set feels easy.' : ' Start there.';
    return { text: `Last logged: ${last.reps} × ${last.weight} ${last.unit}${effort}.${advice}`, from: { setId: last.id, weight: last.weight, unit: last.unit, reps: last.reps, rpe: last.rpe ?? null } };
  }
  if (isBodyweight(exercise)) return { text: 'Bodyweight: stop each set with about 2–3 good reps left in the tank.', from: null };
  return { text: `No ${name} history yet: ramp up with warm-up sets, then use a weight you could lift 2–3 more times at the end of the set (about RPE 7). No max testing needed.`, from: null };
}

function fit(items, limit) {
  const over = () => sessionMinutes(items, limit) > limit;
  const isPull = (x) => PULLS.includes(exerciseInfo(x.exercise).pattern);
  // Drop the last item of a role; on the first pass, keep the session's only pull for balance.
  const drop = (role, keepPull) => {
    const pulls = items.filter(isPull).length;
    const i = items.findLastIndex((x, k) => k > 0 && x.role === role && !(keepPull && isPull(x) && pulls <= 1));
    if (i < 0) return false;
    items.splice(i, 1);
    return true;
  };
  const steps = [
    () => { const i = items.findLastIndex((x) => x.role === 'accessory' && x.sets > 2); if (i < 0) return false; items[i].sets -= 1; return true; },
    () => { const i = items.findLastIndex((x) => x.role === 'secondary' && x.sets > 2); if (i < 0) return false; items[i].sets -= 1; return true; },
    () => drop('accessory', true), () => drop('secondary', true),
    () => { const i = items.findLastIndex((x) => x.sets > 2); if (i < 0) return false; items[i].sets -= 1; return true; },
    () => drop('accessory', false), () => drop('secondary', false),
  ];
  for (const step of steps) while (over() && step());
  return items;
}

function baseItems(key, intake) {
  const scheme = SCHEME[intake.goal];
  const used = new Set();
  const items = [];
  for (const [slot, role] of SESSIONS[key].slots) {
    const id = SLOTS[slot].find((x) => !used.has(x) && allowed(x, intake));
    if (!id) continue;
    used.add(id);
    let [sets, lo, hi, rpeLo, rpeHi, rest] = scheme[role];
    if (isBeginner(intake)) {
      sets = Math.min(sets, role === 'accessory' ? 2 : 3);
      lo = Math.max(lo, 5);
      hi = Math.max(hi, lo + 3);
      rpeLo = Math.min(rpeLo, 6);
      rpeHi = Math.min(rpeHi, 7.5);
    }
    const why = `${ROLE_WHY[role]} ${SLOT_WHY[slot]}${id !== SLOTS[slot][0] ? ` Chosen instead of ${exerciseName(SLOTS[slot][0]).toLowerCase()} to fit your equipment, experience or limitations.` : ''}`;
    const subs = substitutes(id, { equipment: intake.equipment, avoid: intake.avoid ?? [], level: maxLevel(intake) - 1 }).options
      .map((o) => o.exercise).filter((x) => allowed(x, intake)).slice(0, 2);
    items.push({ exercise: id, role, slot, sets, reps_low: lo, reps_high: hi, base_rpe: [rpeLo, rpeHi], rest_sec: rest, why, substitutes: subs, ...(id === 'lunge' ? { per_side: true } : {}) });
  }
  // Thin sessions (little equipment or many limitations): top up with safe basics.
  for (const id of FILL) {
    if (items.length >= MIN_ITEMS) break;
    if (used.has(id) || !allowed(id, intake)) continue;
    used.add(id);
    const [sets, lo, hi, rpeLo, rpeHi, rest] = SCHEME[intake.goal].accessory;
    const beginner = isBeginner(intake);
    items.push({ exercise: id, role: 'accessory', slot: 'fill', sets: beginner ? Math.min(sets, 2) : sets, reps_low: Math.max(lo, beginner ? 5 : lo), reps_high: hi, base_rpe: [beginner ? Math.min(rpeLo, 6) : rpeLo, beginner ? Math.min(rpeHi, 7.5) : rpeHi], rest_sec: rest,
      why: `${ROLE_WHY.accessory} Added so this day still trains several muscle groups with your equipment.`,
      substitutes: substitutes(id, { equipment: intake.equipment, avoid: intake.avoid ?? [], level: maxLevel(intake) - 1 }).options.map((o) => o.exercise).filter((x) => allowed(x, intake)).slice(0, 2),
      ...(id === 'lunge' ? { per_side: true } : {}) });
  }
  return fit(items, intake.minutes);
}

const round = (x) => Math.round(x * 2) / 2;

function warmup(items) {
  const first = items[0] ? exerciseName(items[0].exercise).toLowerCase() : 'your first exercise';
  return items[0]?.role !== 'accessory'
    ? ['5 minutes of easy cardio or brisk walking.', `Ramp up on ${first}: 2–4 lighter sets (about 40%, 60% and 80% of today's working weight), fewer reps each time.`, 'Later exercises: one lighter feeler set if you need it.']
    : ['5 minutes of easy cardio or brisk walking.', `1–2 lighter sets of ${first} before your working sets.`];
}

function weekItems(base, week, deload, history, intake) {
  const k = (week - 1) % 4; // position in the 3-week build wave
  const bump = !deload && k === 2 && !isBeginner(intake);
  const make = (withBump) => base.map((b) => {
    const [lo, hi] = b.base_rpe;
    const rpe_low = deload ? 5 : Math.min(hi, round(lo + 0.5 * k));
    const rpe_high = deload ? 6 : Math.min(hi, round(lo + 1 + 0.5 * k));
    const sets = deload ? Math.max(1, Math.round(b.sets * 0.6)) : b.sets + (withBump && b.role === 'accessory' ? 1 : 0);
    const load = week === 1
      ? firstLoad(b.exercise, history, rpe_high)
      : deload ? { text: "Deload: about 90% of last week's working weight (or easy bodyweight reps).", from: null }
        : { text: "Progress from last week's result using the progression rules.", from: null };
    const { base_rpe, ...item } = b; // eslint-disable-line no-unused-vars
    return { ...item, sets, rpe_low, rpe_high, load };
  });
  const bumped = make(bump);
  return bump && sessionMinutes(bumped, intake.minutes) > intake.minutes ? make(false) : bumped;
}

// Keep weekly hard sets per muscle under the cap by trimming accessory sets that train it most.
function capVolume(sessions, limit) {
  for (let guard = 0; guard < 200; guard += 1) {
    const over = Object.entries(weeklySets({ sessions })).filter(([, n]) => n > MAX_WEEKLY_SETS_PER_MUSCLE).map(([m]) => m);
    if (!over.length) break;
    const candidates = sessions.flatMap((s) => s.items.map((i) => ({ s, i }))).filter(({ i }) => i.role !== 'main' && i.sets > 1 && over.includes((EXERCISE_MUSCLES[i.exercise] ?? [])[0]));
    const pick = candidates.find(({ i }) => i.role === 'accessory') ?? candidates[0];
    if (!pick) break;
    pick.i.sets -= 1;
    pick.s.estimated_minutes = sessionMinutes(pick.s.items, limit);
  }
}

const TEMPLATE_NAME = (i) => (i.daysPerWeek >= 4
  ? (i.goal === 'powerbuilding' ? 'powerbuilding' : `upper/lower ${GOALS[i.goal].toLowerCase()}`)
  : `full-body ${GOALS[i.goal].toLowerCase()}`);

/** Build a validated program. Throws on an invalid intake instead of guessing. */
export function buildProgram(intake, { history = [], unit = 'lb', id = `program-${Date.now().toString(36)}`, now = new Date().toISOString(), version = 1 } = {}) {
  const problems = validateIntake(intake);
  if (problems.length) throw new Error(problems.join('; '));
  const clean = { goal: intake.goal, experience: intake.experience, daysPerWeek: intake.daysPerWeek, minutes: intake.minutes, equipment: [...intake.equipment], avoid: [...(intake.avoid ?? [])], weeks: intake.weeks };
  const split = SPLITS[clean.daysPerWeek];
  const bases = split.map((key) => ({ key, items: baseItems(key, clean) }));
  const weeks = [];
  for (let w = 1; w <= clean.weeks; w += 1) {
    const deload = w % 4 === 0 || (w === clean.weeks && clean.weeks >= 6);
    const sessions = bases.map(({ key, items }, d) => {
      const list = weekItems(items, w, deload, history, clean);
      return { day: d + 1, name: SESSIONS[key].name, focus: SESSIONS[key].focus, warmup: warmup(list), items: list, estimated_minutes: sessionMinutes(list, clean.minutes) };
    });
    capVolume(sessions, clean.minutes);
    const main = sessions[0].items[0];
    const note = deload
      ? (w === clean.weeks ? 'Final week: deload. No max test needed; compare this block with your week 1 sets in Progress.' : 'Deload: fewer sets and easier effort so you recover and keep progressing.')
      : `Build week ${((w - 1) % 4) + 1} of 3: main lifts at RPE ${main?.rpe_low ?? 6}–${main?.rpe_high ?? 8}.`;
    weeks.push({ week: w, deload, phase: deload ? 'deload' : 'build', note, sessions });
  }
  const step = unit === 'kg' ? ['1–2.5 kg', '2.5–5 kg'] : ['5 lb', '5–10 lb'];
  return {
    schema: PROGRAM_SCHEMA, id, version, createdAt: now,
    name: `${clean.weeks}-week ${TEMPLATE_NAME(clean)} block (${clean.daysPerWeek} days)`,
    intake: clean,
    weeks,
    progression: {
      increase: `Every set reaches the top of the rep range at or below the target RPE: add the smallest step next session (about ${step[0]} upper body, ${step[1]} lower body).`,
      hold: 'Reps inside the range at the target RPE: keep the weight and aim for one more rep per set.',
      reduce: 'Below the bottom of the range, RPE above 9 on a set meant to be easier, or reps slowing down a lot on camera: reduce the weight 5–10% next session.',
      stop: 'Sharp or unusual pain (not normal effort): stop that exercise, use a listed substitution and get it checked if it persists.',
    },
    deload: 'Every 4th week and the final week: about 60% of the sets at RPE 5–6 with about 90% of your working weights.',
    principles: ['Compound strength lifts first, hypertrophy accessories after.', 'Push, pull, squat and hinge every week where your equipment and limitations allow.', 'Effort (RPE) targets instead of guessed weights.', 'Planned deloads; no max testing.'],
    notes: ['Original JimBro plan built from general training principles. Not medical advice.', 'Starting loads come only from your logged sets. Rate your sets (RPE) so Jim can progress you.'],
    changes: [],
  };
}

// ---------- validation ----------
/** Hard sets per muscle in a week: the first-listed muscle counts 1, others 0.5. */
export function weeklySets(week) {
  const out = {};
  for (const s of week.sessions) for (const i of s.items) {
    (EXERCISE_MUSCLES[i.exercise] ?? []).forEach((m, k) => { out[m] = (out[m] ?? 0) + i.sets * (k === 0 ? 1 : 0.5); });
  }
  return out;
}
const totalSets = (week) => week.sessions.reduce((t, s) => t + s.items.reduce((a, i) => a + i.sets, 0), 0);
const PULLS = ['horizontal_pull', 'vertical_pull'];

/** Problems with a program (empty = valid). Pass the intake it was built for and, to check loads, history. */
export function validateProgram(program, intake = program?.intake, { history } = {}) {
  const p = [];
  if (!program || program.schema !== PROGRAM_SCHEMA || !Array.isArray(program.weeks)) return ['not a JimBro program'];
  p.push(...validateIntake(intake));
  if (p.length) return p;
  if (program.weeks.length !== intake.weeks) p.push(`expected ${intake.weeks} weeks, got ${program.weeks.length}`);
  const setIndex = history ? new Map(history.flatMap((w) => (w.sets ?? []).map((s) => [s.id, s]))) : null;
  const pullPossible = Object.values(SLOTS).flat().some((id) => PULLS.includes(exerciseInfo(id).pattern) && allowed(id, intake));
  program.weeks.forEach((week, wi) => {
    if (week.sessions?.length !== intake.daysPerWeek) p.push(`week ${week.week}: expected ${intake.daysPerWeek} sessions`);
    for (const s of week.sessions ?? []) {
      const at = `week ${week.week} day ${s.day}`;
      if (!s.name || !s.focus || !s.warmup?.length || !s.items?.length) p.push(`${at}: missing name, focus, warm-up or exercises`);
      if (!(s.estimated_minutes <= intake.minutes)) p.push(`${at}: needs ${s.estimated_minutes} minutes (limit ${intake.minutes})`);
      for (const i of s.items ?? []) {
        const info = exerciseInfo(i.exercise);
        if (!info) { p.push(`${at}: unknown exercise "${i.exercise}"`); continue; }
        const name = `${at} ${info.name}`;
        if (!canDo(i.exercise, intake.equipment)) p.push(`${name}: needs equipment you don't have`);
        if ((intake.avoid ?? []).includes(info.pattern)) p.push(`${name}: a movement you asked to avoid`);
        if (info.level > maxLevel(intake)) p.push(`${name}: too advanced for this experience level`);
        if (!(Number.isInteger(i.sets) && i.sets >= 1 && i.sets <= 6)) p.push(`${name}: sets must be 1–6`);
        if (!(Number.isInteger(i.reps_low) && i.reps_low >= 1 && i.reps_high <= 30 && i.reps_low <= i.reps_high)) p.push(`${name}: reps must be 1–30, low ≤ high`);
        if (!(i.rpe_low >= 5 && i.rpe_high <= 10 && i.rpe_low <= i.rpe_high)) p.push(`${name}: effort (RPE) must be 5–10`);
        if (isBeginner(intake) && (i.rpe_high > 7.5 || i.reps_low < 5)) p.push(`${name}: too heavy for a beginner block`);
        if (!(i.rest_sec >= 30 && i.rest_sec <= 300)) p.push(`${name}: rest must be 30–300 s`);
        if (!i.why || !i.load?.text) p.push(`${name}: missing reason or load guidance`);
        for (const x of i.substitutes ?? []) if (!exerciseInfo(x) || !allowed(x, intake) || x === i.exercise) p.push(`${name}: invalid substitution "${x}"`);
        if (i.load?.from && setIndex) {
          const s0 = setIndex.get(i.load.from.setId);
          if (!s0 || s0.exercise !== i.exercise || s0.weight !== i.load.from.weight || s0.unit !== i.load.from.unit) p.push(`${name}: starting load is not backed by your history`);
        }
      }
    }
    for (const [m, n] of Object.entries(weeklySets(week))) if (n > MAX_WEEKLY_SETS_PER_MUSCLE) p.push(`week ${week.week}: ${n} weekly sets for ${m} (max ${MAX_WEEKLY_SETS_PER_MUSCLE})`);
    if (!week.deload && pullPossible && !week.sessions.some((s) => s.items.some((i) => PULLS.includes(exerciseInfo(i.exercise)?.pattern)))) p.push(`week ${week.week}: no pulling work to balance the pressing`);
    if (week.deload && wi > 0) {
      if (totalSets(week) >= totalSets(program.weeks[wi - 1])) p.push(`week ${week.week}: deload has no less volume than the week before`);
      if (week.sessions.some((s) => s.items.some((i) => i.rpe_high > 6))) p.push(`week ${week.week}: deload effort above RPE 6`);
    }
  });
  return p;
}

// ---------- using a saved program ----------
const toDay = (s) => ({ day: s.day, name: s.name, focus: s.focus, estimated_minutes: s.estimated_minutes, items: s.items.map((i) => ({ exercise: i.exercise, sets: i.sets, reps_low: i.reps_low, reps_high: i.reps_high, rest_min: i.rest_sec / 60, rpe_low: i.rpe_low, rpe_high: i.rpe_high })) });

/** The stored plan: week 1 as `days` (what existing screens read) plus the whole program. */
export function programToPlan(program) {
  return { goal: program.intake.goal, name: program.name, days: program.weeks[0].sessions.map(toDay), program, request: { program: program.id, version: program.version } };
}

/** Where the user is in the block, counted from completed workouts started from this program. */
export function programNext(program, history = []) {
  const perWeek = program.intake.daysPerWeek;
  const done = history.filter((w) => w.planned?.programId === program.id).length;
  if (done >= program.weeks.length * perWeek) return { done: true, week: program.weeks.length, day: perWeek, name: 'Block complete', planned: null, session: null };
  const week = Math.floor(done / perWeek) + 1;
  const session = program.weeks[week - 1].sessions[done % perWeek];
  return {
    done: false, week, day: session.day, session, deload: program.weeks[week - 1].deload,
    name: `Week ${week} · Day ${session.day} · ${session.name}`,
    planned: { ...toDay(session), programId: program.id, programVersion: program.version, week },
  };
}

/** What a started workout carries for a program session (so the block position advances). */
export const sessionPlanned = (program, session, week) => ({ ...toDay(session), programId: program.id, programVersion: program.version, week });

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Replace one exercise from a week onward. Returns { program } (new version) or { error }. */
export function swapExercise(program, { from, to, fromWeek = 1 }, intake = program.intake) {
  const info = exerciseInfo(to);
  if (!info) return { error: `"${to}" is not in the exercise library.` };
  if (!allowed(to, intake)) return { error: `${info.name} doesn't fit your equipment, experience or limitations.` };
  const next = clone(program);
  let count = 0;
  for (const week of next.weeks.slice(Math.max(0, fromWeek - 1))) for (const s of week.sessions) {
    if (s.items.some((i) => i.exercise === to)) continue; // never two of the same lift in one session
    for (const i of s.items) {
      if (i.exercise !== from) continue;
      i.exercise = to;
      i.why = `Swapped in for ${exerciseName(from).toLowerCase()} at your request. ${SLOT_WHY[i.slot] ?? ''}`.trim();
      i.substitutes = substitutes(to, { equipment: intake.equipment, avoid: intake.avoid ?? [], level: maxLevel(intake) - 1 }).options.map((o) => o.exercise).filter((x) => allowed(x, intake)).slice(0, 2);
      if (week.week === fromWeek || i.load?.from) i.load = { text: `New exercise: loads don't carry over from ${exerciseName(from).toLowerCase()}. Start lighter and rate the first set.`, from: null };
      count += 1;
    }
  }
  if (!count) return { error: `${exerciseName(from)} isn't in the program from week ${fromWeek}.` };
  next.version = program.version + 1;
  next.changes = [...(program.changes ?? []), { type: 'swap', from, to, fromWeek }];
  const problems = validateProgram(next, intake);
  return problems.length ? { error: problems[0] } : { program: next, count };
}

/** A shorter copy of one session (today only); the main lift stays first. */
export function shortenSession(session, minutes) {
  const items = fit(clone(session.items), minutes);
  return { ...clone(session), items, estimated_minutes: sessionMinutes(items, minutes), shortenedTo: minutes };
}
