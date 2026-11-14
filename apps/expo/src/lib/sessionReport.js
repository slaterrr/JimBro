// Post-set and post-session camera report. Every number comes from measured rep timing or
// tracking quality; suggestions cite their evidence. No form scores are invented; effort is an
// explicitly labelled estimate from rep speed (lib/effort.js).
import { estimateEffort } from './effort.js';

const MIN_REPS_FOR_TEMPO = 6;
const LOW_TRACKING_PCT = 80;

const duration = (r) => (r.concentric_ms ?? 0) + (r.peak_pause_ms ?? 0) + (r.eccentric_ms ?? 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function setReport({ movement, reps = [], quality = null, rpe = null, target = null }) {
  const repDurationsMs = reps.map(duration);
  const counted = reps.length;
  const trackingPct = quality?.frames ? Math.round((100 * quality.okFrames) / quality.frames) : null;
  const issues = quality?.issues ?? {};
  const partials = quality?.partials ?? 0;

  let tempo = null;
  if (counted >= MIN_REPS_FOR_TEMPO) {
    const firstMs = Math.round(mean(repDurationsMs.slice(0, 3)));
    const lastMs = Math.round(mean(repDurationsMs.slice(-3)));
    tempo = { firstMs, lastMs, changePct: Math.round((100 * (lastMs - firstMs)) / firstMs) };
  }

  const suggestions = [];
  if (trackingPct !== null && trackingPct < LOW_TRACKING_PCT) {
    suggestions.push({ id: 'camera', text: 'Move the phone back so your whole working side is in frame, side-on, in good light.', evidence: `Tracking was reliable for ${trackingPct}% of the set.` });
  }
  if ((issues.framing ?? 0) >= 2) {
    suggestions.push({ id: 'framing', text: 'Step back until your shoulders and hips are both on screen.', evidence: `Counting paused ${issues.framing} times because your torso left the frame.` });
  }
  if ((issues.implausible_motion ?? 0) >= 3) {
    suggestions.push({ id: 'steady', text: 'Keep the phone still and only you in frame; tracking jumps pause counting.', evidence: `Tracking jumped ${issues.implausible_motion} times.` });
  }
  if ((issues.arm_swing ?? 0) >= 2) {
    suggestions.push({ id: 'elbow', text: 'Keep your elbow pinned to your side; swinging reps are not counted.', evidence: `${issues.arm_swing} movements were rejected for upper-arm swing.` });
  }
  if (partials >= 2) {
    suggestions.push({ id: 'range', text: 'Use the full range of motion so every rep counts.', evidence: `${partials} partial reps did not reach full range.` });
  }
  if (rpe != null && target && counted >= target && rpe <= 7) {
    suggestions.push({ id: 'load', text: 'Consider a small weight increase next time.', evidence: `You hit ${counted}/${target} reps at RPE ${rpe}.` });
  }
  if (tempo && tempo.changePct >= 25) {
    suggestions.push({ id: 'tempo', text: 'Your reps slowed noticeably by the end; keep this weight until the pace holds.', evidence: `Last 3 reps averaged ${tempo.changePct}% longer than the first 3.` });
  }

  // Push-up rep types (knee / standard / incline) from body-line geometry, per rep.
  const typed = reps.filter((r) => r.variant);
  const variants = typed.length ? typed.reduce((acc, r) => ({ ...acc, [r.variant]: (acc[r.variant] ?? 0) + 1 }), {}) : null;
  if (variants && movement === 'push_up') {
    const parts = Object.entries(variants).sort((a, b) => b[1] - a[1]).map(([v, n], i) => `${n} ${v}${i === 0 ? ` push-up${n === 1 ? '' : 's'}` : ''}`);
    const unclear = counted - typed.length;
    suggestions.push({
      id: 'variant',
      text: `${parts.join(', ')}${unclear ? `, ${unclear} type unclear` : ''}.`,
      evidence: 'Rep type from your body line on camera: knees bent and on the floor = knee push-up.',
    });
  }

  const effort = estimateEffort({ movement, reps });
  if (effort.rpe != null) {
    suggestions.push({
      id: 'effort',
      text: `Rough effort from rep speed: about RPE ${Math.max(6, effort.rpe - 1)}–${Math.min(10, effort.rpe + 1)}. An estimate (${effort.confidence} confidence), not a measured reps-left count; tell me how many you had left.`,
      evidence: effort.evidence.join(' '),
    });
  }

  return { movement, counted, target, rpe, partials, issues, trackingPct, repDurationsMs, tempo, suggestions, variants, effort };
}

/** Summarize the camera-counted sets of one workout. */
export function sessionReport(workout) {
  const sets = (workout?.sets ?? [])
    .filter((s) => s.source === 'camera' && s.reps_detail?.length)
    .map((s) => setReport({ movement: s.exercise, reps: s.reps_detail, quality: s.camera_quality ?? null, rpe: s.rpe ?? null, target: s.target ?? null }));
  const tracked = sets.filter((s) => s.trackingPct !== null);
  return {
    sets,
    totals: {
      counted: sets.reduce((a, s) => a + s.counted, 0),
      partials: sets.reduce((a, s) => a + s.partials, 0),
      trackingPct: tracked.length ? Math.round(mean(tracked.map((s) => s.trackingPct))) : null,
    },
  };
}
