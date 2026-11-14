// Jim's brain on the server: builds the persona prompt, runs Claude's tool loop for read
// tools (answered from the app's context snapshot), and turns write tools into PROPOSALS
// shaped exactly like apps/expo/src/lib/intents.js output. Nothing is stored or applied here.
import { SAFETY, SAFETY_TEXT } from '../../apps/expo/src/lib/coach.js';
import { EXERCISES, exerciseName } from '../../apps/expo/src/lib/exercises.js';
import { GROUND_RULES, personaFor } from '../../apps/expo/src/lib/personas.js';

export const MODEL = 'claude-sonnet-5-5';
export const MAX_TOKENS = 400;
const MAX_TOOL_ROUNDS = 4;
const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;
const MAX_SETS = 10;
const EXERCISE_IDS = EXERCISES.map((e) => e.id);

const name = (ex) => exerciseName(ex).toLowerCase();
const fmtSet = (s) => `${s.reps} × ${s.weight} ${s.unit}`;
const okNum = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;

export function buildSystemPrompt(personaId) {
  const p = personaFor(personaId);
  return [
    `You are ${p.name}, the voice of the JimBro gym app. Role: ${p.role}. ${p.purpose}`,
    `Style: ${p.style}`,
    `Focus on: ${p.focus.join(', ')}.`,
    'Rules:',
    ...GROUND_RULES.map((r) => `- ${r}`),
    '- Your reply is read aloud: plain sentences, no markdown, no lists, no emoji.',
    '- Use the get_* tools for any number you cite. To log, fix or delete a set, call log_sets, correct_set or delete_set: they only PROPOSE the change and the user confirms it on screen, so say "confirm and I will..." rather than claiming it is done.',
    `- Exercises the app knows: ${EXERCISE_IDS.join(', ')}. For anything else, say you cannot log it yet.`,
  ].join('\n');
}

const SET_ID = { type: 'string', description: 'id of a set from get_recent_sets' };
const EXERCISE = { type: 'string', enum: EXERCISE_IDS };
export const TOOLS = [
  {
    name: 'log_sets',
    description: 'Propose logging one or more identical sets. The user must confirm.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: EXERCISE,
        reps: { type: 'integer', minimum: 1 },
        weight: { type: 'number', minimum: 0 },
        unit: { type: 'string', enum: ['lb', 'kg'], description: "defaults to the user's unit" },
        count: { type: 'integer', minimum: 1, maximum: MAX_SETS, description: 'number of sets, default 1' },
        rpe: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['exercise', 'reps', 'weight'],
    },
  },
  {
    name: 'correct_set',
    description: 'Propose changing fields of an existing set. The user must confirm.',
    input_schema: {
      type: 'object',
      properties: {
        setId: SET_ID,
        changes: {
          type: 'object',
          properties: { exercise: EXERCISE, reps: { type: 'integer', minimum: 1 }, weight: { type: 'number', minimum: 0 }, unit: { type: 'string', enum: ['lb', 'kg'] } },
        },
      },
      required: ['setId', 'changes'],
    },
  },
  {
    name: 'delete_set',
    description: 'Propose deleting an existing set. The user must confirm.',
    input_schema: { type: 'object', properties: { setId: SET_ID }, required: ['setId'] },
  },
  {
    name: 'get_recent_sets',
    description: 'Sets from the last 14 days (oldest first) with ids, plus personal records.',
    input_schema: { type: 'object', properties: { exercise: EXERCISE } },
  },
  { name: 'get_goal_progress', description: "The user's goals with percent progress and next step.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_weekly_checkin', description: "This week's wins, misses, plan adherence and suggestion.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_last_set_report', description: 'Measured report of the last camera-counted set.', input_schema: { type: 'object', properties: {} } },
];
const WRITE_TOOLS = new Set(['log_sets', 'correct_set', 'delete_set']);

export function runReadTool(tool, input, context = {}) {
  switch (tool) {
    case 'get_recent_sets': {
      const sets = (context.recentSets ?? []).filter((s) => !input?.exercise || s.exercise === input.exercise);
      const prs = (context.prs ?? []).filter((r) => !input?.exercise || r.exercise === input.exercise);
      return { unit: context.unit ?? 'lb', sets, prs };
    }
    case 'get_goal_progress': return { goals: context.goals ?? [] };
    case 'get_weekly_checkin': return context.weeklyCheckIn ?? { none: 'No check-in data yet.' };
    case 'get_last_set_report': return context.lastSetReport ?? { none: 'No camera set report yet.' };
    default: return { error: `Unknown tool ${tool}` };
  }
}

const findSet = (context, id) => (context.recentSets ?? []).find((s) => s.id === id) ?? null;

