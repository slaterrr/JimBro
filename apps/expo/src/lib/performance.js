// Per-rep performance metrics and a conservative fatigue assessment.
// Everything here is RELATIVE: joint angles (degrees) and phase times (ms) from the camera.
// Normalized image coordinates are not metres, so no m/s, displacement or force is reported.
import { analyzerFor } from './analyzers.js';

export const FATIGUE_LEVELS = ['normal', 'possible_fatigue', 'increasing_difficulty', 'incomplete_rep', 'failed_attempt', 'uncertain'];

const FATIGUE_LOSS_PCT = 30; // velocity loss suggesting fatigue (one signal, not a decision)
const HARDER_LOSS_PCT = 15;
const ROM_LOSS_PCT = 15;
const FEWER_REPS = 2; // vs. last time at the same weight
const MIN_REPS = 3;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

const OMITTED = [
  { metric: 'peak_velocity', why: 'Needs each rep\'s full joint trajectory; only phase times are stored.' },
  { metric: 'acceleration', why: 'Second derivative of noisy 20 fps landmarks; not reliable enough to show.' },
  { metric: 'displacement_m', why: 'Image coordinates are not metres; needs a calibration object of known size.' },
];

/** Relative per-rep metrics for one set; `reps` is the stored reps_detail. */
export function repMetrics(movement, reps = []) {
  const phase = analyzerFor(movement)?.liftPhase ?? 'concentric_ms';
  const other = phase === 'concentric_ms' ? 'eccentric_ms' : 'concentric_ms';
  const rows = reps.map((r) => {
    const lift = r[phase] ?? null;
    const rom = r.rom_deg > 0 ? r.rom_deg : null;
    return {
      index: r.index, lift_ms: lift, lower_ms: r[other] ?? null, pause_ms: r.peak_pause_ms ?? null, rom_deg: rom,
      speed_dps: lift > 0 && rom ? Math.round(rom / (lift / 1000)) : null,
    };
  });
  const omitted = [...OMITTED];
  const lifts = rows.map((r) => r.lift_ms).filter((x) => x > 0);
  let velocityLossPct = null;
  let romLossPct = null;
  if (lifts.length >= MIN_REPS) {
    const k = Math.max(1, Math.min(3, Math.floor(rows.length / 3)));
    const speed = rows.map((r) => r.speed_dps ?? (r.lift_ms > 0 ? 1000 / r.lift_ms : 0));
    velocityLossPct = Math.max(0, Math.round(100 * (1 - mean(speed.slice(-k)) / mean(speed.slice(0, k)))));
    if (rows.every((r) => r.rom_deg)) {
      const roms = rows.map((r) => r.rom_deg);
      romLossPct = Math.max(0, Math.round(100 * (1 - mean(roms.slice(-k)) / mean(roms.slice(0, k)))));
    }
  } else {
    omitted.push({ metric: 'velocity_loss', why: `Needs at least ${MIN_REPS} camera-counted reps.` });
  }
  const avg = lifts.length ? mean(lifts) : null;
  const consistencyCv = lifts.length >= 2 ? round(Math.sqrt(mean(lifts.map((x) => (x - avg) ** 2))) / avg, 2) : null;
  return {
    calibrated: false,
    units: 'Relative: joint angles in degrees, times in ms, speed in degrees per second (not m/s).',
    reps: rows,
    meanLiftMs: avg === null ? null : Math.round(avg),
    velocityLossPct,
    romLossPct,
    consistencyCv,
    omitted,
  };
}

/**
 * Conservative fatigue assessment. Slow reps are a signal, never proof of failure; a failed
 * attempt is reported only when the counter saw an unfinished attempt after the last counted rep
 * and the target was missed. No reps-in-reserve number is inferred from video.
 * completed: user-confirmed rep count (camera count alone is not trusted for "missed target").
 */
export function assessFatigue({ movement, reps = [], target = null, completed, partials = 0, partialAfterLastRep = false, rpe = null, rir = null, weight = null, unit = null, history = [] }) {
  const m = reps.length ? repMetrics(movement, reps) : null;
  const done = completed ?? reps.length;
  const signals = [];
  let level = 'normal';
  const atLeast = (l) => {
    const rank = { normal: 0, increasing_difficulty: 1, possible_fatigue: 2 };
    if ((rank[l] ?? 0) > (rank[level] ?? 0)) level = l;
  };
  let evidence = 0;

  if (m?.velocityLossPct != null) {
    evidence += 1;
    if (m.velocityLossPct >= FATIGUE_LOSS_PCT) {
      signals.push(`Your last reps were ${m.velocityLossPct}% slower than your first.`);
      atLeast('possible_fatigue');
    } else if (m.velocityLossPct >= HARDER_LOSS_PCT) {
      signals.push(`Your last reps were ${m.velocityLossPct}% slower than your first.`);
      atLeast('increasing_difficulty');
    }
  }
  if (m?.romLossPct >= ROM_LOSS_PCT) {
    signals.push(`Your range of motion shrank ${m.romLossPct}% by the end.`);
    atLeast('increasing_difficulty');
  }
  if (rpe != null) {
    evidence += 1;
    if (rpe >= 9.5) {
      signals.push(`You rated it RPE ${rpe}.`);
      atLeast('increasing_difficulty');
    }
  }
  if (rir != null) {
    evidence += 1;
    if (rir <= 0) {
      signals.push('You said you had no reps left.');
      atLeast('increasing_difficulty');
    }
  }
  if (completed != null && target && completed < target) {
    evidence += 1;
    signals.push(`You did ${completed} of ${target} target reps.`);
    atLeast('increasing_difficulty');
  }
  if (weight != null && completed != null) {
    const same = history.filter((h) => h.exercise === movement && h.weight === weight && (!unit || h.unit === unit));
    if (same.length) {
      evidence += 1;
      const best = Math.max(...same.map((h) => h.reps));
      if (done <= best - FEWER_REPS) {
        signals.push(`${best - done} fewer reps than last time at ${weight} ${unit ?? ''}`.trim() + '.');
        atLeast('increasing_difficulty');
      }
    }
  }

  if (partials > 0 && partialAfterLastRep && target && done < target) {
    level = 'failed_attempt';
    signals.unshift(`An attempt after rep ${done} didn't reach full range.`);
  } else if (partials > 0 && level !== 'possible_fatigue') {
    level = 'incomplete_rep';
    signals.unshift(`${partials} movement${partials > 1 ? 's' : ''} didn't reach full range and ${partials > 1 ? "weren't" : "wasn't"} counted.`);
  } else if (evidence === 0) {
    level = 'uncertain';
  }

  const TEXT = {
    normal: m?.velocityLossPct != null ? 'Steady reps: normal rep-to-rep variation.' : 'No signs of fatigue in what you reported.',
    increasing_difficulty: `The set got harder. ${signals[0] ?? ''}`.trim(),
    possible_fatigue: `Possible fatigue. ${signals[0] ?? ''} Slower reps are one sign of fatigue, not proof of it.`.trim(),
    incomplete_rep: signals[0] ?? 'An incomplete rep was seen.',
    failed_attempt: `${signals[0]} That looks like a missed rep.`,
    uncertain: 'Too few camera reps to judge fatigue. Tell me how hard it felt.',
  };
  return {
    level,
    signals,
    text: TEXT[level],
    confidence: (m && m.reps.length >= 5) || rpe != null || rir != null ? 'medium' : 'low',
    metrics: m,
  };
}
