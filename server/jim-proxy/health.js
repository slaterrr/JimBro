// Liveness check for /health. GET and HEAD (cheap wake-up pings from the app or a host monitor).
// The reply is a constant: no env, keys, versions or request data.
export function healthReply(method, url) {
  if (url !== '/health' || (method !== 'GET' && method !== 'HEAD')) return null;
  return { status: 200, body: { ok: true }, head: method === 'HEAD' };
}