/** Write tool input -> intent object (as intents.js would produce), or null when invalid. */
export function proposalFrom(tool, input = {}, context = {}) {
  if (tool === 'log_sets') {
    const { exercise, reps, weight, rpe } = input;
    const count = input.count ?? 1;
    const unit = input.unit ?? context.unit ?? 'lb';
    if (!EXERCISE_IDS.includes(exercise) || !Number.isInteger(reps) || !okNum(reps, 1000) || reps < 1 || !okNum(weight, 2000)) return null;
    if (!Number.isInteger(count) || count < 1 || count > MAX_SETS || !['lb', 'kg'].includes(unit)) return null;
    if (rpe != null && !(okNum(rpe, 10) && rpe >= 1)) return null;
    const set = { exercise, reps, weight, unit, ...(rpe != null ? { rpe } : {}) };
    const desc = `${reps} × ${name(exercise)} at ${weight} ${unit}${rpe != null ? `, RPE ${rpe}` : ''}`;
    return { type: 'log', set, sets: Array.from({ length: count }, () => ({ ...set })), summary: count > 1 ? `Log ${count} sets of ${desc}?` : `Log ${desc}?` };
  }
  const target = findSet(context, input.setId);
  if (!target) return null;
  if (tool === 'delete_set') return { type: 'delete', target: { setId: target.id }, summary: `Delete your ${name(target.exercise)} (${fmtSet(target)})?` };
  if (tool === 'correct_set') {
    const changes = {};
    const c = input.changes ?? {};
    if (c.exercise !== undefined) { if (!EXERCISE_IDS.includes(c.exercise)) return null; changes.exercise = c.exercise; }
    if (c.reps !== undefined) { if (!Number.isInteger(c.reps) || c.reps < 1 || c.reps > 1000) return null; changes.reps = c.reps; }
    if (c.weight !== undefined) { if (!okNum(c.weight, 2000)) return null; changes.weight = c.weight; }
    if (c.unit !== undefined) { if (!['lb', 'kg'].includes(c.unit)) return null; changes.unit = c.unit; }
    if (!Object.keys(changes).length) return null;
    const next = { ...target, ...changes };
    const exPart = changes.exercise ? `${name(changes.exercise)} ` : '';
    return { type: 'correct', target: { setId: target.id }, changes, summary: `Change your ${name(target.exercise)} (${fmtSet(target)}) to ${exPart}${fmtSet(next)}?` };
  }
  return null;
}

class BadRequest extends Error { constructor(m) { super(m); this.name = 'BadRequest'; } }

function validate(body) {
  const { messages } = body ?? {};
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) throw new BadRequest('messages must be 1-20 items');
  const clean = messages.map((m) => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) throw new BadRequest('each message needs role user|assistant and text content');
    if (m.content.length > MAX_CHARS) throw new BadRequest('message too long');
    return { role: m.role, content: m.content };
  });
  if (clean.at(-1).role !== 'user') throw new BadRequest('last message must be from the user');
  while (clean[0].role !== 'user') clean.shift();
  return clean;
}

const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();

/** POST /chat body -> { reply, proposals[, safety] }. `client` is an Anthropic SDK client. */
export async function handleChat(body, client) {
  const messages = validate(body);
  const latest = messages.at(-1).content;
  if (SAFETY.test(latest)) return { reply: SAFETY_TEXT, proposals: [], safety: true };
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const system = buildSystemPrompt(body.persona);
  const proposals = [];
  const convo = [...messages];
  let reply = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: convo });
    reply = textOf(res) || reply;
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length || round === MAX_TOOL_ROUNDS) break;
    const results = uses.map((u) => {
      if (WRITE_TOOLS.has(u.name)) {
        const p = proposalFrom(u.name, u.input, context);
        if (p) proposals.push(p);
        return { type: 'tool_result', tool_use_id: u.id, content: p ? `Proposed to the user for confirmation: ${p.summary}` : 'Rejected: invalid exercise, number or set id.', is_error: !p };
      }
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(runReadTool(u.name, u.input, context)) };
    });
    convo.push({ role: 'assistant', content: res.content }, { role: 'user', content: results });
  }
  if (!reply) reply = proposals.length ? 'Check the card and confirm.' : "Sorry, I lost my train of thought. Try again?";
  return { reply, proposals };
}

const WINDOW_MS = 60_000;
const PER_WINDOW = 20;
const defaultBuckets = new Map();

/** Fixed-window per-IP limiter: PER_WINDOW requests per minute. */
export function allowRequest(ip, now = Date.now(), buckets = defaultBuckets) {
  const b = buckets.get(ip);
  if (!b || now - b.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
    return true;
  }
  b.count += 1;
  return b.count <= PER_WINDOW;
}
