// Form review: measurable, side-view rules over one rep's landmark frames (no video).
// Every rule reports the measured number next to its threshold. Thresholds are
// HYPOTHESES from coaching convention, not validated on real camera data yet; tune them
// against labelled clips before trusting severities. Based on landmarks, not medical advice.
import { jointAngle } from './angles.js';

export const THRESHOLDS = {
  curl: {
    upperArmSwingDeg: 25, // elbow–shoulder–hip angle; strict curls keep the upper arm near vertical
    topElbowDeg: 70, // min elbow angle; a full squeeze reaches roughly 40–60°
    bottomElbowDeg: 150, // max elbow angle; full extension is ~160–175°
    minEccentricS: 0.6, // lowering faster than this is mostly a drop, not a controlled negative
    torsoSwingRatio: 0.3, // shoulder horizontal travel / torso length
  },
  squat: {
    depthKneeDeg: 100, // min knee angle; ~90–100° is about thigh parallel from the side
    forwardLeanDeg: 50, // torso (hip→shoulder) angle from vertical
    minDescentS: 0.6,
  },
  shoulder_press: {
    lockoutElbowDeg: 155, // max elbow angle at the top
    leanBackDeg: 20, // shoulder–hip line tilt from vertical
    bottomElbowDeg: 100, // min elbow angle; the bar/dumbbells should come down to about chin height
  },
};
// A fault is 'major' when it is this far past its threshold (same units).
const MAJOR_MARGIN = { deg: 15, s: 0.25, ratio: 0.2 };
const MIN_VIS = 0.5;
const MAX_LOW_FRACTION = 0.2; // more than 20% low-visibility frames → don't judge the rep
const MIN_FRAMES = 6;
const BAND = 0.05; // fraction of range of motion treated as "at the end" for timing

const IDX = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};
const TRACKED = {
  curl: ['shoulder', 'elbow', 'wrist', 'hip'],
  shoulder_press: ['shoulder', 'elbow', 'wrist', 'hip'],
  squat: ['shoulder', 'hip', 'knee', 'ankle'],
};

/** Coaching text per fault id. */
export const FAULT_TEXT = {
  upper_arm_swing: {
    title: 'Elbow swing',
    joint: ['elbow', 'shoulder', 'hip'],
    why: 'When the upper arm swings forward, the front shoulder takes over part of the lift and momentum carries the weight, so the biceps do less work through the hardest range. It also loads the front of the shoulder.',
    fix: ['Pin your elbows lightly against your sides before the first rep.', 'Only the forearm should move; imagine your elbow is a door hinge.', 'If you cannot finish a rep without swinging, drop the weight a step.'],
    cue: 'Elbows glued to your sides.',
  },
  incomplete_top: {
    title: 'Short top',
    joint: ['shoulder', 'elbow', 'wrist'],
    why: 'Stopping before the top skips the shortest, most contracted position of the biceps, where much of the peak tension is built.',
    fix: ['Curl until your forearm is close to vertical and squeeze for a moment.', 'Keep the elbow still while you finish the curl, rather than bringing it forward.', 'Use a weight you can bring all the way up.'],
    cue: 'All the way up, squeeze.',
  },
  incomplete_bottom: {
    title: 'Short bottom',
    joint: ['shoulder', 'elbow', 'wrist'],
    why: 'Not straightening the arm skips the stretched part of the curl, which trains the biceps through less of their range and is linked to smaller strength gains at long lengths.',
    fix: ['Lower until your arm is almost straight, without locking hard.', 'Pause a beat at the bottom before the next rep.', 'Reduce the weight if the bottom feels unmanageable.'],
    cue: 'Full stretch at the bottom.',
  },
  fast_lowering: {
    title: 'Fast lowering',
    joint: ['shoulder', 'elbow', 'wrist'],
    why: 'Dropping the weight wastes the lowering (eccentric) half, which builds a large share of the muscle stimulus, and lets the elbow joint absorb a sudden stop at the bottom.',
    fix: ['Count about two seconds on the way down.', 'Keep tension: stop just short of fully relaxing at the bottom.', 'Breathe in as you lower, out as you curl.'],
    cue: 'Two seconds down.',
  },
  torso_swing: {
    title: 'Body swing',
    joint: ['hip', 'shoulder', 'elbow'],
    why: 'Rocking the torso or driving with the hips uses momentum to move the weight, taking load off the biceps and putting the lower back under repeated swinging.',
    fix: ['Brace your stomach and squeeze your glutes before you curl.', 'Stand with knees soft, or put your back against a wall.', 'Lighten the weight until the torso stays still.'],
    cue: 'Stand tall, only the arms move.',
  },
  shallow_depth: {
    title: 'Shallow depth',
    joint: ['hip', 'knee', 'ankle'],
    why: 'Stopping high trains the quads and glutes through only part of their range and builds less strength in the bottom position that daily life and sport rely on.',
    fix: ['Sit down until your hip crease is about level with or below the knee.', 'Push your knees out over your toes as you descend.', 'If depth is limited, try heels on a small plate or a lighter load.'],
    cue: 'Sit down to the box.',
  },
  forward_lean: {
    title: 'Forward lean',
    joint: ['shoulder', 'hip', 'knee'],
    why: 'A torso folding far forward shifts the load from the legs to the lower back and hips, and makes it harder to keep the spine neutral as the weight increases.',
    fix: ['Keep your chest up and eyes forward.', 'Brace your core hard before descending.', 'Let the knees travel forward over the toes so the hips stay under you.'],
    cue: 'Chest up, brace.',
  },
  fast_descent: {
    title: 'Fast descent',
    joint: ['hip', 'knee', 'ankle'],
    why: 'Dropping fast into the bottom makes it harder to control knee and hip position and relies on a bounce rather than the muscles.',
    fix: ['Take about two seconds to go down.', 'Stay tight at the bottom instead of bouncing.', 'Drive up once you are in control.'],
    cue: 'Control the way down.',
  },
  incomplete_lockout: {
    title: 'Partial lockout',
    joint: ['shoulder', 'elbow', 'wrist'],
    why: 'Stopping short of a straight arm overhead leaves out the top range where the triceps and upper traps finish the press and stabilise the shoulder.',
    fix: ['Press until your arms are straight and the weight is over the middle of your head.', 'Shrug slightly up at the top to finish.', 'Lower the weight if you cannot reach full extension.'],
    cue: 'Punch the ceiling.',
  },
  lean_back: {
    title: 'Leaning back',
    joint: ['shoulder', 'hip', 'knee'],
    why: 'Leaning back turns the overhead press into an incline press and arches the lower back, compressing the lumbar spine under load.',
    fix: ['Squeeze your glutes and brace your stomach before each rep.', 'Keep your ribs down; move your head back to let the weight pass, not your hips forward.', 'Drop the load if you need to lean to finish.'],
    cue: 'Ribs down, glutes tight.',
  },
  partial_bottom: {
    title: 'Partial bottom',
    joint: ['shoulder', 'elbow', 'wrist'],
    why: 'Not lowering to about chin height shortens the range the shoulders and triceps work through, so you build less strength from the start position.',
    fix: ['Lower until your hands are around chin or upper-chest height.', 'Keep your forearms vertical at the bottom.', 'Pause briefly before pressing again.'],
    cue: 'Down to your chin.',
  },
};

