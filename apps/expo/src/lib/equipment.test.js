// Equipment tracking: detector interface, frame-to-frame tracking with occlusion, bar path, and
// plate-diameter calibration. Detections here are SYNTHETIC (no detector model ships yet).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { barPath, calibrateFromPlate, EquipmentTracker, NO_DETECTOR } from './equipment.js';

const box = (cx, cy, w = 0.06, h = 0.06) => ({ x: cx - w / 2, y: cy - h / 2, w, h });
// A plate moving up and down 0.3 image units, twice, at 20 fps.
const frames = (n = 80, occludeFrom = -1, occludeTo = -1) => Array.from({ length: n }, (_, i) => {
  const t = i * 50;
  const cy = 0.7 - 0.3 * Math.sin((Math.PI * i) / 40) ** 2;
  const hidden = i >= occludeFrom && i <= occludeTo;
  return { t, detections: hidden ? [] : [{ label: 'plate', score: 0.9, box: box(0.5, cy, 0.12, 0.12) }, { label: 'dumbbell', score: 0.3, box: box(0.2, 0.2) }] };
});

describe('detector interface', () => {
  it('ships with no detector: nothing is invented', () => {
    assert.deepEqual(NO_DETECTOR.detect({}), []);
    assert.equal(NO_DETECTOR.available, false);
  });
});

describe('EquipmentTracker', () => {
  it('follows one object across frames, ignoring low-confidence detections', () => {
    const tr = new EquipmentTracker({ minScore: 0.5 });
    for (const f of frames()) tr.update(f.t, f.detections);
    const tracks = tr.tracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].label, 'plate');
    assert.equal(tracks[0].points.length, 80);
  });

  it('bridges short occlusions and marks them; long ones end the track', () => {
    const tr = new EquipmentTracker({ maxGapFrames: 6 });
    for (const f of frames(80, 30, 33)) tr.update(f.t, f.detections);
    const [t] = tr.tracks();
    assert.equal(tr.tracks().length, 1);
    assert.equal(t.points.filter((p) => p.occluded).length, 4);
    const long = new EquipmentTracker({ maxGapFrames: 6 });
    for (const f of frames(80, 30, 50)) long.update(f.t, f.detections);
    assert.equal(long.tracks().length, 2);
  });
});

describe('bar path and calibration', () => {
  it('bar path is relative image units unless calibrated', () => {
    const tr = new EquipmentTracker();
    for (const f of frames()) tr.update(f.t, f.detections);
    const p = barPath(tr.tracks()[0]);
    assert.equal(p.calibrated, false);
    assert.ok(Math.abs(p.verticalRange - 0.3) < 0.02, `${p.verticalRange}`);
    assert.equal('range_m' in p, false);
  });

  it('a face-on 450 mm plate gives metres, marked unvalidated with its assumptions', () => {
    const tr = new EquipmentTracker();
    for (const f of frames()) tr.update(f.t, f.detections);
    const cal = calibrateFromPlate(tr.tracks()[0]);
    assert.equal(cal.calibrated, true);
    assert.equal(cal.validated, false);
    assert.ok(cal.assumptions.length >= 3);
    const p = barPath(tr.tracks()[0], cal);
    assert.ok(Math.abs(p.range_m - 1.125) < 0.08, `${p.range_m}`); // 0.3 units x (0.45 m / 0.12 units)
    assert.ok(p.peakSpeed_mps > 0);
  });

  it('refuses to calibrate from a plate seen at an angle or from other equipment', () => {
    const tr = new EquipmentTracker();
    for (let i = 0; i < 20; i += 1) tr.update(i * 50, [{ label: 'plate', score: 0.9, box: box(0.5, 0.5, 0.05, 0.12) }]);
    assert.equal(calibrateFromPlate(tr.tracks()[0]).calibrated, false);
    const db = new EquipmentTracker();
    for (let i = 0; i < 20; i += 1) db.update(i * 50, [{ label: 'dumbbell', score: 0.9, box: box(0.5, 0.5) }]);
    assert.equal(calibrateFromPlate(db.tracks()[0]).calibrated, false);
  });
});
