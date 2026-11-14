// Exercise library metadata and equipment-aware substitutions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ANALYZERS, countsWithCamera } from './analyzers.js';
import { EXERCISES, exerciseInfo } from './exercises.js';
import { EXERCISE_MUSCLES, MUSCLE_GROUPS } from './muscles.js';
import { substitutes } from './substitute.js';

const MUSCLES = new Set(MUSCLE_GROUPS.map((m) => m.id));

describe('exercise library', () => {
  it('every exercise has muscles, a movement pattern, equipment needs, a level and a camera status', () => {
    for (const e of EXERCISES) {
      const info = exerciseInfo(e.id);
      assert.ok(info.pattern, e.id);
      assert.ok(Array.isArray(info.needs) && info.needs.length, e.id);
      assert.ok([1, 2, 3].includes(info.level), e.id);
      assert.ok(EXERCISE_MUSCLES[e.id]?.length, `${e.id} muscles`);
      assert.ok(EXERCISE_MUSCLES[e.id].every((m) => MUSCLES.has(m)), e.id);
      assert.ok(ANALYZERS[e.id], `${e.id} analyzer entry`);
    }
  });

  it('push-ups now train the chest on the muscle map', () => {
    assert.deepEqual(EXERCISE_MUSCLES.push_up.slice(0, 1), ['chest']);
  });

  it('new exercises are logged by tapping until an analyzer is built and tested', () => {
    for (const id of ['dumbbell_bench', 'goblet_squat', 'romanian_deadlift', 'bent_over_row', 'lat_pulldown', 'seated_cable_row', 'chin_up', 'dips', 'hammer_curl', 'lateral_raise', 'tricep_pushdown']) {
      assert.ok(EXERCISES.some((e) => e.id === id), id);
      assert.equal(countsWithCamera(id), false, id);
      assert.ok(ANALYZERS[id].reason.length > 10, id);
    }
  });
});

describe('substitutes', () => {
  it('bench without a barbell: dumbbell bench, then push-ups, with reasons and a load note', () => {
    const s = substitutes('bench', { equipment: ['dumbbells', 'bench'] });
    assert.equal(s.options[0].exercise, 'dumbbell_bench');
    assert.ok(s.options.some((o) => o.exercise === 'push_up'));
    for (const o of s.options) {
      assert.ok(o.reasons.length > 0);
      assert.match(o.loadNote, /start|lighter|doesn't carry|not the same/i);
    }
  });

  it('only suggests exercises from the library that the equipment allows', () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    const s = substitutes('lat_pulldown', { equipment: [] }); // bodyweight only
    assert.ok(s.options.every((o) => ids.has(o.exercise)));
    assert.ok(s.options.every((o) => !['pull_up', 'chin_up', 'seated_cable_row'].includes(o.exercise)));
    const bar = substitutes('lat_pulldown', { equipment: ['pullup_bar'] });
    assert.ok(['pull_up', 'chin_up'].includes(bar.options[0].exercise));
  });

  it('respects movement limits the user reported', () => {
    const s = substitutes('bench', { equipment: ['dumbbells', 'bench', 'barbell'], avoid: ['vertical_push'] });
    assert.ok(s.options.every((o) => exerciseInfo(o.exercise).pattern !== 'vertical_push'));
  });

  it('beginners are not sent to harder variations first', () => {
    const s = substitutes('lat_pulldown', { equipment: ['pullup_bar', 'dumbbells'], level: 1 });
    assert.notEqual(s.options[0]?.exercise, 'pull_up');
  });

  it('says so when nothing fits', () => {
    const s = substitutes('deadlift', { equipment: [] });
    assert.equal(s.options.filter((o) => exerciseInfo(o.exercise).pattern === 'hinge').length, 0);
    assert.match(s.note, /no .*hinge|nothing|closest/i);
    assert.equal(substitutes('nope', {}).options.length, 0);
  });
});
