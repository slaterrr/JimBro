// Honest one-liner for the Home header: why Jim is (or isn't) using the AI service.
// proxy: { configured, state: 'checking' | 'ok' | 'off' | 'down', reason? }; source: last chat answer source.
export function proxyStatusLine(proxy, source) {
  if (!proxy.configured) return 'Offline coach · AI service not connected';
  if (source === 'offline') return 'Offline coach · Jim AI did not answer the last message';
  if (proxy.state === 'ok') return 'Connected to Jim AI';
  if (proxy.state === 'checking') return 'Connecting to Jim AI… the server may be waking up';
  if (proxy.reason === 'timeout') return 'Offline coach · Jim AI server is taking too long to wake up';
  if (proxy.reason === 'unreachable') return 'Offline coach · Jim AI server unreachable';
  return 'Offline coach · AI service not connected';
}
