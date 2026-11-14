// Seeded landmark simulator (side view, normalized image coords). It drives a stick body with
// known joint angles, adds camera-like noise, and returns ground-truth rep end times.
// SIMULATED DATA tests counter logic only; it says nothing about real MediaPipe accuracy.

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  return { next, gauss };
}

const BONE = { upper: 0.15, fore: 0.14, torso: 0.25, thigh: 0.2, shank: 0.2 };
const rad = (d) => (d * Math.PI) / 180;
const add = (p, len, dirDeg) => ({ x: p.x + len * Math.sin(rad(dirDeg)), y: p.y + len * Math.cos(rad(dirDeg)) });

/**
 * Pose from joint angles. upperArm: degrees from straight down, positive = forward/up.
 * elbow/knee: interior angles (180 = straight). Left side is the near (tracked) side.
 */
export function body({ upperArm = 0, elbow = 170, knee = 175, cx = 0.5 }) {
  const a = (180 - knee) / 2;
  const ankle = { x: cx, y: 0.92 };
  const kneeP = add(ankle, BONE.shank, 180 - a);
  const hip = add(kneeP, BONE.thigh, 180 + a);
  const shoulder = add(hip, BONE.torso, 180 - a / 2);
  const elbowP = add(shoulder, BONE.upper, upperArm);
  const wrist = add(elbowP, BONE.fore, upperArm + (180 - elbow));
  const pose = Array.from({ length: 33 }, () => ({ x: shoulder.x, y: shoulder.y - 0.1, visibility: 0.99 }));
  const near = { 11: shoulder, 13: elbowP, 15: wrist, 23: hip, 25: kneeP, 27: ankle };
  for (const [i, p] of Object.entries(near)) {
    pose[+i] = { ...p, visibility: 0.98 };
    pose[+i + 1] = { x: p.x + 0.015, y: p.y, visibility: 0.55 }; // far side, partly hidden
  }
  return pose;
}

// Facing the camera: the sagittal motion (knees and hips travelling toward the lens) is lost
// in x; only the vertical projection remains. Left/right joints separate by body width.
const HALF_WIDTH = { 11: 0.09, 13: 0.11, 15: 0.11, 23: 0.06, 25: 0.065, 27: 0.06 };
// armsFrontal: the arms move in the image plane (a shoulder press facing the camera: elbows
// out to the sides), so their side-view forward offset becomes a sideways offset per arm.
export function frontView(pose, cx = 0.5, { armsFrontal = false } = {}) {
  const out = pose.map((p) => ({ ...p }));
  for (const [i, w] of Object.entries(HALF_WIDTH)) {
    out[+i] = { x: cx + w, y: pose[+i].y, visibility: 0.98 }; // subject's left appears on image right
    out[+i + 1] = { x: cx - w, y: pose[+i + 1].y, visibility: 0.98 }; // each side keeps its own height
  }
  if (armsFrontal) {
    for (const i of [13, 15]) {
      out[i].x = out[11].x + (pose[i].x - pose[11].x);
      out[i + 1].x = out[12].x - (pose[i + 1].x - pose[12].x);
    }
  }
  return out;
}

const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

// Angle trajectories per movement: rest → peak → rest.
const MOVES = {
  curl: (p) => ({ upperArm: 5, elbow: 170 - 125 * p }),
  squat: (p) => ({ knee: 175 - 95 * p }),
  shoulder_press: (p) => ({ upperArm: 95 + 75 * p, elbow: 80 + 85 * p }),
};

/**
 * One set. Options: reps, repMs (base duration), slowdown (fraction added by the last rep),
 * rom (1 = full), restMs between reps, noise (sd in normalized units), dropout (per-frame
 * probability the tracked arm/leg visibility collapses), fps, seed.
 */
