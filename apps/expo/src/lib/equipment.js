// Equipment tracking, model-agnostic. A detector (none ships yet; see docs/engines/EQUIPMENT_DETECTION.md)
// returns per-frame detections { label, score, box: { x, y, w, h } } in normalized image units.
// The tracker follows each object across frames (nearest centre, same label), bridges short
// occlusions and ends tracks after long ones. Bar path is RELATIVE image units unless calibrated from
// a face-on standard plate, and calibration is always marked unvalidated.

export const EQUIPMENT_CLASSES = Object.freeze(['barbell', 'dumbbell', 'plate', 'kettlebell']);

/** Placeholder until a detector is trained: detects nothing, and says so. */
export const NO_DETECTOR = Object.freeze({ id: 'none', available: false, classes: [], detect: () => [] });

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const MAX_MATCH_DIST = 0.15; // normalized units per frame

export class EquipmentTracker {
  constructor({ minScore = 0.5, maxGapFrames = 6 } = {}) {
    this.minScore = minScore;
    this.maxGapFrames = maxGapFrames;
    this.active = [];
    this.done = [];
    this.nextId = 1;
  }

  /** Feed one frame's detections (already from the detector). */
  update(t, detections = []) {
    const dets = detections.filter((d) => d.score >= this.minScore && EQUIPMENT_CLASSES.includes(d.label));
    const used = new Set();
    for (const tr of this.active) {
      let last = tr.points[tr.points.length - 1];
      for (let k = tr.points.length - 1; k >= 0; k -= 1) if (!tr.points[k].occluded) { last = tr.points[k]; break; }
      let best = -1;
      let bestD = MAX_MATCH_DIST * (tr.gap + 1);
      dets.forEach((d, i) => {
        if (used.has(i) || d.label !== tr.label) return;
        const c = centre(d.box);
        const dist = Math.hypot(c.x - last.x, c.y - last.y);
        if (dist < bestD) { best = i; bestD = dist; }
      });
      if (best >= 0) {
        used.add(best);
        const d = dets[best];
        tr.points.push({ t, ...centre(d.box), w: d.box.w, h: d.box.h, score: d.score, occluded: false });
        tr.gap = 0;
      } else {
        tr.gap += 1;
        if (tr.gap <= this.maxGapFrames) tr.points.push({ t, x: last.x, y: last.y, w: last.w, h: last.h, score: 0, occluded: true });
      }
    }
    for (const tr of this.active.filter((x) => x.gap > this.maxGapFrames)) {
      tr.points = tr.points.filter((p, i, a) => !(p.occluded && a.slice(i).every((q) => q.occluded))); // drop trailing guesses
      this.done.push(tr);
    }
    this.active = this.active.filter((x) => x.gap <= this.maxGapFrames);
    dets.forEach((d, i) => {
      if (used.has(i)) return;
      this.active.push({ id: this.nextId++, label: d.label, gap: 0, points: [{ t, ...centre(d.box), w: d.box.w, h: d.box.h, score: d.score, occluded: false }] });
    });
  }

  /** All tracks (finished and active), oldest first. */
  tracks() {
    return [...this.done, ...this.active].map(({ id, label, points }) => ({ id, label, points }));
  }
}

const PLATE_DIAMETER_M = 0.45;
const FACE_ON = [0.85, 1.15];

/**
 * Metres per image unit from a face-on standard plate (450 mm). Returns { calibrated: false, why }
 * when it can't. Never validated until compared against a reference device.
 */
export function calibrateFromPlate(track, { plateDiameterM = PLATE_DIAMETER_M } = {}) {
  if (track?.label !== 'plate') return { calibrated: false, why: 'Calibration needs a weight plate.' };
  const seen = track.points.filter((p) => !p.occluded);
  const aspect = seen.map((p) => p.w / p.h).sort((a, b) => a - b)[Math.floor(seen.length / 2)];
  if (!(aspect >= FACE_ON[0] && aspect <= FACE_ON[1])) return { calibrated: false, why: 'The plate is not facing the camera.' };
  const h = seen.map((p) => p.h).sort((a, b) => a - b)[Math.floor(seen.length / 2)];
  return {
    calibrated: true, validated: false, method: 'plate-diameter', metresPerUnit: plateDiameterM / h,
    assumptions: [
      `The plate is a standard ${plateDiameterM * 1000} mm plate.`,
      'The plate faces the camera.',
      'The camera is level and still.',
      'Lens distortion is ignored.',
    ],
  };
}

/** Vertical bar path for a track: relative units, or metres and m/s when a calibration is given. */
export function barPath(track, cal = null) {
  const pts = track.points.filter((p) => !p.occluded);
  const ys = pts.map((p) => p.y);
  const verticalRange = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const out = {
    calibrated: false, units: 'image units (relative)', verticalRange: Math.round(verticalRange * 1000) / 1000,
    occludedPct: track.points.length ? Math.round((100 * (track.points.length - pts.length)) / track.points.length) : 0,
  };
  if (!cal?.calibrated) return out;
  let peak = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (dt > 0) peak = Math.max(peak, (Math.abs(pts[i].y - pts[i - 1].y) * cal.metresPerUnit) / dt);
  }
  return {
    ...out, calibrated: true, validated: false, units: 'metres (plate-calibrated, unvalidated)',
    range_m: Math.round(verticalRange * cal.metresPerUnit * 1000) / 1000, peakSpeed_mps: Math.round(peak * 100) / 100,
    assumptions: cal.assumptions,
  };
}
