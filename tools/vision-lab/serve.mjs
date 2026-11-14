// Serves the repo on http://localhost:5174 so record.html can import the app's modules and use the
// camera (browsers allow getUserMedia on localhost). Read-only, localhost only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 5174);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path);
  if (req.method !== 'GET' || !file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`recorder: http://localhost:${PORT}/tools/vision-lab/record.html`));