export function simulateSet(movement, o = {}) {
  const { reps = 10, repMs = 2000, slowdown = 0, rom = 1, restMs = 400, noise = 0.003, dropout = 0, fps = 20, seed = 1, leadMs = 1000, view = 'side' } = o;
  const r = rng(seed);
  const dt = 1000 / fps;
  const frames = [];
  const trueEnds = [];
  const phases = [{ until: leadMs, p: () => 0 }];
  let t = leadMs;
  for (let i = 0; i < reps; i++) {
    const d = repMs * (1 + (slowdown * i) / Math.max(1, reps - 1)) * (0.9 + 0.2 * r.next());
    const start = t;
    phases.push({ until: t + d, p: (tt) => rom * Math.sin((Math.PI * (tt - start)) / d) ** 2 });
    t += d;
    if (rom >= 0.9) trueEnds.push(Math.round(t));
    const restStart = t;
    phases.push({ until: t + restMs, p: () => 0 });
    t += restMs;
    void restStart;
  }
  phases.push({ until: t + leadMs, p: () => 0 });
  const end = t + leadMs;
  let k = 0;
  for (let tt = 0; tt <= end; tt += dt) {
    while (k < phases.length - 1 && tt > phases[k].until) k++;
    const side = body(MOVES[movement](phases[k].p(tt)));
    const pose = view === 'front' ? frontView(side, 0.5, { armsFrontal: movement === 'shoulder_press' }) : side;
    frames.push({ t: Math.round(tt), pose: jitter(pose, r, noise, dropout) });
  }
  return { frames, trueEnds };
}

function jitter(pose, r, noise, dropout) {
  const drop = r.next() < dropout;
  return pose.map((p, i) => ({
    x: +(p.x + noise * r.gauss()).toFixed(4),
    y: +(p.y + noise * r.gauss()).toFixed(4),
    visibility: drop && [11, 13, 15, 23, 25, 27].includes(i) ? 0.2 : p.visibility,
  }));
}

/** Adversarial: arm raised, forearm waving. Zero true reps. */
export function simulateWave({ waves = 10, waveMs = 700, fps = 20, seed = 2, noise = 0.003 } = {}) {
  const r = rng(seed);
  const frames = [];
  const end = waves * waveMs + 2000;
  for (let t = 0; t <= end; t += 1000 / fps) {
    const ph = t < 1000 || t > end - 1000 ? 0 : ease(0.5 - 0.5 * Math.cos((2 * Math.PI * (t - 1000)) / waveMs));
    frames.push({ t: Math.round(t), pose: jitter(body({ upperArm: 120, elbow: 150 - 90 * ph }), r, noise, 0) });
  }
  return { frames, trueEnds: [] };
}

/**
 * Adversarial: arm resting at the side while the wrist landmark is hallucinated near the
 * shoulder for `glitchMs` every `everyMs` (the "joints remake themselves" failure). Zero true reps.
 */
export function simulateHallucination({ glitches = 8, glitchMs = 900, everyMs = 2000, fps = 20, seed = 3, noise = 0.003 } = {}) {
  const r = rng(seed);
  const frames = [];
  const end = glitches * everyMs + 1000;
  for (let t = 0; t <= end; t += 1000 / fps) {
    const pose = body({ upperArm: 5, elbow: 170 });
    const into = (t - 1000) % everyMs;
    if (t > 1000 && into < glitchMs) {
      // Wrist snaps up beside the shoulder: forearm length jumps, upper arm stays still.
      pose[15] = { x: pose[11].x + 0.05, y: pose[11].y + 0.02, visibility: 0.9 };
    }
    frames.push({ t: Math.round(t), pose: jitter(pose, r, noise, 0) });
  }
  return { frames, trueEnds: [] };
}

/** One lunge pose. p: 0 standing in split stance → 1 bottom. Front leg = near (left) side. */
export function lungeBody(p, cx = 0.5) {
  // Real lunge: front shin stays near vertical, front thigh goes toward horizontal (knee ~90°).
  const ankleF = { x: cx + 0.12, y: 0.92 };
  const kneeF = add(ankleF, BONE.shank, 180 - 12 * p);
  const hip = add(kneeF, BONE.thigh, 180 + 5 + 75 * p);
  const shoulder = add(hip, BONE.torso, 180);
  const kneeB = add(hip, BONE.thigh, -(25 - 20 * p));
  const ankleB = add(kneeB, BONE.shank, -(40 + 45 * p));
  const elbow = add(shoulder, BONE.upper, 5);
  const wrist = add(elbow, BONE.fore, 10);
  const pose = Array.from({ length: 33 }, () => ({ x: shoulder.x, y: shoulder.y - 0.1, visibility: 0.99 }));
  const set = (i, q, v = 0.95) => { pose[i] = { ...q, visibility: v }; };
  set(11, shoulder); set(12, { x: shoulder.x + 0.015, y: shoulder.y }, 0.6);
  set(13, elbow); set(14, { x: elbow.x + 0.015, y: elbow.y }, 0.55);
  set(15, wrist); set(16, { x: wrist.x + 0.015, y: wrist.y }, 0.55);
  set(23, hip); set(24, { x: hip.x + 0.015, y: hip.y }, 0.9);
  set(25, kneeF); set(26, kneeB, 0.9);
  set(27, ankleF); set(28, ankleB, 0.9);
  return pose;
}

