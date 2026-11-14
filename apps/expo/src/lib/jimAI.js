// Jim's conversational layer. The app sends a compact, privacy-minimal text snapshot to the
// jim-proxy (Claude), gets back a reply plus PROPOSED intents, and re-validates every proposal
// against its own data before the confirm card shows. No URL, a timeout, an error or a bad
// payload all fall back to the rule-based parseIntent/coachReply, so the demo never breaks.
import { coachReply, SAFETY, SAFETY_TEXT } from './coach.js';
import { EXERCISES } from './exercises.js';
import { describeGoal, goalProgress, migrateGoals, weeklyCheckIn } from './goals.js';
import { parseIntent } from './intents.js';
import { personalRecords } from './progress.js';
import { planFromGoal, planProposal, validateEmphasis } from './planFromGoal.js';
import { setReport } from './sessionReport.js';

const DAY = 86400000;
const RECENT_DAYS = 14;
const MAX_SETS = 10;
const HISTORY_TURNS = 10;
export const TIMEOUT_MS = 12000;
const EXERCISE_IDS = new Set(EXERCISES.map((e) => e.id));
const UNITS = new Set(['lb', 'kg']);

const workoutsOf = (state) => [...(state.history ?? []), ...(state.active ? [state.active] : [])];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** Text-only snapshot of what Jim may know. Set ids are the only identifiers. */
export function buildContext(state, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : now;
  const workouts = workoutsOf(state);
  const sets = workouts.flatMap((w) => (w.sets ?? []).map((s) => ({ s, at: s.loggedAt ?? w.startedAt })));
  const recentSets = sets
    .filter(({ at }) => t - new Date(at).getTime() <= RECENT_DAYS * DAY)
    .map(({ s, at }) => ({ id: s.id, exercise: s.exercise, reps: s.reps, weight: s.weight, unit: s.unit, rpe: s.rpe ?? null, source: s.source ?? 'manual', pr: Boolean(s.pr), date: String(at).slice(0, 10) }));
  const prs = personalRecords(workouts).map((r) => ({
    exercise: r.exercise, unit: r.unit,
    heaviest: { reps: r.heaviest.reps, weight: r.heaviest.weight },
    mostReps: { reps: r.most_reps.reps, weight: r.most_reps.weight },
    bestSetVolume: r.best_set_volume,
  }));
  const goals = migrateGoals(state.goals ?? []).map((g) => {
    const p = goalProgress(g, workouts, t);
    return { label: describeGoal(g), ...pick(p, ['pct', 'current', 'target', 'onTrack', 'projectedDate', 'evidence', 'nextStep']) };
  });
  const check = weeklyCheckIn(state, t);
  const weekly = { wins: check.wins, misses: check.misses, suggestion: check.suggestion, ...(check.adherence ? { plannedSessions: check.adherence.planned, completedSessions: check.adherence.completed } : {}) };
  const cam = sets.map(({ s }) => s).filter((s) => s.source === 'camera' && s.reps_detail?.length).at(-1);
  let lastSetReport = null;
  if (cam) {
    const r = setReport({ movement: cam.exercise, reps: cam.reps_detail, quality: cam.camera_quality ?? null, rpe: cam.rpe ?? null, target: cam.target ?? null });
    lastSetReport = { ...pick(r, ['movement', 'counted', 'target', 'rpe', 'partials', 'trackingPct', 'tempo']), suggestions: r.suggestions.map(({ text, evidence }) => ({ text, evidence })) };
  }
  const settings = state.settings ?? {};
  return { unit: settings.unit ?? 'lb', persona: settings.persona ?? settings.tone ?? null, recentSets, prs, goals, weeklyCheckIn: weekly, lastSetReport };
}

const isCount = (n) => Number.isInteger(n) && n >= 1 && n <= 1000;
const isWeight = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000;
const validSet = (s) => s && EXERCISE_IDS.has(s.exercise) && isCount(s.reps) && isWeight(s.weight) && UNITS.has(s.unit)
  && (s.rpe == null || (typeof s.rpe === 'number' && s.rpe >= 1 && s.rpe <= 10));

/** Re-check a server proposal against the intents schema and this phone's data. */
export function validateProposal(p, state) {
  if (!p || typeof p.summary !== 'string' || !p.summary.trim()) return null;
  if (p.type === 'log') {
    if (!Array.isArray(p.sets) || !p.sets.length || p.sets.length > MAX_SETS || !p.sets.every(validSet) || !validSet(p.set)) return null;
    return p;
  }
  if (p.type !== 'correct' && p.type !== 'delete') return null;
  const id = p.target?.setId;
  if (!workoutsOf(state).some((w) => (w.sets ?? []).some((s) => s.id === id))) return null;
  if (p.type === 'delete') return p;
  const c = p.changes;
  if (!c || typeof c !== 'object' || !Object.keys(c).length) return null;
  for (const [k, v] of Object.entries(c)) {
    const ok = { exercise: () => EXERCISE_IDS.has(v), reps: () => isCount(v), weight: () => isWeight(v), unit: () => UNITS.has(v) }[k];
    if (!ok || !ok()) return null;
  }
  return p;
}

/** Proxy base URL: EXPO_PUBLIC_JIM_PROXY_URL env, then app.json extra.jimProxyUrl. */
export function proxyUrl(env = {}, extra = {}) {
  const url = env.EXPO_PUBLIC_JIM_PROXY_URL || extra?.jimProxyUrl || null;
  return url ? url.replace(/\/+$/, '') : null;
}

