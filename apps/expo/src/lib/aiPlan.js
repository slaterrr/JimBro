// The user explicitly requests an AI pass on a free, deterministic weekly plan.
// Claude can only reorder existing items; the local plan is the authority.
import { buildPlan } from './plans.js';

const TIMEOUT_MS = 12000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = items => items.map(x => JSON.stringify(x)).sort();

export function validateAIPlan(plan, request) {
  try {
    const local = buildPlan(request);
    if (!plan || plan.goal !== local.goal || !Array.isArray(plan.days) || plan.days.length !== local.days.length) return false;
    return plan.days.every((day, i) => {
      const reference = local.days[i];
      return day.day === reference.day && day.estimated_minutes === reference.estimated_minutes &&
        Array.isArray(day.items) && same(normalize(day.items), normalize(reference.items));
    });
  } catch { return false; }
}

export async function requestAIPlan({ request, history = [], url, key = null, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const plan = buildPlan(request);
  const offline = reason => ({ source: 'local', plan, explanation: 'Using your on-device plan.', reason });
  if (!url || !fetchImpl) return offline('no proxy configured');
  const recentSets = history.flatMap(w => w.sets ?? []).slice(-12).filter(s =>
    typeof s.exercise === 'string' && Number.isInteger(s.reps) &&
    typeof s.weight === 'number' && ['lb', 'kg'].includes(s.unit))
    .map(({ exercise, reps, weight, unit, rpe }) => ({ exercise, reps, weight, unit, ...(typeof rpe === 'number' ? { rpe } : {}) }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Jim-Key': key } : {}) },
      body: JSON.stringify({ request, recentSets }),
      signal: controller.signal,
    });
    if (!response?.ok) return offline(`proxy ${response?.status ?? 'error'}`);
    const body = await response.json();
    if (body?.ok !== true || !validateAIPlan(body.plan, request)) return offline('invalid AI plan');
    return { source: 'ai', plan: body.plan, explanation: typeof body.explanation === 'string' ? body.explanation.slice(0, 240) : '' };
  } catch (error) { return offline(error?.name === 'AbortError' ? 'timeout' : 'unreachable'); }
  finally { clearTimeout(timer); }
}