/** A set of lunges (zero true squats). view 'front' keeps the vertical drop, loses depth. */
export function simulateLunges({ reps = 8, repMs = 2200, restMs = 400, view = 'side', fps = 20, seed = 41, noise = 0.003 } = {}) {
  const r = rng(seed);
  const frames = [];
  const cycle = repMs + restMs;
  const end = 1000 + reps * cycle + 1000;
  for (let t = 0; t <= end; t += 1000 / fps) {
    const u = t - 1000;
    const inRep = u > 0 && u < reps * cycle && u % cycle < repMs;
    const p = inRep ? Math.sin((Math.PI * (u % cycle)) / repMs) ** 2 : 0;
    const side = lungeBody(p);
    frames.push({ t: Math.round(t), pose: jitter(view === 'front' ? frontView(side) : side, r, noise, 0) });
  }
  return { frames, trueEnds: [] };
}

/**
 * Mid-set exercise switch: `fromReps` of one lift, then `toReps` of another, without a pause in
 * tracking. Ground truth (trueEnds) is the first lift's reps only; the second lift must not be
 * counted in the first lift's mode.
 */
export function simulateSwitch(from, to, { fromReps = 5, toReps = 6, view = 'side', seed = 51, noise = 0.003 } = {}) {
  const a = simulateSet(from, { reps: fromReps, view, seed, noise });
  const last = a.frames[a.frames.length - 1].t;
  const b = simulateSet(to, { reps: toReps, view, seed: seed + 1, noise });
  return { frames: [...a.frames, ...b.frames.map((f) => ({ ...f, t: f.t + last + 50 }))], trueEnds: a.trueEnds };
}

/** Another lift done in this lift's mode (e.g. presses in curl mode): zero true reps. */
export function simulateOtherLift(lift, o = {}) {
  return { frames: simulateSet(lift, o).frames, trueEnds: [] };
}

// ---- Push-ups (side view). Hands on the floor at the left, feet (or knees) to the right. ----
const FLOOR = 0.86;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const toward = (a, b, len) => {
  const d = dist(a, b);
  return { x: a.x + ((b.x - a.x) * len) / d, y: a.y + ((b.y - a.y) * len) / d };
};

/**
 * One push-up pose. elbow: interior elbow angle (170 = top, ~80 = bottom).
 * variant 'standard': knees straight, only hands and feet touch the floor.
 * variant 'knee': knees on the floor, shins raised `shinDeg` above horizontal (0 = shins flat).
 * variant 'incline': hands raised `inclineH` above the floor (bench), legs straight.
 */
export function pushupBody({ elbow = 170, variant = 'standard', shinDeg = 35, inclineH = 0.18, cx = 0.3 } = {}) {
  const handY = variant === 'incline' ? FLOOR - inclineH : FLOOR;
  const wrist = { x: cx, y: handY };
  // Shoulder straight above the wrist; the elbow bends back toward the feet.
  const d = Math.sqrt(BONE.upper ** 2 + BONE.fore ** 2 - 2 * BONE.upper * BONE.fore * Math.cos(rad(elbow)));
  const shoulder = { x: cx, y: handY - d };
  const alpha = Math.acos((BONE.fore ** 2 + d ** 2 - BONE.upper ** 2) / (2 * BONE.fore * d)); // at the wrist
  const elbowP = { x: wrist.x + BONE.fore * Math.sin(alpha), y: wrist.y - BONE.fore * Math.cos(alpha) };
  let hip;
  let kneeP;
  let ankle;
  if (variant === 'knee') {
    const L = BONE.torso + BONE.thigh;
    kneeP = { x: shoulder.x + Math.sqrt(Math.max(0, L ** 2 - (FLOOR - shoulder.y) ** 2)), y: FLOOR };
    hip = toward(shoulder, kneeP, BONE.torso);
    ankle = { x: kneeP.x + BONE.shank * Math.cos(rad(shinDeg)), y: FLOOR - BONE.shank * Math.sin(rad(shinDeg)) };
  } else {
    const L = BONE.torso + BONE.thigh + BONE.shank;
    ankle = { x: shoulder.x + Math.sqrt(Math.max(0, L ** 2 - (FLOOR - shoulder.y) ** 2)), y: FLOOR };
    hip = toward(shoulder, ankle, BONE.torso);
    kneeP = toward(shoulder, ankle, BONE.torso + BONE.thigh);
  }
  const pose = Array.from({ length: 33 }, () => ({ x: shoulder.x - 0.03, y: shoulder.y - 0.02, visibility: 0.99 }));
  const near = { 11: shoulder, 13: elbowP, 15: wrist, 23: hip, 25: kneeP, 27: ankle };
  for (const [i, p] of Object.entries(near)) {
    pose[+i] = { ...p, visibility: 0.98 };
    pose[+i + 1] = { x: p.x + 0.01, y: p.y - 0.005, visibility: 0.55 }; // far side, partly hidden
  }
  return pose;
}

