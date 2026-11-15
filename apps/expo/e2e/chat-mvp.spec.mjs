// End-to-end app -> typed API client -> production HTTP handler -> mocked Claude
// SDK -> real tool loop -> client validation -> confirm -> durable workout store.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect } from '@playwright/test';
import { startChatFixture } from './chat-mvp-fixture.mjs';

let fixture;
let staticServer;
const pageErrors = new WeakMap();
const ACCOUNT = 'review.lifter@example.com';
const DATA_KEY = `jimbro.data.v2:${ACCOUNT}`;
const exportRoot = resolve(process.env.CHAT_E2E_EXPORT || 'dist-chat');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
const squatRecording = JSON.parse(await readFile(new URL('../../../tools/vision-lab/fixtures/fs_squat_rear.landmarks.json', import.meta.url), 'utf8'));

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
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(([account, key]) => {
    // Auth itself is covered by the unseeded login journeys. Each test account
    // keeps its real writes across reloads; no workout data enters production.
    localStorage.setItem('jimbro.session.v1', account);
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      history: [], active: null, plan: null, goals: [], settings: { onboarded: true, speak: false, unit: 'kg' },
    }));
  }, [ACCOUNT, DATA_KEY]);
  await page.goto('/');
  await expect(page.getByLabel('Message Jim', { exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page) || []).toEqual([]); });

const message = async (page, text) => {
  await page.getByLabel('Message Jim', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
};
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), DATA_KEY);
const startWorkout = async page => {
  await message(page, 'Start a workout');
  await expect.poll(async () => Boolean((await saved(page)).active?.id)).toBe(true);
  await message(page, 'stop camera');
  await expect(page.getByTestId('chat-panel-camera')).toHaveCount(0);
};
const allSets = data => [...(data?.history || []), ...(data?.active ? [data.active] : [])].flatMap(w => w.sets || []);

