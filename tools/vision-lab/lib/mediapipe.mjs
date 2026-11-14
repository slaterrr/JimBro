// Runs the production MediaPipe PoseLandmarker (same version, model and options as the app's
// WebView) in headless Chrome over pre-extracted video frames. Timestamps are synthetic
// (frame index / fps), so replay is deterministic and independent of machine speed.
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

import { MEDIAPIPE_CDN, POSE_MODEL_URL } from '../../../apps/expo/src/lib/poseHtml.js';

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const modelUrl = (variant = 'lite') => POSE_MODEL_URL.replaceAll('lite', variant);

export async function openLandmarker({ variant = 'lite', delegate = 'CPU' } = {}) {
  const { existsSync } = await import('node:fs');
  const executablePath = CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('about:blank');
  // A fresh graph per clip: VIDEO mode keeps temporal tracking state and requires
  // increasing timestamps, so reuse across clips would leak state between them.
  const reset = () => page.evaluate(async (cdn, model, delegate) => {
    const { FilesetResolver, PoseLandmarker } = await import(`${cdn}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${cdn}/wasm`);
    window.lm?.close();
    // Same options as the app: VIDEO mode, one pose, default confidence thresholds.
    window.lm = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numPoses: 1,
    });
  }, MEDIAPIPE_CDN, modelUrl(variant), delegate);
  await reset();

  const detect = (jpegPath, t) => page.evaluate(async (b64, t) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const t0 = performance.now();
    const res = window.lm.detectForVideo(bmp, t);
    const ms = performance.now() - t0;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    const img = res.landmarks?.[0]?.map((p) => ({ x: r4(p.x), y: r4(p.y), z: r4(p.z), visibility: r4(p.visibility ?? 0) })) ?? null;
    const world = res.worldLandmarks?.[0]?.map((p) => ({ x: r4(p.x), y: r4(p.y), z: r4(p.z) })) ?? null;
    return { t, pose: img, world, inferMs: Math.round(ms * 100) / 100, w: bmp.width, h: bmp.height };
  }, readFileSync(jpegPath).toString('base64'), t);

  return { detect, reset, page, close: () => browser.close() };
}