/** A push-up set (true reps when rom >= 0.9). rom 1 = elbow 170° → 80°. */
export function simulatePushups({ reps = 10, variant = 'standard', repMs = 2000, slowdown = 0, rom = 1, restMs = 400, shinDeg = 35, noise = 0.003, fps = 20, seed = 71, leadMs = 1000 } = {}) {
  const r = rng(seed);
  const frames = [];
  const trueEnds = [];
  const durs = [];
  for (let i = 0; i < reps; i++) durs.push(repMs * (1 + (slowdown * i) / Math.max(1, reps - 1)) * (0.9 + 0.2 * r.next()));
  const starts = [];
  let t = leadMs;
  for (const d of durs) {
    starts.push(t);
    t += d;
    if (rom >= 0.9) trueEnds.push(Math.round(t));
    t += restMs;
  }
  const end = t + leadMs;
  for (let tt = 0; tt <= end; tt += 1000 / fps) {
    let p = 0;
    for (let i = 0; i < reps; i++) if (tt >= starts[i] && tt < starts[i] + durs[i]) p = rom * Math.sin((Math.PI * (tt - starts[i])) / durs[i]) ** 2;
    frames.push({ t: Math.round(tt), pose: jitter(pushupBody({ elbow: 170 - 90 * p, variant, shinDeg }), r, noise, 0) });
  }
  return { frames, trueEnds };
}

/**
 * Adversarial: elbows bend and straighten through a push-up's range while the body is upright
 * (standing, or kneeling tall), arms forward at shoulder height. Zero true push-ups.
 */
export function simulateUprightElbowBends({ reps = 8, kneeling = false, repMs = 1600, restMs = 400, fps = 20, seed = 81, noise = 0.003 } = {}) {
  const r = rng(seed);
  const frames = [];
  const cycle = repMs + restMs;
  const end = 1000 + reps * cycle + 1000;
  for (let t = 0; t <= end; t += 1000 / fps) {
    const u = t - 1000;
    const inRep = u > 0 && u < reps * cycle && u % cycle < repMs;
    const p = inRep ? Math.sin((Math.PI * (u % cycle)) / repMs) ** 2 : 0;
    let pose = body({ upperArm: 90, elbow: 170 - 90 * p, knee: 175 });
    if (kneeling) {
      // Kneeling tall: knees on the floor (body drops one shank length), shins flat behind.
      pose = pose.map((q, i) => ([27, 28].includes(i) ? q : { ...q, y: q.y + BONE.shank }));
      pose[27] = { ...pose[27], x: pose[25].x + BONE.shank, y: pose[25].y };
      pose[28] = { ...pose[28], x: pose[26].x + BONE.shank, y: pose[26].y };
    }
    frames.push({ t: Math.round(t), pose: jitter(pose, r, noise, 0) });
  }
  return { frames, trueEnds: [] };
}

// ---- Deadlift (side view) and pull-up (facing the camera). SIMULATED: logic tests only. ----
const up = (p, len, tiltDeg, fwd = 1) => ({ x: p.x + fwd * len * Math.sin(rad(tiltDeg)), y: p.y - len * Math.cos(rad(tiltDeg)) });

