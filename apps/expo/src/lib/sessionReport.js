// Post-set and post-session camera report. Every number comes from measured rep timing or
// tracking quality; suggestions cite their evidence. No fatigue or form scores are invented.
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

  return { movement, counted, target, rpe, partials, issues, trackingPct, repDurationsMs, tempo, suggestions };
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