const angleAt = (pose, side, [a, b, c]) => {
  const k = IDX[side];
  return jointAngle(pose[k[a]], pose[k[b]], pose[k[c]]);
};
/** Torso (hip→shoulder) angle from vertical in degrees. */
const torsoTilt = (pose, side) => {
  const s = pose[IDX[side].shoulder];
  const h = pose[IDX[side].hip];
  return (Math.atan2(Math.abs(s.x - h.x), Math.abs(h.y - s.y)) * 180) / Math.PI;
};

function pickSide(movement, frames) {
  const score = (side) => frames.reduce((acc, f) => acc + Math.min(...TRACKED[movement].map((j) => f.pose?.[IDX[side][j]]?.visibility ?? 0)), 0);
  return score('right') > score('left') ? 'right' : 'left';
}

/** Seconds from the last frame near startExtreme to the first later frame near endExtreme. */
function phaseSeconds(series, { start, end, startExtreme, endExtreme, band }) {
  let leave = -1;
  for (let i = start; i <= end; i++) if (Math.abs(series[i].v - startExtreme) <= band) leave = i;
  if (leave < 0) return null;
  for (let i = leave; i <= end; i++) {
    if (Math.abs(series[i].v - endExtreme) <= band) return { s: (series[i].t - series[leave].t) / 1000, t: series[leave].t };
  }
  return null;
}

function fault(id, { t, measured, threshold, unit, worse }) {
  const over = worse === 'below' ? threshold - measured : measured - threshold;
  const text = FAULT_TEXT[id];
  return {
    id, severity: over >= MAJOR_MARGIN[unit] ? 'major' : 'minor', t, measured, threshold, unit,
    title: text.title, why: text.why, fix: text.fix, cue: text.cue, joint: text.joint,
  };
}

const argmax = (xs) => xs.reduce((b, x, i) => (x > xs[b] ? i : b), 0);
const argmin = (xs) => xs.reduce((b, x, i) => (x < xs[b] ? i : b), 0);

/**
 * Analyse one rep. frames: [{t ms, pose: 33 {x,y,visibility}}].
 * Returns {faults, ok, side} or {uncertain: true, faults: [], ok: false} when tracking was weak.
 */