/**
 * Hip hinge from the side. hip: shoulder–hip–knee angle; knee: hip–knee–ankle angle; shin: forward
 * shin tilt (deg). Arms hang straight down holding the bar.
 */
export function deadliftBody({ hip = 175, knee = 175, shin = 0, cx = 0.45 } = {}) {
  const ankle = { x: cx, y: 0.92 };
  const kneeP = up(ankle, BONE.shank, shin);
  const thighBack = Math.max(0, 180 - knee - shin);
  const hipP = up(kneeP, BONE.thigh, -thighBack);
  const torsoFwd = Math.max(0, 180 - hip - thighBack);
  const shoulder = up(hipP, BONE.torso, torsoFwd);
  const elbowP = { x: shoulder.x, y: shoulder.y + BONE.upper };
  const wrist = { x: shoulder.x, y: elbowP.y + BONE.fore };
  const pose = Array.from({ length: 33 }, () => ({ x: shoulder.x + 0.03, y: shoulder.y - 0.08, visibility: 0.99 }));
  const near = { 11: shoulder, 13: elbowP, 15: wrist, 23: hipP, 25: kneeP, 27: ankle };
  for (const [i, p] of Object.entries(near)) {
    pose[+i] = { ...p, visibility: 0.98 };
    pose[+i + 1] = { x: p.x + 0.015, y: p.y, visibility: 0.55 };
  }
  return pose;
}

/** p 0 = bar at the floor (hip 100°, knee 125°), 1 = lockout. */
const deadliftAt = (p) => deadliftBody({ hip: 100 + 75 * p, knee: 125 + 50 * p, shin: 20 * (1 - p) });

/**
 * Pull-up facing the camera: hands fixed on the bar at barY; the body rises as the elbows bend.
 * elbow: interior elbow angle (170 hanging, ~60 chin over the bar).
 */
export function pullupBody({ elbow = 170, cx = 0.5, barY = 0.1 } = {}) {
  const thetaU = 15 + (170 - elbow) * 0.45; // upper arm from vertical, outward
  const phi = thetaU - (180 - elbow); // forearm direction, bends inward
  const elbowRel = { x: BONE.upper * Math.sin(rad(thetaU)), y: -BONE.upper * Math.cos(rad(thetaU)) };
  const wristRel = { x: elbowRel.x + BONE.fore * Math.sin(rad(phi)), y: elbowRel.y - BONE.fore * Math.cos(rad(phi)) };
  const shoulderY = barY - wristRel.y;
  const pose = Array.from({ length: 33 }, () => ({ x: cx, y: shoulderY - 0.1, visibility: 0.99 }));
  for (const [side, sx] of [[0, 1], [1, -1]]) { // subject's left appears on the image right
    const sh = { x: cx + sx * 0.09, y: shoulderY };
    const v = (p) => ({ ...p, visibility: p.y > 1 ? 0.2 : 0.97 });
    pose[11 + side] = v(sh);
    pose[13 + side] = v({ x: sh.x + sx * elbowRel.x, y: sh.y + elbowRel.y });
    pose[15 + side] = v({ x: sh.x + sx * wristRel.x, y: sh.y + wristRel.y });
    pose[23 + side] = v({ x: cx + sx * 0.06, y: shoulderY + BONE.torso });
    pose[25 + side] = v({ x: cx + sx * 0.065, y: shoulderY + BONE.torso + BONE.thigh });
    pose[27 + side] = v({ x: cx + sx * 0.06, y: shoulderY + BONE.torso + BONE.thigh + BONE.shank });
  }
  return pose;
}

const pullupAt = (p) => pullupBody({ elbow: 170 - 105 * p });

function repSet(at, { reps = 8, repMs = 2400, slowdown = 0, rom = 1, restMs = 500, noise = 0.003, fps = 20, seed = 91, leadMs = 1000 } = {}) {
  const r = rng(seed);
  const durs = Array.from({ length: reps }, (_, i) => repMs * (1 + (slowdown * i) / Math.max(1, reps - 1)) * (0.9 + 0.2 * r.next()));
  const starts = [];
  const trueEnds = [];
  let t = leadMs;
  for (const d of durs) {
    starts.push(t);
    t += d;
    if (rom >= 0.9) trueEnds.push(Math.round(t));
    t += restMs;
  }
  const frames = [];
  for (let tt = 0; tt <= t + leadMs; tt += 1000 / fps) {
    let p = 0;
    for (let i = 0; i < reps; i++) if (tt >= starts[i] && tt < starts[i] + durs[i]) p = rom * Math.sin((Math.PI * (tt - starts[i])) / durs[i]) ** 2;
    frames.push({ t: Math.round(tt), pose: jitter(at(p), r, noise, 0) });
  }
  return { frames, trueEnds };
}

