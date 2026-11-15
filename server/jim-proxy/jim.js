// Jim's brain on the server: builds the persona prompt, runs Claude's tool loop for read
// tools (answered from the app's context snapshot), and turns write tools into PROPOSALS
// shaped exactly like apps/expo/src/lib/intents.js output. Nothing is stored or applied here.
import { timingSafeEqual } from 'node:crypto';
import { PANELS, validateAction } from '../../apps/expo/src/lib/chatActions.js';

import { SAFETY, SAFETY_TEXT } from '../../apps/expo/src/lib/coach.js';
import { principleRules } from '../../apps/expo/src/lib/coachingPrinciples.js';
import { EXERCISES, exerciseName } from '../../apps/expo/src/lib/exercises.js';
import { GROUND_RULES, personaFor } from '../../apps/expo/src/lib/personas.js';

// The team's model choice; override with JIM_MODEL. Claude Sonnet 5.5 thinks by default and
// thinking counts against max_tokens, so leave room; the prompt keeps replies to two sentences.
export const MODEL = process.env.JIM_MODEL || 'claude-sonnet-5-5';
export const MAX_TOKENS = 2048;
export const EFFORT = 'low'; // chat: low effort keeps replies quick
// Server-side refusal fallbacks (beta). Default on; JIM_FALLBACKS=0 turns them off if the account
// does not have the beta (the smoke test shows a 400 in that case).
const FALLBACKS_DEFAULT = process.env.JIM_FALLBACKS !== '0';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
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
    'Coaching approach (from interviews with experienced personal trainers):',
    ...principleRules().map((r) => `- ${r}`),
    '- Your reply is read aloud: plain sentences, no markdown, no lists, no emoji.',
    '- Use the get_* tools for any number you cite. To log, fix or delete a set, call log_sets, correct_set or delete_set: they only PROPOSE the change and the user confirms it on screen, so say "confirm and I will..." rather than claiming it is done.',
    '- Everything happens in this chat. Use show_panel for camera, progress, muscles, plan or import. Camera and read operations are local and reversible. Never claim camera access is granted or video is recorded. get_live_session returns observed counts only; absent camera data means unknown. Saving a set always needs its confirmation card.',
    `- Exercises the app knows: ${EXERCISE_IDS.join(', ')}. For anything else, say you cannot log it yet.`,
  ].join('\n');
}

const SET_ID = { type: 'string', description: 'id of a set from get_recent_sets' };
const EXERCISE = { type: 'string', enum: EXERCISE_IDS };
const TOOL_DEFINITIONS = [
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
  { name: 'get_workout_context', description: "Today's planned workout, sets left in the current workout, and the user's stated equipment and limits.", input_schema: { type: 'object', properties: {} } },
];
TOOL_DEFINITIONS.push(
  { name: 'get_live_session', description: 'Read the active workout and latest observed camera rep count. Null camera means no fresh measurement.', input_schema: { type: 'object', properties: {} } },
  { name: 'show_panel', description: 'Open a tool inside the conversation. Camera permission is requested on device. No workout data is saved.', input_schema: { type: 'object', properties: { panel: { type: 'string', enum: PANELS }, exercise: { type: 'string', enum: EXERCISES.filter(e => e.camera).map(e => e.id) } }, required: ['panel'] } },
);
function strictSchema(schema) {
  if (schema.type !== 'object') return schema;
  return { ...schema, additionalProperties: false, properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, strictSchema(v)])) };
}
export const TOOLS = TOOL_DEFINITIONS.map(t => ({ ...t, strict: true, input_schema: strictSchema(t.input_schema) }));

