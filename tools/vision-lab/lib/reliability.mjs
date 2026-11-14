// Landmark reliability for one clip: how trustworthy the pose input itself was, independent of the
// rep counter. Uses the same joints the app's analyzer reads for the movement.
//   trackedPct      frames where the better side's joints + anchor have visibility >= 0.5
//   joints          mean visibility per joint (best of left/right per frame)
//   jitterTorsoPct  20th percentile of frame-to-frame joint displacement, % of torso length
//                   (a noise floor: most frames include real motion, the quietest fifth mostly doesn't)
//   dropouts        runs of >= 3 consecutive untracked frames
//   jumps           frames where a joint moved > 50% of a torso length (likely identity swap or glitch)
import { anchorFor, jointsFor } from '../../../apps/expo/src/lib/angles.js';

const NAMES = { 11: 'shoulder', 13: 'elbow', 15: 'wrist', 23: 'hip', 25: 'knee', 27: 'ankle' };
const VIS = 0.5;
const DROPOUT_FRAMES = 3;
const JUMP_TORSO = 0.5;

const vis = (p) => p?.visibility ?? 0;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function landmarkReliability(frames, movement) {
  const sides = jointsFor(movement);
  const anchors = anchorFor(movement);
  const idx = (side) => [...sides[side], anchors[side]];
  const leftIdx = idx('left');
  const joints = {};
  let tracked = 0;
  let run = 0;
  let dropouts = 0;
  let jumps = 0;
  const moves = [];
  let prev = null;
  for (const f of frames) {
    const pose = f.pose;
    const best = pose ? (Math.min(...idx('right').map((i) => vis(pose[i]))) > Math.min(...leftIdx.map((i) => vis(pose[i]))) ? 'right' : 'left') : null;
    const ok = Boolean(pose) && Math.min(...idx(best).map((i) => vis(pose[i]))) >= VIS;
    if (ok) {
      tracked += 1;
      if (run >= DROPOUT_FRAMES) dropouts += 1;
      run = 0;
    } else run += 1;
    if (pose) {
      leftIdx.forEach((li) => {
        const name = NAMES[li] ?? String(li);
        const v = Math.max(vis(pose[li]), vis(pose[li + 1]));
        (joints[name] ??= { sum: 0, n: 0 }).sum += v;
        joints[name].n += 1;
      });
    }
    if (ok && prev) {
      const sh = pose[best === 'left' ? 11 : 12];
      const hip = pose[best === 'left' ? 23 : 24];
      const torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
      if (torso > 0.01) {
        const d = Math.max(...idx(best).map((i) => Math.hypot(pose[i].x - prev[i].x, pose[i].y - prev[i].y))) / torso;
        moves.push(d);
        if (d > JUMP_TORSO) jumps += 1;
      }
    }
    prev = ok ? pose : null;
  }
  if (run >= DROPOUT_FRAMES) dropouts += 1;
  const p20 = quantile(moves, 0.2);
  return {
    frames: frames.length,
    trackedPct: pct(tracked, frames.length),
    joints: Object.fromEntries(Object.entries(joints).map(([k, { sum, n }]) => [k, { meanVisibility: Math.round((100 * sum) / n) / 100 }])),
    jitterTorsoPct: p20 == null ? null : Math.round(1000 * p20) / 10,
    dropouts,
    jumps,
  };
}
