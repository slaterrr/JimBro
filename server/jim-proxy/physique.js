// POST /physique: a reference photo the user chose -> which muscle groups to prioritize.
// Privacy: the image is used for this one Claude request only. It is never written to disk,
// never logged, never echoed back. Claude's free text is discarded; only validated
// { muscle, reason } pairs from the tool call are returned. The app builds the plan itself.
import { MUSCLE_GROUPS } from '../../apps/expo/src/lib/muscles.js';
import { validateEmphasis } from '../../apps/expo/src/lib/planFromGoal.js';
import { MODEL } from './jim.js';

export const MAX_IMAGE_BYTES = 3_750_000; // decoded bytes; keeps the request well under API limits
const CHAT_BODY = 64 * 1024;
const PHYSIQUE_BODY = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16 * 1024;
const MAX_GOAL_CHARS = 300;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const GOALS = new Set(['strength', 'muscle', 'endurance', 'fat_loss', 'general']);
const MUSCLE_IDS = MUSCLE_GROUPS.map((m) => m.id);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Max request body for a route: only /physique may carry an image. */
export const bodyLimitFor = (url) => (url === '/physique' ? PHYSIQUE_BODY : CHAT_BODY);

export const PHYSIQUE_SYSTEM = [
  'You help a gym app pick which muscle groups to train with extra volume so the user can build toward the physique in a reference photo they chose.',
  'Look only at visible muscle development (size, shape, which groups stand out). Name up to 4 muscle groups to prioritize, each with one short neutral reason about visible muscle development.',
  'Never comment on body weight, body fat, leanness, attractiveness, looks, age, gender, identity, or health. Never diagnose, never compare the user to the photo, never give diet advice.',
  'If the image is not a photo of a human physique (or is explicit, or shows a minor), set is_physique_photo to false and return no priorities.',
  'Answer only by calling propose_training_emphasis once. Do not write any other text.',
].join('\n');

export const EMPHASIS_TOOL = {
  name: 'propose_training_emphasis',
  description: 'Muscle groups to prioritize in training, with a short reason about visible muscle development for each.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      is_physique_photo: { type: 'boolean', description: 'true only if the image shows a human physique' },
      priorities: {
        type: 'array',
        description: 'At most 4, most important first.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { muscle: { type: 'string', enum: MUSCLE_IDS }, reason: { type: 'string', description: 'One neutral sentence, max 160 characters.' } },
          required: ['muscle', 'reason'],
        },
      },
    },
    required: ['is_physique_photo', 'priorities'],
  },
};

class BadRequest extends Error { constructor(m) { super(m); this.name = 'BadRequest'; } }
class TooLarge extends Error { constructor() { super('image too large'); this.name = 'TooLarge'; } }

function validate(body) {
  if (body?.consent !== true) throw new BadRequest('photo upload needs explicit consent');
  const img = body.image;
  if (!img || typeof img !== 'object') throw new BadRequest('image is required');
  if (!MEDIA_TYPES.has(img.media_type)) throw new BadRequest('unsupported image type (jpeg, png or webp)');
  if (typeof img.data !== 'string' || !BASE64.test(img.data)) throw new BadRequest('image must be base64');
  const bytes = Math.floor((img.data.length * 3) / 4) - (img.data.endsWith('==') ? 2 : img.data.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new TooLarge();
  const goal = body.physiqueGoal ?? '';
  if (typeof goal !== 'string' || goal.length > MAX_GOAL_CHARS) throw new BadRequest(`physiqueGoal must be text up to ${MAX_GOAL_CHARS} characters`);
  const fitnessGoal = GOALS.has(body.fitnessGoal) ? body.fitnessGoal : 'general';
  const focus = Array.isArray(body.focusMuscles) ? body.focusMuscles.filter((m) => MUSCLE_IDS.includes(m)) : [];
  return { img: { media_type: img.media_type, data: img.data }, goal: goal.trim(), fitnessGoal, focus };
}

/** POST /physique body -> { ok: true, emphasis } | { ok: false, reason }. `client` is an Anthropic SDK client. */
export async function handlePhysique(body, client) {
  const { img, goal, fitnessGoal, focus } = validate(body);
  const text = [
    `Training goal: ${fitnessGoal}.`,
    goal ? `In their words, they want: "${goal}".` : '',
    focus.length ? `Muscles they already want to focus on: ${focus.join(', ')}.` : '',
    'Which muscle groups should get extra training volume to build toward the physique in this reference photo?',
  ].filter(Boolean).join(' ');
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048, // room for default thinking on Sonnet 5.5
    output_config: { effort: 'low' },
    system: PHYSIQUE_SYSTEM,
    tools: [EMPHASIS_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', ...img } }, { type: 'text', text }] }],
  });
  if (res.stop_reason === 'refusal') return { ok: false, reason: 'declined' };
  const call = (res.content ?? []).find((b) => b.type === 'tool_use' && b.name === EMPHASIS_TOOL.name);
  if (!call) return { ok: false, reason: 'no_proposal' };
  if (call.input?.is_physique_photo !== true) return { ok: false, reason: 'not_physique' };
  const emphasis = validateEmphasis(call.input.priorities);
  return emphasis.length ? { ok: true, emphasis } : { ok: false, reason: 'no_valid_emphasis' };
}