// Validate independently of the model/provider: strict output is not a trust boundary.
function matchesSchema(value, schema) {
  if (schema.type === 'object') return value && typeof value === 'object' && !Array.isArray(value)
    && (schema.required ?? []).every(k => Object.hasOwn(value, k))
    && Object.entries(value).every(([k, v]) => Object.hasOwn(schema.properties, k) && matchesSchema(v, schema.properties[k]));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string') return typeof value === 'string' && value.length <= 200;
  if (schema.type === 'integer' && !Number.isInteger(value)) return false;
  if (['integer', 'number'].includes(schema.type)) return typeof value === 'number' && Number.isFinite(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  return true;
}
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
    case 'get_live_session': return { session: context.activeSession ?? null, camera: context.liveCamera ?? null };
    case 'get_workout_context': return context.workout ?? { none: 'No workout context yet.' };
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

const REFUSED = "I can't help with that one. Ask me about your training, your sets or your plan.";
const CUT_OFF = 'Sorry, that answer got cut off. Ask me again, a bit more specifically?';

/** One Messages call; uses server-side fallbacks when the SDK client exposes the beta namespace. */
function callClaude(client, req, fallbacks) {
  if (fallbacks && client.beta?.messages?.create) {
    return client.beta.messages.create({ ...req, betas: [FALLBACK_BETA], fallbacks: 'default' });
  }
  return client.messages.create(req);
}

/** Shared-secret check for X-Jim-Key (timing-safe). No key configured = LAN development. */
export function authorized(headers = {}, key = process.env.JIM_PROXY_KEY ?? '') {
  if (!key) return true;
  const got = Buffer.from(String(headers['x-jim-key'] ?? ''));
  const want = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** POST /chat body -> { reply, proposals[, safety][, refused] }. `client` is an Anthropic SDK client. */
export async function handleChat(body, client, { fallbacks = FALLBACKS_DEFAULT } = {}) {
  const messages = validate(body);
  const latest = messages.at(-1).content;
  if (SAFETY.test(latest)) return { reply: SAFETY_TEXT, proposals: [], safety: true };
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const system = buildSystemPrompt(body.persona);
  const proposals = [];
  const actions = [];
  const toolCalls = [];
  const seenTools = new Set();
  const result = () => ({ reply, proposals, ...(actions.length ? { actions } : {}), ...(toolCalls.length ? { toolCalls } : {}) });
  const convo = [...messages];
  let reply = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await callClaude(client, { model: MODEL, max_tokens: MAX_TOKENS, output_config: { effort: EFFORT }, system, tools: TOOLS, messages: convo }, fallbacks);
    if (res.stop_reason === 'refusal') return { reply: REFUSED, proposals: [], refused: true };
    if (res.stop_reason === 'max_tokens') { reply = CUT_OFF; return result(); }
    reply = textOf(res) || reply;
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length || round === MAX_TOOL_ROUNDS) break;
    const results = uses.slice(0, 24).map((u) => {
      const tool = TOOLS.find(t => t.name === u.name);
      const valid = tool && matchesSchema(u.input, tool.input_schema);
      const receipt = { name: tool?.name ?? 'unknown', status: 'rejected' };
      if (toolCalls.length < 24) toolCalls.push(receipt);
      const respond = (content, error = false) => ({ type: 'tool_result', tool_use_id: u.id, content, is_error: error });
      if (!valid) return respond('Rejected: unknown tool or invalid arguments.', true);
      const signature = JSON.stringify([u.name, u.input]);
      if (seenTools.has(signature) && (WRITE_TOOLS.has(u.name) || u.name === 'show_panel')) return respond('Already proposed or opened in this turn; do not repeat.', true);
      seenTools.add(signature);
      if (u.name === 'show_panel') {
        const action = validateAction({ type: 'show_panel', ...u.input });
        if (!action) return respond('Rejected: unsupported panel or camera exercise.', true);
        actions.push(action);
        receipt.status = 'completed';
        return respond('The app will open this panel in chat. Permission is still required for the camera.');
      }
      if (WRITE_TOOLS.has(u.name)) {
        const p = proposalFrom(u.name, u.input, context);
        if (p) { proposals.push(p); receipt.status = 'proposed'; }
        return { type: 'tool_result', tool_use_id: u.id, content: p ? `Proposed to the user for confirmation: ${p.summary}` : 'Rejected: invalid exercise, number or set id.', is_error: !p };
      }
      receipt.status = 'completed';
      return respond(JSON.stringify(runReadTool(u.name, u.input, context)));
    });
    convo.push({ role: 'assistant', content: res.content }, { role: 'user', content: results });
  }
  if (!reply) reply = proposals.length ? 'Check the card and confirm.' : "Sorry, I lost my train of thought. Try again?";
  return result();
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
