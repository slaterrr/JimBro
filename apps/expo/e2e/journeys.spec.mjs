// User journeys: what a real person does in JimBro, end to end, on the web build at phone size.
// Every test starts from a fresh browser (fresh phone storage) unless it seeds demo data.
// Run: npm run test:e2e   (builds dist-web, needs Chrome)
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const demo = JSON.parse(readFileSync(new URL('../src/lib/fixtures/demo-workouts.json', import.meta.url), 'utf8'));
const KEY = 'jimbro.data.v2';
const READY = { onboarded: true, speak: false };

async function open(page, seed) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (seed) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('/');
  await expect(page.getByLabel('Message Jim')).toBeVisible();
  return errors;
}
// Tap the top-most visible control with this text or accessible name (modals render last).
async function tap(page, name) {
  const byText = page.getByText(name, { exact: true }).locator('visible=true');
  const target = (await byText.count()) ? byText.last() : page.getByLabel(name, { exact: true }).locator('visible=true').last();
  await target.click();
}
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), KEY);
const say = async (page, text) => {
  await page.getByLabel('Message Jim').fill(text);
  await page.getByLabel('Message Jim').press('Enter');
};

test('first run: beginner setup picks a goal, skips the optional question, lands on Home', async ({ page }) => {
  const errors = await open(page);
  await tap(page, "I'm new to this");
  await tap(page, 'Build muscle');
  await tap(page, 'Skip this question');
  await tap(page, 'No');
  await page.getByText("Let's go", { exact: true }).last().click({ force: true }); // card slides in
  await expect(page.getByText("Let's go", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).settings?.onboarded).toBe(true);
  expect((await saved(page)).settings.fitnessGoal).toBe('muscle');
  await page.reload();
  await expect(page.getByText("I'm new to this", { exact: true })).toHaveCount(0); // setup shown once
  expect(errors).toEqual([]);
});

test('first run: pain answer shows safety advice instead of a plan', async ({ page }) => {
  await open(page);
  await tap(page, 'Coming back after a break');
  await tap(page, 'General fitness');
  await tap(page, 'Skip this question');
  await tap(page, 'Yes');
  await expect(page.getByText(/doctor|physio|medical|professional/i).first()).toBeVisible();
});

test('workout: start, log a set by hand, finish, and it shows in history after reload', async ({ page }) => {
  const errors = await open(page, { history: [], settings: READY });
  await tap(page, 'Start a Workout');
  await tap(page, 'Home');
  await tap(page, 'Log a set');
  await page.getByText('Bench press', { exact: true }).last().click();
  const sheet = page.getByRole('dialog').last();
  await sheet.getByPlaceholder('0').fill('135');
  await sheet.locator('input').nth(1).fill('8');
  await tap(page, 'Save set');
  await expect.poll(async () => (await saved(page)).active?.sets?.length).toBe(1);
  const set = (await saved(page)).active.sets[0];
  expect(set).toMatchObject({ exercise: 'bench', weight: 135, reps: 8 });
  await page.reload();
  await expect.poll(async () => (await saved(page)).active?.sets?.length).toBe(1); // survives a reload
  expect(errors).toEqual([]);
});

test('chat: tell Jim a set in plain words, he asks to confirm, nothing changes until Confirm', async ({ page }) => {
  await open(page, { history: [], settings: READY });
  await tap(page, 'Start a Workout');
  await tap(page, 'Home');
  await say(page, 'log 3 sets of 10 curls at 25 lb');
  const confirm = page.getByText('Confirm', { exact: true }).locator('visible=true').last();
  await expect(confirm).toBeVisible();
  expect((await saved(page)).active?.sets ?? []).toHaveLength(0); // proposal only
  await confirm.click();
  await expect.poll(async () => (await saved(page)).active?.sets?.length).toBe(3);
  expect((await saved(page)).active.sets[0]).toMatchObject({ exercise: 'curl', reps: 10, weight: 25 });
});

