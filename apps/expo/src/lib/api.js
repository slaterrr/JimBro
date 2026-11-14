// Pi API client (contract: docs/openapi.json). Network failures throw plain Errors;
// HTTP failures throw ApiError so callers can tell "offline" from "rejected".
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createApi({ base, athlete = 'me', fetchImpl = fetch, timeoutMs = 8000 }) {
  async function call(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Athlete-Id': athlete },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(controller.signal.aborted ? 'The Pi timed out' : `Can't reach the Pi (${e.message})`);
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // empty body
    }
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : res.statusText;
      throw new ApiError(res.status, detail);
    }
    return data;
  }

  const enc = encodeURIComponent;
  return {
    base,
    status: () => call('GET', '/v1/status'),
    exercises: () => call('GET', '/v1/exercises'),
    createSession: () => call('POST', '/v1/sessions', {}),
    endSession: (id) => call('POST', `/v1/sessions/${enc(id)}/end`, {}),
    summary: (id) => call('GET', `/v1/sessions/${enc(id)}/summary`),
    sessions: () => call('GET', '/v1/sessions'),
    completeSet: (id, body) => call('POST', `/v1/sets/${enc(id)}/complete`, body),
    coach: (message, tone) => call('POST', '/v1/coach', { message, tone }),
    suggestion: (exercise) => call('GET', `/v1/suggestions/${enc(exercise)}`),
    plan: (req) => call('POST', '/v1/plans', req),
    progress: (exercise) => call('GET', `/v1/progress/${enc(exercise)}`),
    leaderboard: (metric = 'reps') => call('GET', `/v1/leaderboard?metric=${enc(metric)}`),
    me: () => call('GET', '/v1/athletes/me'),
    saveMe: (display_name, leaderboard_opt_in) =>
      call('PUT', '/v1/athletes/me', { display_name, leaderboard_opt_in }),
    seedDemo: () => call('POST', '/v1/demo/seed', {}),
  };
}
