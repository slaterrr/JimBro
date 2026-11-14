#!/usr/bin/env node
// Real-video validation over landmark clips (no video needed): scores every clip through the app's
// vision engine API, measures landmark reliability, and prints real and simulated results apart.
//
//   node validate.mjs                         # fixtures/ + recordings/
//   node validate.mjs recordings/my_set.json  # specific clips
//   node validate.mjs --split heldout --tol 600 --out runs/validation
//   node validate.mjs --cross     # also replay every clip in every other camera mode (false counts)
//
// Clips come from: fixtures/*.landmarks.json (extracted from licensed videos by run.mjs), or
// recordings/*.json saved by record.html (live camera, landmarks only, consented).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ANALYZERS, countsWithCamera } from '../../apps/expo/src/lib/analyzers.js';
import { aggregate, loadClip, validateClip } from './lib/validation.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flags = new Set(['--split', '--tol', '--out']);
const paths = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
const here = new URL('.', import.meta.url).pathname;
const inputs = paths.length ? paths : ['fixtures', 'recordings'].map((d) => join(here, d)).filter(existsSync);
const files = inputs.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)) : [p]));

const split = opt('split', null);
const tol = Number(opt('tol', 600));
const rows = [];
for (const f of files) {
  const clip = loadClip(JSON.parse(readFileSync(f, 'utf8')));
  if (args.includes('--cross')) clip.wrongModes = Object.keys(ANALYZERS).filter((m) => countsWithCamera(m) && m !== clip.movement);
  if (!clip.movement || !clip.frames.length) { console.warn(`skip ${f}: no movement or frames`); continue; }
  if (split && clip.split !== split) continue;
  try {
    rows.push(validateClip(clip, { tol }));
  } catch (e) {
    console.warn(`skip ${f}: ${e.message}`); // e.g. a manual exercise (no camera analyzer)
  }
}
const agg = aggregate(rows);

const pad = (s, n) => String(s ?? '–').padEnd(n);
const lines = [];
lines.push(`# Validation: ${rows.length} clip(s), tolerance ${tol} ms${split ? `, split ${split}` : ''}`, '');
lines.push('| clip | source | exercise | view | split | analyzer | labeled | counted | TP | FP | FN | tracked % | jitter % torso | dropouts | mismatches | wrong-mode false |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push(`| ${[r.clip, r.source, r.movement, r.view, r.split, r.validation, r.labeled, r.counted, r.tp, r.fp, r.fn, r.reliability.trackedPct, r.reliability.jitterTorsoPct, r.reliability.dropouts, r.mismatches.length, r.wrongMode.map((w) => `${w.mode}:${w.falseCounts}`).join(' ') || '–'].join(' | ')} |`);
}
for (const src of ['real', 'sim', 'unknown']) {
  const per = agg[src];
  if (!Object.keys(per).length) continue;
  lines.push('', `## ${src === 'real' ? 'REAL clips' : src === 'sim' ? 'SIMULATED clips (logic only, not accuracy)' : 'Clips of unknown origin (not counted as real)'}`, '');
  lines.push('| exercise | clips | labeled | counted | precision | recall | false on adversarial | mean abs count error | wrong-mode false/runs | mean tracked % |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [mv, t] of Object.entries(per)) {
    lines.push(`| ${[mv, t.clips, t.labeled, t.counted, t.precision, t.recall, t.adversarialFalse, t.meanAbsCountError, `${t.wrongModeFalse}/${t.wrongModeRuns}`, t.meanTrackedPct].join(' | ')} |`);
  }
}
lines.push('', 'Small samples: report counts, not accuracy claims. Never tune on `heldout` clips.');
const md = lines.join('\n');
console.log(md);

const out = opt('out', null);
if (out) {
  mkdirSync(resolve(out), { recursive: true });
  writeFileSync(join(resolve(out), 'validation.json'), JSON.stringify({ tol, split, rows, aggregate: agg }, null, 2));
  writeFileSync(join(resolve(out), 'validation.md'), md);
  console.log(`\nwrote ${join(resolve(out), 'validation.{json,md}')}`);
}
void pad;