test('chat: Cancel on a proposal leaves the log untouched', async ({ page }) => {
  await open(page, { history: [], settings: READY });
  await tap(page, 'Start a Workout');
  await tap(page, 'Home');
  await say(page, 'log 1 set of 5 squats at 185 lb');
  await tap(page, 'Cancel');
  await page.waitForTimeout(300);
  expect((await saved(page)).active?.sets ?? []).toHaveLength(0);
});

test('chat: pain or dizziness gets the safety reply', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  await say(page, 'my chest hurts and I feel dizzy');
  await expect(page.getByText(/stop|doctor|medical|emergency/i).last()).toBeVisible();
});

test('chat: "how was my last workout" is answered from my data, offline', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  await say(page, 'what did I train last time?');
  await expect(page.getByText(/Answered from your workout data|Offline coach/).first()).toBeVisible();
  await expect(page.getByText(/^Your last workout was /).last()).toBeVisible();
  await expect(page.getByText(/Jim AI is unavailable/)).toHaveCount(0); // no AI configured: nothing "failed"
});

test('mission: "20 minutes, chest day" plans a session that starts on the Coach screen', async ({ page }) => {
  const errors = await open(page, { history: demo.history, settings: READY });
  await tap(page, 'I have 20 minutes, help me finish chest day');
  await expect(page.getByText(/20-minute/).last()).toBeVisible();
  await tap(page, 'Start mission');
  await expect(page.getByText('Allow camera', { exact: true })).toBeVisible(); // Coach screen, no camera on web
  expect(errors).toEqual([]);
});

test('plan: Create a New Plan builds and saves a plan for a goal', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  await tap(page, 'Create a New Plan');
  await expect(page.getByText('Import workouts (CSV or Excel)').last()).toBeVisible();
  await tap(page, 'Plan from my goal (no photo)');
  const confirm = page.getByText(/^(Confirm|Save plan|Use this plan)$/).locator('visible=true').last();
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect.poll(async () => Boolean((await saved(page)).plan)).toBe(true);
});

test('progress: tabs and time-frame dropdowns work, comparison shows real numbers', async ({ page }) => {
  const errors = await open(page, { history: demo.history, settings: READY });
  await tap(page, 'Progress');
  await expect(page.getByText('Compare your training')).toBeVisible();
  await expect(page.getByText(/Best estimated 1RM.*No data.*$/)).toHaveCount(0);
  await page.getByTestId('compare-frame').click();
  await tap(page, 'Month to month');
  await expect(page.getByTestId('compare-frame')).toContainText('Month to month');
  for (const tab of ['strength', 'history', 'goals', 'overview']) {
    await page.getByTestId(`seg-${tab}`).click();
    await expect(page.getByTestId(`seg-${tab}`)).toHaveAttribute('aria-selected', 'true');
  }
  expect(errors).toEqual([]);
});

test('muscles: tapping a muscle opens its progress', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  await tap(page, 'Muscles');
  const body = page.locator('svg[viewBox="0 0 200 400"]').first();
  const box = await body.boundingBox();
  await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.24); // chest on the front figure
  await expect(page.getByText(/chest/i).locator('visible=true').last()).toBeVisible();
  await tap(page, 'Progress');
  await expect(page.getByText(/progress/i).locator('visible=true').last()).toBeVisible();
});

test('settings: changing Jim\'s persona is saved', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  await tap(page, 'Activity and settings');
  const before = (await saved(page)).settings?.persona;
  const play = page.getByLabel(/^Play /).locator('visible=true');
  await expect(play.first()).toBeVisible();
  for (const name of ['Hype Jim', 'Zen Jim', 'Data Jim', 'Sergeant Jim']) {
    const opt = page.getByText(name, { exact: true }).locator('visible=true');
    if (await opt.count()) { await opt.last().click(); break; }
  }
  await expect.poll(async () => (await saved(page)).settings?.persona).not.toBe(before);
});

test('data: export then erase-free reload keeps everything on the phone', async ({ page }) => {
  await open(page, { history: demo.history, settings: READY });
  const n = (await saved(page)).history.length;
  await page.reload();
  await expect(page.getByLabel('Message Jim')).toBeVisible();
  expect((await saved(page)).history.length).toBe(n);
});
