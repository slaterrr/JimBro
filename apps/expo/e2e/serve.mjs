// Static server for the web export, with SPA fallback: node e2e/serve.mjs <dir> <port>
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const [root = 'dist-web', port = '4173'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
http.createServer((q, r) => {
  let p = join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(p) || !extname(p)) p = join(root, 'index.html');
  r.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
  r.end(readFileSync(p));
}).listen(Number(port), () => console.log(`serving ${root} on :${port}`));