test('API rejects unauthenticated requests and exposes a safe health response', async () => {
  expect((await fetch(`${fixture.url}/health`)).status).toBe(200);
  const response = await fetch(`${fixture.url}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(401);
});

test('Claude proposes a set, user confirms once, and the actual set survives reload', async ({ page }) => {
  await startWorkout(page);
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


test('logging without an active workout cannot save or claim success', async ({ page }) => {
  await message(page, 'Log 8 squats at 20 kg');
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
  expect((await saved(page)).active).toBeNull();
  expect(allSets(await saved(page))).toHaveLength(0);
  await expect(page.getByText(/^Saved /)).toHaveCount(0);
});

test('a log proposal cannot move to a different workout', async ({ page }) => {
  await startWorkout(page);
  const firstWorkout = (await saved(page)).active.id;
  await message(page, 'Log 8 squats at 20 kg');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await message(page, 'Finish workout');
  await message(page, 'Start a workout');
  await expect.poll(async () => (await saved(page)).active?.id).not.toBe(firstWorkout);
  const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
  if (await confirm.count()) {
    if (await confirm.isEnabled()) await confirm.click();
    else await expect(confirm).toBeDisabled();
  }
  expect(allSets(await saved(page))).toHaveLength(0);
  await expect(page.getByText(/^Saved /)).toHaveCount(0);
});

test('cancelling the write proposal changes no workouts', async ({ page }) => {
  await startWorkout(page);
  await message(page, 'Log 8 squats at 20 kg');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('correction and deletion use the real set id and each require confirmation', async ({ page }) => {
  await startWorkout(page);
  await message(page, 'Log 8 squats at 20 kg');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => allSets(await saved(page)).length).toBe(1);
  const originalId = allSets(await saved(page))[0].id;
  await message(page, 'Correct my last set to 9 reps');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  expect(allSets(await saved(page))[0].reps).toBe(8);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => allSets(await saved(page))[0]?.reps).toBe(9);
  expect(allSets(await saved(page))[0].id).toBe(originalId);
  await message(page, 'Delete my last set');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  expect(allSets(await saved(page))).toHaveLength(1);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => allSets(await saved(page)).length).toBe(0);
});

test('follow-up turns reach the HTTP service with conversation history', async ({ page }) => {
  await message(page, 'Explain what you can help with');
  await expect.poll(() => fixture.calls.some(call => call.messages.some(m => m.content === 'Explain what you can help with'))).toBe(true);
  await expect(page.getByText('I can help you plan a workout, count camera reps, and review the sets you have logged.', { exact: true })).toBeVisible();
  await message(page, 'What did I ask before?');
  await expect(page.getByText('Your previous question was: Explain what you can help with', { exact: true })).toBeVisible();
});

test('Shift+Enter inserts a line break and Enter submits the composed message once', async ({ page }) => {
  const composer = page.getByLabel('Message Jim', { exact: true });
  const before = fixture.calls.length;
  await composer.fill('Explain');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await composer.press('Shift+Enter');
  await composer.pressSequentially('my training');
  await expect(composer).toHaveValue('Explain\nmy training');
  expect(fixture.calls.length).toBe(before);
  await composer.press('Enter');
  await expect(page.getByText('I can help you plan a workout, count camera reps, and review the sets you have logged.', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  expect(fixture.calls.length).toBe(before + 1);
  expect(fixture.calls.at(-1).messages.at(-1).content).toBe('Explain\nmy training');
});

test('malformed model tool input is rejected with no confirmation and no data mutation', async ({ page }) => {
  await message(page, 'Try a malformed tool request');
  await expect(page.getByText('The tool request was rejected. Your workout was not changed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('an unknown model tool cannot escape the tool registry', async ({ page }) => {
  await message(page, 'Try an unknown tool');
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

test('muscles, weekly planning, and import stay available through chat', async ({ page }) => {
  for (const [request, panel] of [['Show my muscles', 'muscles'], ['Create a new plan', 'plan'], ['Import my workouts from CSV', 'import']]) {
    await message(page, request);
    await expect(page.getByTestId(`chat-panel-${panel}`)).toBeVisible();
    await expect(page.getByLabel('Message Jim', { exact: true })).toBeInViewport();
  }
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('camera permission failure never creates measured reps or logs a set', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Camera permission denied by E2E fixture', 'NotAllowedError'); };
  });
  await page.reload();
  await message(page, 'Open the camera for squats');
  await expect(page.getByTestId('chat-panel-camera')).toBeVisible();
  const allow = page.getByRole('button', { name: 'Allow camera', exact: true });
  if (await allow.isVisible()) await allow.click();
  await expect(page.getByText(/Camera access|camera.*denied|allow camera|camera.*could not/i).first()).toBeVisible();
  expect(allSets(await saved(page))).toHaveLength(0);
});

test('recorded real squat landmarks travel through the camera bridge, count twice, and save only on request', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  // Replay the repository's real recorded landmarks. Block model downloads so
  // model frames cannot mix with the recording; this is not a physical-camera test.
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await message(page, 'Open the camera for squats');
  const camera = page.getByTestId('chat-panel-camera');
  await expect(camera).toBeVisible();
  const iframe = page.locator('iframe[title="Camera and pose tracking"]');
  await expect(iframe).toBeVisible();
  const modelCallsBeforeFrames = fixture.calls.length;
  const frames = squatRecording.frames.map(({ t, pose }) => ({ t, pose: pose.map(([x, y, visibility]) => ({ x, y, visibility })) }));
  await iframe.contentFrame().locator('body').evaluate(async (_, frames) => {
    parent.postMessage(JSON.stringify({ type: 'ready' }), '*');
    for (const frame of frames) {
      parent.postMessage(JSON.stringify({ type: 'frame', ...frame }), '*');
      // Yield so React observes frames in order as it would on the real bridge.
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }, frames);
  await expect(camera.getByTestId('camera-rep-count')).toContainText('2');
  expect(fixture.calls.length).toBe(modelCallsBeforeFrames);
  expect(allSets(await saved(page))).toHaveLength(0);
  await message(page, 'What is my observed rep count?');
  await expect(page.getByText('The camera has observed 2 reps of squat.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End set and log it', exact: true }).click();
  await expect(page.getByText('2 reps · Squat', { exact: true })).toBeVisible();
  await page.getByLabel('Added weight', { exact: true }).fill('20');
  await page.getByLabel('Reported effort', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => allSets(await saved(page)).length).toBe(1);
  const [set] = allSets(await saved(page));
  expect(set).toMatchObject({ exercise: 'squat', reps: 2, source: 'camera', weight: 20, rpe: 7 });
  expect(set.reps_detail).toHaveLength(2);
  expect(set.reps_detail.every(rep => Number.isFinite(rep.concentric_ms) && rep.concentric_ms > 0 && Number.isFinite(rep.eccentric_ms))).toBe(true);
});

test('pain or dizziness is handled locally before any model call', async ({ page }) => {
  const count = fixture.calls.length;
  await message(page, 'I feel dizzy during my set');
  await expect(page.getByText(/stop.*set|stop.*exercise|stop.*training/i).first()).toBeVisible();
  expect(fixture.calls.length).toBe(count);
  expect(allSets(await saved(page))).toHaveLength(0);
});

for (const interruption of ['stop', 'My knee hurts']) {
  test(`typed "${interruption}" preempts a pending model reply and ignores its late proposal`, async ({ page }) => {
    await message(page, 'Open the camera for squats');
    await expect(page.getByTestId('chat-panel-camera')).toBeVisible();
    const lateResponse = page.waitForResponse(response => response.url() === `${fixture.url}/chat` && response.request().method() === 'POST');
    const before = fixture.calls.length;
    await message(page, 'Please make a slow upstream request');
    await expect.poll(() => fixture.calls.length).toBeGreaterThan(before);
    await page.getByLabel('Message Jim', { exact: true }).fill(interruption);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('chat-panel-camera')).toHaveCount(0);
    await lateResponse;
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    expect(allSets(await saved(page))).toHaveLength(0);
    await expect(page.getByLabel('Message Jim', { exact: true })).toBeEditable();
  });
}

test('new chat unmounts the camera and removes pending proposals', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await message(page, 'Open the camera for squats');
  await expect(page.locator('iframe[title="Camera and pose tracking"]')).toBeVisible();
  await message(page, 'Log 8 squats at 20 kg');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('chat-panel-camera')).toHaveCount(0);
  await expect(page.locator('iframe[title="Camera and pose tracking"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
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
    await page.screenshot({ path: testInfo.outputPath(`welcome-${width}.png`), fullPage: true });
    await testInfo.attach(`welcome-${width}`, { path: testInfo.outputPath(`welcome-${width}.png`), contentType: 'image/png' });
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
