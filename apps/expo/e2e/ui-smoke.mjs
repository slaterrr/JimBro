// UI smoke test: serves the web export, loads demo data, visits every screen at phone widths and
// fails on crashes, console errors, overlapping / clipped / off-screen / covered buttons, and
// buttons that stop responding. Screenshots go to E2E_OUT for the CI artifact.
//
//   npx expo export --platform web --output-dir dist-web && node e2e/ui-smoke.mjs dist-web
import http from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = process.argv[2] ?? 'dist-web';
const OUT = process.env.E2E_OUT ?? 'e2e-artifacts';
const WIDTHS = [320, 390];
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const demo = JSON.parse(readFileSync(new URL('../src/lib/fixtures/demo-workouts.json', import.meta.url), 'utf8'));
const SEED = JSON.stringify({ history: demo.history, settings: { onboarded: true, speak: false } });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
function serve(root) {
  return new Promise((ok) => {
    const s = http.createServer((q, r) => {
      let p = join(root, decodeURIComponent(q.url.split('?')[0]));
      if (!existsSync(p) || !extname(p)) p = join(root, 'index.html');
      try { r.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); r.end(readFileSync(p)); }
      catch { r.writeHead(404); r.end(); }
    }).listen(0, () => ok(s));
  });
}

// Runs in the page: layout problems among visible buttons on the current screen.
function audit() {
  const W = innerWidth;
  const scrollsX = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth) return true; } return false; };
  const name = (el) => (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.tagName;
  // With a modal open, only its contents are interactive; audit the top layer only.
  const layer = [...document.querySelectorAll('[aria-modal="true"],[role="dialog"]')].pop() ?? document;
  const btns = [...layer.querySelectorAll('[role="button"],button,[tabindex="0"]')]
    .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'; })
    .filter((el) => !el.querySelector('[role="button"],button,[tabindex="0"]')); // innermost only
  const problems = [];
  // Visible part of an element: its box clipped by every scrolling/clipping ancestor.
  const visibleRect = (el) => {
    let r = el.getBoundingClientRect(); let { left, top, right, bottom } = r;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const p = e.getBoundingClientRect();
        left = Math.max(left, p.left); top = Math.max(top, p.top); right = Math.min(right, p.right); bottom = Math.min(bottom, p.bottom);
      }
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const rects = btns.map((el) => [el, el.getBoundingClientRect(), visibleRect(el)]);
  for (const [el, r, vr] of rects) {
    if (!scrollsX(el) && (r.left < -1 || r.right > W + 1)) problems.push(`off-screen: "${name(el)}" (${Math.round(r.left)}–${Math.round(r.right)} of ${W}px)`);
    if (r.width < 24 || r.height < 24) problems.push(`tiny tap target: "${name(el)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    for (const t of el.querySelectorAll('div,span')) {
      if (!t.childElementCount && t.scrollWidth > t.clientWidth + 2 && getComputedStyle(t).overflow !== 'visible' && !/ellipsis/.test(getComputedStyle(t).textOverflow)) problems.push(`clipped text: "${name(el)}"`);
    }
    // Labelled button whose text is invisible (zero-size, transparent, or clipped away).
    const text = [...el.querySelectorAll('div[dir="auto"],span')].filter((t) => !t.childElementCount && t.textContent.trim() && !/^[-󰀀-󿿽]+$/u.test(t.textContent.trim()));
    for (const t of text) {
      const q = t.getBoundingClientRect(); const cs = getComputedStyle(t);
      const vis = q.width >= 4 && q.height >= 4 && cs.color !== 'rgba(0, 0, 0, 0)' && q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom;
      if (!vis) problems.push(`invisible label: "${t.textContent.trim().slice(0, 30)}" in "${name(el)}"`);
    }
    const tr = vr;
    if (tr.width >= 4 && tr.height >= 4 && tr.top >= 0 && tr.bottom <= innerHeight && tr.left >= 0 && tr.right <= W) {
      const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el)) problems.push(`covered: "${name(el)}" under "${(hit.innerText || hit.tagName).trim().slice(0, 30)}"`);
    }
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, , ra] = rects[i]; const [b, , rb] = rects[j];
    if (a.contains(b) || b.contains(a)) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 2 && h > 2) problems.push(`overlap: "${name(a)}" / "${name(b)}"`);
  }
  // Text that runs into a neighbour without any button involved (e.g. squeezed labels).
  for (const t of layer.querySelectorAll('div[dir="auto"]')) {
    if (t.childElementCount || !t.innerText.trim()) continue;
    const r = t.getBoundingClientRect();
    if (r.width && !scrollsX(t) && (r.left < -1 || r.right > W + 1)) problems.push(`text off-screen: "${t.innerText.trim().slice(0, 30)}"`);
  }
  return [...new Set(problems)];
}

const tap = (page, label) => page.evaluate((label) => {
  const els = [...document.querySelectorAll('[role="button"],[tabindex="0"],[role="tab"]')]
    .filter((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ') === label && e.getBoundingClientRect().width > 0);
  const el = els.pop(); if (!el) return false; el.click(); return true;
}, label);
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// Screens to visit: [name, steps]. A step is a button label; every label must exist and respond.
const ROUTES = [
  ['home', []],
  ['muscles', ['Muscles']],
  ['coach', ['Coach']],
  ['start-workout', ['Start a Workout']],
  ['log-set-sheet', ['Start a Workout', 'Home', 'Log a set']],
  ['muscle-progress', ['Muscles', 'muscle:chest', 'Progress']],
  ['activity-sheet', ['Activity and settings']],
  ['create-plan', ['Create a New Plan']],
  ['progress-overview', ['Progress']],
  ['progress-strength', ['Progress', 'id:seg-strength']],
  ['progress-history', ['Progress', 'id:seg-history']],
  ['progress-goals', ['Progress', 'id:seg-goals']],
  // Dropdowns: open the time-frame list, pick an entry, then open the long From list.
  ['progress-frame-dropdown', ['Progress', 'id:compare-frame', 'Month to month', 'id:compare-from']],
  ['progress-history-dropdown', ['Progress', 'id:seg-history', 'id:history-frame', 'Year to year']],
];

async function run() {
  const executablePath = CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome found; set CHROME_PATH');
  mkdirSync(OUT, { recursive: true });
  const server = await serve(ROOT);
  const url = `http://localhost:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const failures = [];
  try {
    for (const width of WIDTHS) {
      for (const [route, steps] of ROUTES) {
        if (process.env.UI_ROUTES && !process.env.UI_ROUTES.split(',').includes(route)) continue;
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text().slice(0, 200)}`); });
        await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
        const seed = route === 'muscle-progress' ? JSON.stringify({
          history: demo.history.map((w, i) => ({ ...w, sets: [...w.sets, { id: `pushup-${i}`, exercise: 'push_up', reps: 10 + i, weight: 0, unit: 'lb' }] })),
          settings: { onboarded: true, speak: false },
        }) : SEED;
        await page.evaluateOnNewDocument((seed) => { localStorage.setItem('jimbro.data.v2', seed); }, seed);
        await page.goto(url, { waitUntil: 'networkidle0' });
        await settle(1200);
        for (const step of steps) {
          if (step === 'muscle:chest') {
            // Tap the chest on the front body figure using its normalized anatomy coordinates.
            const box = await page.$eval('svg[viewBox="0 0 200 400"]', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
            await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.24);
            await settle();
            continue;
          }
          const ok = step.startsWith('id:') ? await page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); el?.click(); return Boolean(el); }, step.slice(3)) : await tap(page, step);
          if (!ok) errors.push(`missing button: ${step}`);
          await settle();
        }
        if (route === 'home') {
          const disabled = await page.$eval('[aria-label="Start a workout to log sets"]', el => el.getAttribute('aria-disabled') === 'true');
          if (!disabled) errors.push('logging enabled without a workout');
        }
        if (route === 'muscle-progress') {
          const text = await page.evaluate(() => document.body.innerText);
          if (!text.includes('Chest progress')) errors.push('missing muscle progress query');
          if (!text.includes('Bench press')) errors.push('missing exercise chart');
          if (!text.includes('Push-up')) errors.push('missing separate push-up chart');
          if (await page.$$eval('svg[viewBox="0 0 300 150"]', els => els.length) !== 2) errors.push('expected two separate exercise line charts');
        }
        const problems = [...errors, ...(await page.evaluate(audit))];
        await page.screenshot({ path: join(OUT, `${route}-${width}.png`), fullPage: true });
        if (route === 'log-set-sheet') {
          const saved = await tap(page, 'Save set');
          await settle();
          const count = await page.evaluate(() => JSON.parse(localStorage.getItem('jimbro.data.v2')).active?.sets.length);
          if (!saved || count !== 1) problems.push('set was not saved to the explicitly started workout');
        }
        for (const p of problems) failures.push(`[${route} @${width}px] ${p}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? failures.join('\n') : 'UI smoke: no problems');
  console.log(`screenshots: ${OUT}`);
  process.exitCode = failures.length ? 1 : 0;
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
