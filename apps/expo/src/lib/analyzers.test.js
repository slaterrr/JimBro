// Exercise analyzer registry: every exercise registers how (or whether) the camera analyzes it.
// Registered is not the same as implemented, and implemented is not the same as validated.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ANALYZERS, CAMERA_STATUS, analyzerFor, cameraLabel, countsWithCamera } from './analyzers.js';
import { EXERCISES } from './exercises.js';
import { LiveSession } from './live.js';
import { CURL, MOVEMENTS, PUSH_UP, SHOULDER_PRESS, SQUAT } from './reps.js';

describe('analyzer registry', () => {
  it('every exercise in the library is registered with a known status', () => {
    for (const e of EXERCISES) {
      const a = ANALYZERS[e.id];
      assert.ok(a, `${e.id} missing`);
      assert.equal(a.id, e.id);
      assert.ok(CAMERA_STATUS.includes(a.status), `${e.id}: ${a.status}`);
    }
  });

  it('keeps the four existing camera lifts exactly as they were', () => {
    assert.equal(ANALYZERS.curl.config, CURL);
    assert.equal(ANALYZERS.squat.config, SQUAT);
    assert.equal(ANALYZERS.shoulder_press.config, SHOULDER_PRESS);
    assert.equal(ANALYZERS.push_up.config, PUSH_UP);
    for (const id of ['curl', 'squat', 'shoulder_press']) assert.equal(ANALYZERS[id].status, 'tested_real');
    assert.equal(ANALYZERS.push_up.status, 'tested_sim'); // no real push-up clip yet
  });

  it('counting analyzers declare what they need and measure', () => {
    for (const a of Object.values(ANALYZERS).filter((x) => x.status !== 'manual')) {
      assert.equal(a.kind, 'reps', a.id);
      assert.ok(a.views.length > 0, a.id);
      assert.ok(a.landmarks.left.length === 3 && a.landmarks.right.length === 3, a.id);
      assert.ok(Number.isInteger(a.anchor.left) && Number.isInteger(a.anchor.right), a.id);
      assert.ok(['concentric_ms', 'eccentric_ms'].includes(a.liftPhase), a.id);
      assert.ok(a.config && a.config.span > 0, a.id);
      assert.ok(a.limits.length > 0, a.id);
      assert.ok(MOVEMENTS[a.id], `${a.id} not in MOVEMENTS`);
    }
  });

  it('manual exercises give a reason and the camera refuses them', () => {
    for (const id of ['bench', 'lunge']) {
      assert.equal(ANALYZERS[id].status, 'manual');
      assert.ok(ANALYZERS[id].reason.length > 10);
      assert.equal(countsWithCamera(id), false);
      assert.throws(() => new LiveSession(id), /tap to count|not counted by the camera/i);
    }
  });

  it('pull-up and deadlift are experimental: counted, and labelled as not validated', () => {
    for (const id of ['pull_up', 'deadlift']) {
      assert.equal(ANALYZERS[id].status, 'experimental');
      assert.equal(countsWithCamera(id), true);
      assert.match(cameraLabel(id), /experimental/i);
      assert.doesNotThrow(() => new LiveSession(id));
    }
  });

  it('labels say how much each one has been tested', () => {
    assert.match(cameraLabel('curl'), /real video/i);
    assert.match(cameraLabel('push_up'), /simulation/i);
    assert.match(cameraLabel('bench'), /tap/i);
    assert.equal(analyzerFor('nope'), null);
    assert.equal(countsWithCamera('nope'), false);
  });

  it('exercise list camera flag follows the registry', () => {
    for (const e of EXERCISES) assert.equal(e.camera, countsWithCamera(e.id), e.id);
  });
});
