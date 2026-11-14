// Pi address handling. Expo Go talks to the Pi's LAN HTTP listener (:8080) because
// React Native rejects the self-signed HTTPS certificate the browser PWA uses.
export const DEFAULT_SERVER = 'http://jimbro.local:8080';
const HOST = /^[a-z0-9.-]+$/i;

export function normalizeServer(input) {
  let text = String(input ?? '').trim();
  if (!text) return null;
  text = text.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const [host, port] = text.split(':');
  if (!HOST.test(host) || (port !== undefined && !/^\d{1,5}$/.test(port))) return null;
  return `http://${host}:${port ?? '8080'}`;
}

export const wsUrl = (base, path) => `${base.replace(/^http/, 'ws')}${path}`;

/** The browser PWA (camera rep counter) lives on the Pi's HTTPS port. */
export const pwaUrl = (base) => `https://${new URL(base).hostname}/`;
