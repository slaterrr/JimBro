// End-to-end app -> typed API client -> production HTTP handler -> mocked Claude
// SDK -> real tool loop -> client validation -> confirm -> durable workout store.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect } from '@playwright/test';
import { startChatFixture } from './chat-mvp-fixture.mjs';

let fixture;
let staticServer;
const exportRoot = resolve(process.env.CHAT_E2E_EXPORT || 'dist-chat');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };

test.beforeAll(async () => {
  fixture = await startChatFixture();
  staticServer = http.createServer(async (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(exportRoot, `.${name === '/' ? '/index.html' : name}`);
    if (!path.startsWith(`${exportRoot}${sep}`)) return void res.writeHead(403).end();
    try { const data = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { staticServer.once('error', reject); staticServer.listen(18085, '127.0.0.1', resolve); });
});
test.afterAll(async () => {
  await fixture?.close();
  await new Promise(resolve => staticServer ? staticServer.close(resolve) : resolve());
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // One-time initialization preserves real writes when the test reloads.
    if (!localStorage.getItem('jimbro.data.v2')) localStorage.setItem('jimbro.data.v2', JSON.stringify({
      history: [], active: null, plan: null, goals: [], settings: { onboarded: true, speak: false, unit: 'kg' },
    }));
  });
  await page.goto('/');
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeVisible();
});

const message = async (page, text) => {
  await page.getByLabel('Message Jim', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
};
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('jimbro.data.v2')));
const allSets = data => [...(data?.history || []), ...(data?.active ? [data.active] : [])].flatMap(w => w.sets || []);

test('API rejects unauthenticated requests and exposes a safe health response', async () => {
  expect((await fetch(`${fixture.url}/health`)).status).toBe(200);
  const response = await fetch(`${fixture.url}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(401);
});

test('Claude proposes a set, user confirms once, and the actual set survives reload', async ({ page }) => {
  const before = fixture.calls.length;
  await message(page, 'Log 8 squats at 20 kg');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  expect(allSets(await saved(page))).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => allSets(await saved(page)).length).toBe(1);
  expect(fixture.calls.slice(before).some(call => call.tools.some(t => t.name === 'log_sets'))).toBe(true);
  const [set] = allSets(await saved(page));
  expect(set).toMatchObject({ exercise: 'squat', reps: 8, weight: 20, unit: 'kg' });
  await page.reload();
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeVisible();
  expect(allSets(await saved(page))).toHaveLength(1);
});

test('cancelling the write proposal changes no workouts', async ({ page }) => {
  await message(page, 'Log 8 squats at 20 kg');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('follow-up turns reach the HTTP service with conversation history', async ({ page }) => {
  await message(page, 'Explain what you can help with');
  await expect.poll(() => fixture.calls.some(call => call.messages.some(m => m.content === 'Explain what you can help with'))).toBe(true);
  await expect(page.getByText('I can help you plan a workout, count camera reps, and review the sets you have logged.', { exact: true })).toBeVisible();
  await message(page, 'What did I ask before?');
  await expect(page.getByText('Your previous question was: Explain what you can help with', { exact: true })).toBeVisible();
});

test('malformed model tool input is rejected with no confirmation and no data mutation', async ({ page }) => {
  await message(page, 'Try a malformed tool request');
  await expect(page.getByText('The tool request was rejected. Your workout was not changed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('a server-originated camera tool opens inside the conversation', async ({ page }) => {
  await message(page, 'Could you help me prepare?');
  await expect(page.getByTestId('chat-panel-camera')).toBeVisible();
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeVisible();
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('server-originated progress tool uses the existing progress view in chat', async ({ page }) => {
  await message(page, 'Could you review my training?');
  await expect(page.getByTestId('chat-panel-progress')).toBeVisible();
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeVisible();
});

test('pain or dizziness is handled locally before any model call', async ({ page }) => {
  const count = fixture.calls.length;
  await message(page, 'I feel dizzy during my set');
  await expect(page.getByText(/stop.*set|stop.*exercise|stop.*training/i).first()).toBeVisible();
  expect(fixture.calls.length).toBe(count);
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('upstream failure falls back explicitly without losing the message', async ({ page }) => {
  await message(page, 'Take the AI offline for this request');
  await expect(page.getByText(/offline coach|built-in rules/i).first()).toBeVisible();
  await expect(page.getByText('Take the AI offline for this request', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeEditable();
});

for (const width of [320, 390, 1440]) {
  test(`chat stays within a ${width}px viewport and keyboard input remains reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Message Jim', { exact: true })).toBeInViewport();
    await message(page, 'Explain what you can help with');
    await expect(page.getByText('I can help you plan a workout, count camera reps, and review the sets you have logged.', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.width + 1);
    expect(overflow.body).toBeLessThanOrEqual(overflow.width + 1);
    await expect(page.getByLabel('Message Jim', { exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`), fullPage: true });
    await testInfo.attach(`chat-${width}`, { path: testInfo.outputPath(`chat-${width}.png`), contentType: 'image/png' });
  });
}
