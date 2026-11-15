// Network boundary helpers. Do not trust client-supplied forwarding headers by default.
export function clientAddress(headers = {}, remoteAddress = 'unknown', { trustCloudflare = false } = {}) {
  const remote = typeof remoteAddress === 'string' && remoteAddress ? remoteAddress : 'unknown';
  // Only enable after restricting ingress to Cloudflare. Otherwise anyone can spoof this header.
  if (!trustCloudflare) return remote;
  const forwarded = headers['cf-connecting-ip'];
  if (typeof forwarded !== 'string') return remote;
  const ip = forwarded.trim();
  // A deliberately narrow syntactic check; ingress validation is still required.
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : remote;
}

export function assertSafeStartup(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.JIM_PROXY_KEY) {
    throw new Error('JIM_PROXY_KEY is required when NODE_ENV=production. A bundled shared key is NOT user authentication.');
  }
}