/** Deadlift set from the floor (starts and ends at the bottom). */
export const simulateDeadlifts = (o = {}) => repSet(deadliftAt, { seed: 91, ...o });
/** Pull-up set from a dead hang. */
export const simulatePullups = (o = {}) => repSet(pullupAt, { seed: 101, ...o });

/**
 * Adversarial: walking across the frame, side view. The near knee bends to ~140° in swing and the
 * body travels in x. Zero true squats (or any reps).
 */
export function simulateWalk({ steps = 10, stepMs = 550, fps = 20, seed = 111, noise = 0.003, fromX = 0.25, toX = 0.75 } = {}) {
  const r = rng(seed);
  const frames = [];
  const dur = 1000 + steps * stepMs + 1000;
  for (let t = 0; t <= dur; t += 1000 / fps) {
    const u = Math.min(1, Math.max(0, (t - 1000) / (steps * stepMs)));
    const phase = ((t - 1000) / stepMs) * Math.PI;
    const swing = t > 1000 && u < 1 ? Math.max(0, Math.sin(phase)) : 0;
    const pose = body({ knee: 175 - 35 * swing, upperArm: 15 * Math.sin(phase), elbow: 160, cx: fromX + (toX - fromX) * u });
    frames.push({ t: Math.round(t), pose: jitter(pose, r, noise, 0) });
  }
  return { frames, trueEnds: [] };
}

/**
 * Labeled lunge set (side view by default). alternate: legs swap every rep (left leg forward on odd
 * reps). Returns trueEnds and the lead leg per rep. SIMULATED: logic tests only.
 */
export function simulateLungeSet({ reps = 8, repMs = 2200, restMs = 400, view = 'side', alternate = true, fps = 20, seed = 141, noise = 0.003, rom = 1 } = {}) {
  const r = rng(seed);
  const frames = [];
  const trueEnds = [];
  const leads = [];
  const cycle = repMs + restMs;
  const end = 1000 + reps * cycle + 1000;
  for (let i = 0; i < reps; i += 1) {
    if (rom >= 0.9) trueEnds.push(Math.round(1000 + i * cycle + repMs));
    leads.push(alternate && i % 2 ? 'right' : 'left');
  }
  // Mirror the leg roles: the right leg leads (swap left/right hip, knee, ankle).
  const mirror = (pose) => {
    const m = pose.map((q) => ({ ...q }));
    for (const [a, b] of [[23, 24], [25, 26], [27, 28]]) [m[a], m[b]] = [{ ...pose[b] }, { ...pose[a] }];
    return m;
  };
  const stance = (lead, p) => (lead === 'right' ? mirror(lungeBody(p)) : lungeBody(p));
  const lerp = (A, B, f) => A.map((q, i) => ({ x: q.x + (B[i].x - q.x) * f, y: q.y + (B[i].y - q.y) * f, visibility: Math.min(q.visibility, B[i].visibility) }));
  for (let t = 0; t <= end; t += 1000 / fps) {
    const u = t - 1000;
    const k = Math.min(reps - 1, Math.floor(Math.max(0, u) / cycle));
    const inRep = u > 0 && u < reps * cycle && u % cycle < repMs;
    const p = inRep ? rom * Math.sin((Math.PI * (u % cycle)) / repMs) ** 2 : 0;
    let pose = stance(leads[k], p);
    // Between reps the feet step over smoothly when the lead leg changes (a person can't teleport).
    if (!inRep && u > 0 && k + 1 < reps && leads[k + 1] !== leads[k] && u % cycle >= repMs) {
      pose = lerp(stance(leads[k], 0), stance(leads[k + 1], 0), ((u % cycle) - repMs) / restMs);
    }
    frames.push({ t: Math.round(t), pose: jitter(view === 'front' ? frontView(pose) : pose, r, noise, 0) });
  }
  return { frames, trueEnds, leads };
}