/** Chat bubbles -> the last HISTORY_TURNS text turns for Claude. Cards are skipped. */
export function historyFor(messages) {
  return messages
    .filter((m) => typeof m.text === 'string' && m.text.trim() && !m.kind)
    .map((m) => ({ role: m.me ? 'user' : 'assistant', content: m.text }))
    .slice(-HISTORY_TURNS);
}

function offline(message, state, reason) {
  const settings = state.settings ?? {};
  const intent = parseIntent(message, { history: state.history ?? [], active: state.active ?? null, unit: settings.unit });
  if (['log', 'correct', 'delete'].includes(intent.type)) return { source: 'offline', reason, reply: '', proposals: [intent], suggestion: null };
  if (intent.type === 'clarify') return { source: 'offline', reason, reply: intent.question, proposals: [], suggestion: null };
  const r = coachReply(message, settings.persona ?? settings.tone, workoutsOf(state).flatMap((w) => w.sets ?? []));
  return { source: 'offline', reason, reply: r.text, proposals: [], suggestion: r.suggestion, safety: r.source === 'safety' };
}

/**
 * One chat turn. Returns { source: 'ai'|'offline'|'safety', reply, proposals, suggestion?, safety? }.
 * history: prior turns as [{role, content}] (see historyFor); message is the new user text.
 */
export async function askJim({ message, history = [], state, url, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, now = new Date() }) {
  if (SAFETY.test(message)) return { source: 'safety', reply: SAFETY_TEXT, proposals: [], suggestion: null, safety: true };
  if (!url || !fetchImpl) return offline(message, state, 'no proxy configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const context = buildContext(state, now);
    const res = await fetchImpl(`${url}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [...history, { role: 'user', content: message }], context, persona: context.persona }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const body = await res.json();
    if (typeof body?.reply !== 'string' || !Array.isArray(body.proposals)) throw new Error('bad payload');
    const proposals = body.proposals.map((p) => validateProposal(p, state)).filter(Boolean);
    const reply = body.reply.trim() || (proposals.length ? 'Check the card and confirm.' : '');
    if (!reply && !proposals.length) throw new Error('empty reply');
    return { source: body.safety ? 'safety' : 'ai', reply, proposals, suggestion: null, safety: Boolean(body.safety) };
  } catch (e) {
    return offline(message, state, e?.message ?? 'error');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Physique photo -> plan ----------
// The photo goes to the proxy only with explicit consent, only for this request, and with no
// workout data attached. The phone keeps no copy. Every failure path still returns a plan built
// on-device from the user's goal, focus muscles and history (planFromGoal).
export const PHYSIQUE_TIMEOUT_MS = 30000;
export const MAX_PHOTO_BASE64 = 5_000_000; // ~3.75 MB decoded, matches the proxy limit
const NOT_PHYSIQUE = "I couldn't read a physique in that photo, so this plan is built from your goal and history instead.";
const FALLBACK = "I couldn't analyse the photo right now, so this plan is built from your goal and history instead.";

/** { image: { base64, mediaType } | null, consent, state, url } -> { source, reason?, message, emphasis, proposal } */
export async function askPhysique({ image, consent, state = {}, url, fetchImpl = globalThis.fetch, timeoutMs = PHYSIQUE_TIMEOUT_MS }) {
  const s = state.settings ?? {};
  const fitnessGoal = typeof s.fitnessGoal === 'string' ? s.fitnessGoal : 'general';
  const focusMuscles = Array.isArray(s.focusMuscles) ? s.focusMuscles : [];
  const physiqueGoal = typeof s.physiqueGoal === 'string' ? s.physiqueGoal.slice(0, 300) : '';
  const history = workoutsOf(state);
  const build = (emphasis) => planProposal(planFromGoal({ fitnessGoal, focusMuscles, emphasis, history }));
  const offlineRes = (reason, message = FALLBACK) => ({ source: 'offline', reason, message, emphasis: [], proposal: build([]) });
  if (!image?.base64) return offlineRes('no photo', 'Here is a plan built from your goal and history.');
  if (consent !== true) return offlineRes('no consent', 'No photo was sent. Here is a plan built from your goal and history.');
  if (image.base64.length > MAX_PHOTO_BASE64) return offlineRes('photo too large', 'That photo is too large to send. Here is a plan built from your goal and history.');
  if (!url || !fetchImpl) return offlineRes('no proxy configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}/physique`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true, image: { media_type: image.mediaType ?? 'image/jpeg', data: image.base64 }, fitnessGoal, physiqueGoal, focusMuscles }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const body = await res.json();
    if (body?.ok !== true) return offlineRes(String(body?.reason ?? 'no_proposal'), body?.reason === 'not_physique' ? NOT_PHYSIQUE : FALLBACK);
    const emphasis = validateEmphasis(body.emphasis);
    if (!emphasis.length) return offlineRes('no_valid_emphasis');
    return { source: 'ai', message: 'Here is a plan that puts extra work on the muscles that stand out in your reference photo.', emphasis, proposal: build(emphasis) };
  } catch (e) {
    return offlineRes(e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'error'));
  } finally {
    clearTimeout(timer);
  }
}