export function analyzeRep(movement, frames) {
  const th = THRESHOLDS[movement];
  if (!th) throw new Error(`no form rules for ${movement}`);
  const uncertain = { uncertain: true, faults: [], ok: false };
  const valid = (frames ?? []).filter((f) => f?.pose?.length >= 33);
  if (valid.length < MIN_FRAMES) return uncertain;
  const side = pickSide(movement, valid);
  const good = valid.filter((f) => TRACKED[movement].every((j) => (f.pose[IDX[side][j]]?.visibility ?? 0) >= MIN_VIS));
  if ((valid.length - good.length) / valid.length > MAX_LOW_FRACTION || good.length < MIN_FRAMES) return uncertain;

  const faults = [];
  const ts = good.map((f) => f.t);
  const tilt = good.map((f) => torsoTilt(f.pose, side));

  if (movement === 'curl' || movement === 'shoulder_press') {
    const elbow = good.map((f) => angleAt(f.pose, side, ['shoulder', 'elbow', 'wrist']) ?? NaN);
    if (elbow.some((x) => !Number.isFinite(x))) return uncertain;
    const iMin = argmin(elbow);
    const iMax = argmax(elbow);
    if (movement === 'curl') {
      const swing = good.map((f) => angleAt(f.pose, side, ['elbow', 'shoulder', 'hip']) ?? 0);
      const iS = argmax(swing);
      if (swing[iS] > th.upperArmSwingDeg) faults.push(fault('upper_arm_swing', { t: ts[iS], measured: Math.round(swing[iS]), threshold: th.upperArmSwingDeg, unit: 'deg' }));
      if (elbow[iMin] > th.topElbowDeg) faults.push(fault('incomplete_top', { t: ts[iMin], measured: Math.round(elbow[iMin]), threshold: th.topElbowDeg, unit: 'deg' }));
      if (elbow[iMax] < th.bottomElbowDeg) faults.push(fault('incomplete_bottom', { t: ts[iMax], measured: Math.round(elbow[iMax]), threshold: th.bottomElbowDeg, unit: 'deg', worse: 'below' }));
      // Eccentric: from leaving the top (near min angle) to arriving at the bottom (near max).
      const series = good.map((f, i) => ({ t: f.t, v: elbow[i] }));
      const band = BAND * (elbow[iMax] - elbow[iMin]);
      const ecc = phaseSeconds(series, { start: iMin, end: series.length - 1, startExtreme: elbow[iMin], endExtreme: Math.max(...elbow.slice(iMin)), band });
      if (ecc && ecc.s < th.minEccentricS) faults.push(fault('fast_lowering', { t: ecc.t, measured: Math.round(ecc.s * 100) / 100, threshold: th.minEccentricS, unit: 's', worse: 'below' }));
      const torso = good.reduce((a, f) => a + Math.hypot(f.pose[IDX[side].shoulder].x - f.pose[IDX[side].hip].x, f.pose[IDX[side].shoulder].y - f.pose[IDX[side].hip].y), 0) / good.length;
      const sx = good.map((f) => f.pose[IDX[side].shoulder].x);
      const travel = (Math.max(...sx) - Math.min(...sx)) / torso;
      if (torso > 0 && travel > th.torsoSwingRatio) {
        const x0 = sx[0];
        const iW = argmax(sx.map((x) => Math.abs(x - x0)));
        faults.push(fault('torso_swing', { t: ts[iW], measured: Math.round(travel * 100) / 100, threshold: th.torsoSwingRatio, unit: 'ratio' }));
      }
    } else {
      if (elbow[iMax] < th.lockoutElbowDeg) faults.push(fault('incomplete_lockout', { t: ts[iMax], measured: Math.round(elbow[iMax]), threshold: th.lockoutElbowDeg, unit: 'deg', worse: 'below' }));
      const iT = argmax(tilt);
      if (tilt[iT] > th.leanBackDeg) faults.push(fault('lean_back', { t: ts[iT], measured: Math.round(tilt[iT]), threshold: th.leanBackDeg, unit: 'deg' }));
      if (elbow[iMin] > th.bottomElbowDeg) faults.push(fault('partial_bottom', { t: ts[iMin], measured: Math.round(elbow[iMin]), threshold: th.bottomElbowDeg, unit: 'deg' }));
    }
  } else {
    const knee = good.map((f) => angleAt(f.pose, side, ['hip', 'knee', 'ankle']) ?? NaN);
    if (knee.some((x) => !Number.isFinite(x))) return uncertain;
    const iMin = argmin(knee);
    if (knee[iMin] > th.depthKneeDeg) faults.push(fault('shallow_depth', { t: ts[iMin], measured: Math.round(knee[iMin]), threshold: th.depthKneeDeg, unit: 'deg' }));
    const iT = argmax(tilt);
    if (tilt[iT] > th.forwardLeanDeg) faults.push(fault('forward_lean', { t: ts[iT], measured: Math.round(tilt[iT]), threshold: th.forwardLeanDeg, unit: 'deg' }));
    // Descent: from leaving the top (near max knee angle before the bottom) to reaching the bottom.
    const before = knee.slice(0, iMin + 1);
    const top = Math.max(...before);
    const band = BAND * (top - knee[iMin]);
    let leave = -1;
    for (let i = 0; i <= iMin; i++) if (top - knee[i] <= band) leave = i;
    let arrive = -1;
    for (let i = leave; i >= 0 && i <= iMin; i++) if (knee[i] - knee[iMin] <= band) { arrive = i; break; }
    if (leave >= 0 && arrive > leave) {
      const s = (ts[arrive] - ts[leave]) / 1000;
      if (s < th.minDescentS) faults.push(fault('fast_descent', { t: ts[arrive], measured: Math.round(s * 100) / 100, threshold: th.minDescentS, unit: 's', worse: 'below' }));
    }
  }
  return { faults, ok: faults.length === 0, side };
}

