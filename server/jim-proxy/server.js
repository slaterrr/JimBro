// Tiny HTTP front door for Jim: POST /chat -> Claude. No framework, stores nothing.
// Run: ANTHROPIC_API_KEY=... node server.js   (PORT defaults to 8787)
import http from 'node:http';

import Anthropic from '@anthropic-ai/sdk';

import { allowRequest, handleChat } from './jim.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 64 * 1024;
const ORIGIN = process.env.ALLOW_ORIGIN ?? '*';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}
const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const send = (res, status, body) => {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/chat') return send(res, 404, { error: 'not found' });
  const ip = req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown';
  if (!allowRequest(ip)) return send(res, 429, { error: 'slow down' });

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY) { send(res, 413, { error: 'body too large' }); req.destroy(); }
  });
  req.on('end', async () => {
    if (res.headersSent) return;
    try {
      send(res, 200, await handleChat(JSON.parse(raw), client));
    } catch (e) {
      const status = e instanceof SyntaxError ? 400 : e.name === 'BadRequest' ? 400 : 502;
      if (status === 502) console.error('chat failed:', e.message); // never log bodies: they hold user data
      send(res, status, { error: status === 400 ? e.message : 'upstream error' });
    }
  });
});
server.requestTimeout = 35_000;
server.listen(PORT, () => console.log(`jim-proxy listening on :${PORT}`));
