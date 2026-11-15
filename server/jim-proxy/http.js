// Production HTTP boundary, also exercised by the browser suite with an injected SDK client.
import http from 'node:http';
import { allowRequest, authorized, handleChat } from './jim.js';
import { healthReply } from './health.js';
import { clientAddress } from './httpSecurity.js';
import { handlePlan } from './plan.js';
import { bodyLimitFor, handlePhysique } from './physique.js';

export function createJimServer({ client, key = process.env.JIM_PROXY_KEY ?? '', origin = process.env.ALLOW_ORIGIN ?? '*', limitRequests = allowRequest, trustCloudflare = process.env.TRUST_CLOUDFLARE_IP === '1' } = {}) {
  if (!client) throw new Error('An AI client is required');
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Jim-Key', Vary: 'Origin' };
  const send = (res, status, body) => {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    const health = healthReply(req.method, req.url);
    if (health) {
      if (!health.head) return send(res, health.status, health.body);
      return void res.writeHead(health.status, cors).end();
    }
    const handler = { '/chat': handleChat, '/physique': handlePhysique, '/plan': handlePlan }[req.url];
    if (req.method !== 'POST' || typeof handler !== 'function') return send(res, 404, { error: 'not found' });
    if (!authorized(req.headers, key)) return send(res, 401, { error: 'missing or wrong X-Jim-Key' });
    if (!limitRequests(clientAddress(req.headers, req.socket.remoteAddress, { trustCloudflare }))) return send(res, 429, { error: 'slow down' });
    const limit = bodyLimitFor(req.url);
    if (Number(req.headers['content-length'] ?? 0) > limit) return send(res, 413, { error: 'body too large' });
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; send(res, 413, { error: 'body too large' }); }
      else if (!res.headersSent) chunks.push(chunk);
    });
    req.on('end', async () => {
      if (res.headersSent) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        chunks.length = 0;
        send(res, 200, await handler(body, client));
      } catch (e) {
        chunks.length = 0;
        const status = e instanceof SyntaxError || e.name === 'BadRequest' ? 400 : e.name === 'TooLarge' ? 413 : 502;
        send(res, status, { error: status === 502 ? 'upstream error' : e.message });
      }
    });
  });
  server.requestTimeout = 35_000;
  return server;
}
