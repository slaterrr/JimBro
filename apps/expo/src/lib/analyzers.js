// Exercise analyzer registry. Every exercise registers how the camera analyzes it, or why it
// doesn't. Registered ≠ implemented ≠ validated:
//   tested_real   counts with the camera; checked on labeled real video (tools/vision-lab)
//   tested_sim    counts with the camera; checked on simulated landmarks only
//   experimental  counts with the camera; first version, simulation only, not validated
//   manual        not counted by the camera: log by tapping (reason says why)
// To add an exercise: give it a joint triple (landmarks), an anchor that must also be visible,
// a rep config in reps.js, which phase is the lifting effort, and honest limits.
import { ARM, HIP, LEG } from './angles.js';
import { CURL, DEADLIFT, LUNGE, PULL_UP, PUSH_UP, SHOULDER_PRESS, SQUAT } from './reps.js';

export const CAMERA_STATUS = ['tested_real', 'tested_sim', 'experimental', 'manual'];

const side = (l, r) => ({ left: l, right: r });
const SHOULDER = side(11, 12);
const HIP_PT = side(23, 24);
const ANKLE = side(27, 28);

export const ANALYZERS = {
  curl: {
    id: 'curl', status: 'tested_real', kind: 'reps', views: ['side'],
    landmarks: ARM, anchor: HIP_PT, config: CURL, liftPhase: 'concentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed'],
    limits: 'Side-on works best; front-on curls cannot be counted.',
  },
  squat: {
    id: 'squat', status: 'tested_real', kind: 'reps', views: ['side', 'front'],
    landmarks: LEG, anchor: SHOULDER, config: SQUAT, liftPhase: 'eccentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed'],
    limits: 'Front view uses a calibrated estimate of knee bend.',
  },
  shoulder_press: {
    id: 'shoulder_press', status: 'tested_real', kind: 'reps', views: ['side'],
    landmarks: ARM, anchor: HIP_PT, config: SHOULDER_PRESS, liftPhase: 'concentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed'],
    limits: 'Side-on works best.',
  },
  push_up: {
    id: 'push_up', status: 'tested_sim', kind: 'reps', views: ['side'],
    landmarks: ARM, anchor: HIP_PT, config: PUSH_UP, liftPhase: 'eccentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed', 'variant'],
    limits: 'Side view only; no real push-up clip has been checked yet.',
  },
  pull_up: {
    id: 'pull_up', status: 'experimental', kind: 'reps', views: ['front', 'back'],
    landmarks: ARM, anchor: HIP_PT, config: PULL_UP, liftPhase: 'concentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed'],
    limits: 'Experimental: face the camera with the bar and your hips in frame. Simulation-tested only.',
  },
  deadlift: {
    id: 'deadlift', status: 'experimental', kind: 'reps', views: ['side'],
    landmarks: HIP, anchor: ANKLE, config: DEADLIFT, liftPhase: 'concentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed'],
    limits: 'Experimental: side-on, whole body in frame. Measures the hip, not the bar. Simulation-tested only.',
  },
  bench: {
    id: 'bench', status: 'manual', kind: 'reps',
    reason: 'Lying on a bench, a phone camera usually cannot see the bar and both arms reliably, so bench press is not counted by the camera yet.',
  },
  lunge: {
    id: 'lunge', status: 'experimental', kind: 'reps', views: ['side'],
    landmarks: LEG, anchor: SHOULDER, config: LUNGE, liftPhase: 'eccentric_ms',
    measures: ['reps', 'rep_time', 'rom_deg', 'angular_speed', 'lead_leg'],
    limits: 'Experimental: side view, whole body in frame. Depth from the more-bent knee; front view is not supported. Simulation-tested only.',
  },
};

// Library exercises without a camera analyzer yet: registered so the app never implies support.
const NOT_YET = 'No camera analyzer has been built and tested for this exercise yet, so it is logged by tapping.';
for (const id of ['dumbbell_bench', 'goblet_squat', 'romanian_deadlift', 'bent_over_row', 'seated_cable_row', 'lat_pulldown', 'chin_up', 'dips', 'hammer_curl', 'lateral_raise', 'tricep_pushdown']) {
  ANALYZERS[id] = Object.freeze({ id, status: 'manual', kind: 'reps', reason: NOT_YET });
}
Object.freeze(ANALYZERS);

export const analyzerFor = (id) => ANALYZERS[id] ?? null;
export const countsWithCamera = (id) => Boolean(ANALYZERS[id] && ANALYZERS[id].status !== 'manual');

const LABEL = {
  tested_real: 'Camera counts it (tested on real video)',
  tested_sim: 'Camera counts it (tested in simulation)',
  experimental: 'Experimental camera counting (not validated yet)',
  manual: 'Tap to count',
};
/** Short user-facing line about camera support for an exercise. */
export const cameraLabel = (id) => (ANALYZERS[id] ? LABEL[ANALYZERS[id].status] : LABEL.manual);
