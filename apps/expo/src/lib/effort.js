// Effort ESTIMATE (RPE / reps in reserve) from camera rep timing. Velocity-based-training
// research finds that as a set nears failure, the lifting phase slows: roughly 40–50% velocity
// loss is near failure for squat and bench (González-Badillo & Sánchez-Medina 2010–2011).
// We use a simple, uncalibrated linear band: reps in reserve ≈ 4 − velocity loss / 10%, floored
// at 0 and capped at 4 (RPE 6), and add effort when range of motion shrinks. It is not fitted to
// this user or to body-weight lifts, so confidence is never "high".
//
// Velocity per rep = range of motion (deg) / lifting-phase duration. The counter's phases run
// rest → peak → rest; the lifting phase is concentric (rest → peak) for curls and presses, and
// the return (counter eccentric) for squats and push-ups, where rest → peak is the lowering.
const LIFT_PHASE = { curl: 'concentric_ms', shoulder_press: 'concentric_ms', squat: 'eccentric_ms', push_up: 'eccentric_ms' };
const MAX_RIR = 4;
const VL_PER_RIR = 10; // % velocity loss per rep in reserve
const ROM_PER_RIR = 10; // % range-of-motion loss per rep in reserve
const MAX_ROM_PENALTY = 2;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const half = (x) => Math.round(x * 2) / 2;

/** { estimate: true, rpe, rir, confidence: 'low'|'medium', velocityLossPct, romLossPct, evidence[] } */
export function estimateEffort({ movement, reps = [] }) {
  const n = reps.length;
  const base = { estimate: true, rpe: null, rir: null, confidence: 'low', velocityLossPct: null, romLossPct: null };
  if (n < 2) return { ...base, evidence: ['Effort estimate needs at least 2 counted reps.'] };
  const phase = LIFT_PHASE[movement] ?? 'concentric_ms';
  const hasRom = reps.every((r) => r.rom_deg > 0);
  const speed = reps.map((r) => (hasRom ? r.rom_deg : 1) / Math.max(1, r[phase] ?? 0));
  const k = Math.max(1, Math.min(3, Math.floor(n / 3)));
  const vl = Math.max(0, 1 - mean(speed.slice(-k)) / mean(speed.slice(0, k)));
  const velocityLossPct = Math.round(100 * vl);
  let rir = Math.min(MAX_RIR, Math.max(0, MAX_RIR - velocityLossPct / VL_PER_RIR));
  const evidence = [
    `Estimate from rep speed, not a measurement: ${velocityLossPct}% slower lifting on the last ${k === 1 ? 'rep' : `${k} reps`} than the first.`,
  ];
  let romLossPct = null;
  if (hasRom) {
    romLossPct = Math.max(0, Math.round(100 * (1 - mean(reps.slice(-k).map((r) => r.rom_deg)) / mean(reps.slice(0, k).map((r) => r.rom_deg)))));
    if (romLossPct >= 5) {
      rir = Math.max(0, rir - Math.min(MAX_ROM_PENALTY, romLossPct / ROM_PER_RIR));
      evidence.push(`Range of motion shrank ${romLossPct}% by the end of the set.`);
    }
  }
  const durs = reps.map((r) => (r.concentric_ms ?? 0) + (r.peak_pause_ms ?? 0) + (r.eccentric_ms ?? 0));
  const tempoPct = Math.round(100 * (mean(durs.slice(-k)) / mean(durs.slice(0, k)) - 1));
  if (Math.abs(tempoPct) >= 10) evidence.push(`Whole reps took ${Math.abs(tempoPct)}% ${tempoPct > 0 ? 'longer' : 'less time'} at the end.`);
  if (n < 3) evidence.push('Only 2 reps: low confidence.');
  rir = half(rir);
  return { ...base, rpe: 10 - rir, rir, confidence: n < 3 ? 'low' : 'medium', velocityLossPct, romLossPct, evidence };
}