/** "Elbow swing · 34° (limit 25°)" */
export function formatFault(f) {
  const u = (x) => (f.unit === 'deg' ? `${x}°` : f.unit === 's' ? `${x}s` : `${x}× torso`);
  return `${f.title} · ${u(f.measured)} (limit ${u(f.threshold)})`;
}

// ---- Proper-form reference: a side-view stick body driven by joint angles -------------------
// Same geometry as tools/vision-lab's simulator (kept inline; app code must not import tools/).
const BONE = { upper: 0.15, fore: 0.14, torso: 0.25, thigh: 0.2, shank: 0.2 };
const rad = (d) => (d * Math.PI) / 180;
const add = (p, len, dirDeg) => ({ x: p.x + len * Math.sin(rad(dirDeg)), y: p.y + len * Math.cos(rad(dirDeg)) });

/** 33-landmark pose from joint angles (upperArm: deg from straight down, forward positive). */
export function stickPose({ upperArm = 0, elbow = 170, knee = 175, cx = 0.5 }) {
  const a = (180 - knee) / 2;
  const ankle = { x: cx, y: 0.92 };
  const kneeP = add(ankle, BONE.shank, 180 - a);
  const hip = add(kneeP, BONE.thigh, 180 + a);
  const shoulder = add(hip, BONE.torso, 180 - a / 2);
  const elbowP = add(shoulder, BONE.upper, upperArm);
  const wrist = add(elbowP, BONE.fore, upperArm + (180 - elbow));
  const head = add(shoulder, 0.09, 180 - a / 2);
  const pose = Array.from({ length: 33 }, () => ({ ...head, visibility: 0.99 }));
  const near = { 11: shoulder, 13: elbowP, 15: wrist, 23: hip, 25: kneeP, 27: ankle };
  for (const [i, p] of Object.entries(near)) {
    pose[+i] = { ...p, visibility: 0.99 };
    pose[+i + 1] = { ...p, visibility: 0.6 };
  }
  return pose;
}

const cycle = (p) => Math.sin(Math.PI * Math.min(1, Math.max(0, p))) ** 2; // rest → peak → rest

export const IDEAL = {
  curl: {
    phase: (p) => stickPose({ upperArm: 5, elbow: 170 - 125 * cycle(p) }),
    checkpoints: [
      'Stand tall, side-on to the camera, elbows by your sides.',
      'Curl until the forearm is near vertical (elbow about 45°) without the elbow drifting forward.',
      'Squeeze briefly at the top.',
      'Lower over about two seconds to an almost straight arm.',
      'Torso stays still the whole rep.',
    ],
  },
  squat: {
    phase: (p) => stickPose({ knee: 175 - 95 * cycle(p) }),
    checkpoints: [
      'Feet about shoulder-width, side-on to the camera, brace before you descend.',
      'Sit down and back over about two seconds.',
      'Reach a knee angle near 90° (hip crease around knee height).',
      'Keep your chest up: torso lean well under 50° from vertical.',
      'Drive up through the whole foot.',
    ],
  },
  shoulder_press: {
    phase: (p) => stickPose({ upperArm: 95 + 75 * cycle(p), elbow: 80 + 85 * cycle(p) }),
    checkpoints: [
      'Start with hands around chin height, forearms vertical.',
      'Brace: ribs down, glutes squeezed.',
      'Press straight up until the arms are straight overhead.',
      'Keep the torso upright, no leaning back.',
      'Lower under control back to chin height.',
    ],
  },
};
