#!/usr/bin/env node
// MP4 → production MediaPipe → JimBro LiveSession → scored report.
//
//   node run.mjs                        every labels/*.json (dev + heldout)
//   node run.mjs --split dev            only one split
//   node run.mjs --clip curl_01         one labeled clip
//   node run.mjs --model full           compare MediaPipe Full against the production Lite
//   node run.mjs --video x.mp4 --movement curl     unlabeled: landmarks + predictions only
//
// Landmarks are cached per (clip, model, fps) so counter changes replay in milliseconds.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replay, scoreClip, summarize, TOLERANCE_MS } from './lib/evaluate.mjs';
import { renderReport } from './lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg('fps', 20)); // the app samples ~20 fps
const MODEL = arg('model', 'lite');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(arg('out', join(HERE, 'runs', `${stamp}-${MODEL}`)));

function clips() {
  if (arg('video')) {
    const video = resolve(arg('video'));
    return [{ id: basename(video).replace(/\.\w+$/, ''), video, movement: arg('movement', 'curl'), split: 'unlabeled', reps: null }];
  }
  const dir = join(HERE, 'labels');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { id: f.replace(/\.json$/, ''), ...l, video: resolve(HERE, 'videos', l.video) };
  }).filter((c) => (!arg('split') || c.split === arg('split')) && (!arg('clip') || c.id === arg('clip')));
}

function extractFrames(video, dir) {
  if (existsSync(join(dir, '00001.jpg'))) return;
  mkdirSync(dir, { recursive: true });
  // Constant-rate resample makes frame i ↔ t = i*1000/FPS exact and repeatable.
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=${FPS}`, '-q:v', '3', join(dir, '%05d.jpg')]);
}

async function landmarks(clip, lm) {
  const cache = join(HERE, 'runs', 'cache', `${clip.id}.${MODEL}.${FPS}fps.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const frameDir = join(HERE, 'runs', 'cache', `${clip.id}.${FPS}fps`);
  extractFrames(clip.video, frameDir);
  const files = readdirSync(frameDir).filter((f) => f.endsWith('.jpg')).sort();
  const out = [];
  await (await lm()).reset();
  for (const [i, f] of files.entries()) {
    out.push({ ...(await (await lm()).detect(join(frameDir, f), Math.round((i * 1000) / FPS))), frame: join(frameDir, f) });
  }
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

// The app posts {x, y, visibility} rounded to 4/3 dp; replay exactly that.
const asApp = (pose) => pose?.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), visibility: +p.visibility.toFixed(3) })) ?? null;

async function main() {
  let session = null;
  const lm = async () => {
    if (!session) session = await (await import('./lib/mediapipe.mjs')).openLandmarker({ variant: MODEL });
    return session;
  };
  const rows = [];
  mkdirSync(OUT, { recursive: true });
  for (const clip of clips()) {
    const raw = await landmarks(clip, lm);
    const r = replay(clip.movement, raw.map((f) => ({ t: f.t, pose: asApp(f.pose) })));
    const trueEnds = clip.reps?.map((x) => x.end_ms) ?? null;
    const score = trueEnds ? scoreClip({ trueEnds, predEnds: r.predEnds }) : null;
    const infer = raw.map((f) => f.inferMs).filter(Number.isFinite).sort((a, b) => a - b);
    const row = {
      id: clip.id, movement: clip.movement, split: clip.split, adversarial: Boolean(clip.adversarial),
      trueReps: trueEnds?.length ?? null, predicted: r.predEnds.length,
      ...(score ?? { tp: 0, fp: 0, fn: 0 }), scored: Boolean(score),
      trackingOkRatio: r.trackingOkRatio, noPoseRatio: raw.filter((f) => !f.pose).length / raw.length,
      issues: r.frames.reduce((a, f) => (f.issue ? { ...a, [f.issue]: (a[f.issue] ?? 0) + 1 } : a), {}),
      inferMsP50: infer[Math.floor(infer.length / 2)] ?? null, inferMsP95: infer[Math.floor(infer.length * 0.95)] ?? null,
    };
    rows.push(row);
    const dir = join(OUT, clip.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'replay.json'), JSON.stringify({ clip: { ...clip, video: relative(dir, clip.video) }, row, predEnds: r.predEnds, frames: r.frames, reps: r.reps }, null, 1));
    // Annotated failure frames: false reps, missed reps, and onset of tracking loss.
    const failures = [
      ...(score?.false ?? []).map((t) => ({ t, kind: 'false_rep' })),
      ...(score?.missed ?? []).map((t) => ({ t, kind: 'missed_rep' })),
      ...r.frames.filter((f, i) => f.tracking !== 'ok' && r.frames[i - 1]?.tracking === 'ok').slice(0, 10).map((f) => ({ t: f.t, kind: 'tracking_lost' })),
    ];
    if (failures.length) {
      const { annotate } = await import('./lib/report.mjs');
      await annotate((await lm()).page, dir, raw, r.frames, failures);
    }
    writeFileSync(join(dir, 'report.html'), renderReport({ clip: { ...clip, video: relative(dir, clip.video).replaceAll('\\', '/') }, raw, replayed: r, score, failures, fps: FPS, model: MODEL }));
    console.log(`${clip.id.padEnd(28)} true=${row.trueReps ?? '-'} pred=${row.predicted} tp=${row.tp} fp=${row.fp} fn=${row.fn} trackOK=${(row.trackingOkRatio * 100).toFixed(0)}%`);
  }
  const summary = { model: MODEL, fps: FPS, toleranceMs: TOLERANCE_MS, createdAt: new Date().toISOString(), splits: summarize(rows.filter((r) => r.scored)), clips: rows };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary.splits, null, 1));
  console.log(`report: ${OUT}`);
  await session?.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
