import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCoachSet, applyCoachSet, coachSetBody, parseCoachReport } from './coachSetChat.js';
import { missionStart, missionStep } from './mission.js';

test('reads short contextual reports and effort without inventing RIR', () => {
  assert.deepEqual(parseCoachReport('8, little grind'), { reps: 8, effortNote: 'little grind' });
  assert.deepEqual(parseCoachReport('Done 8 reps at 45 lbs, last one was hard'), {
    reps: 8, weight: 45, unit: 'lb', effortNote: 'last one was hard',
  });
  assert.deepEqual(parseCoachReport('last rep was a grind', { reps: 8 }), { reps: 8, effortNote: 'last rep was a grind' });
  assert.deepEqual(parseCoachReport('bodyweight', { awaitingWeight: true }), { weight: 0 });
  assert.equal(parseCoachReport('what about 8?'), null);
  assert.equal(parseCoachReport('8, my knee hurts'), null);
  assert.equal(parseCoachReport('0 reps'), null);
  assert.equal(parseCoachReport('8, then save another 10'), null);
});

test('keeps camera data only when the user confirms its count', () => {
  const detail = Array.from({ length: 8 }, () => ({ lift_ms: 400 }));
  const t = { exercise: 'push_up', unit: 'lb', reps: 10, camera: true };
  assert.equal(coachSetBody(t, { reps: 8, weight: 0, effortNote: 'grind' }, detail).source, 'camera');
  const corrected = coachSetBody(t, { reps: 7, weight: 0, effortNote: 'grind' }, detail);
  assert.equal(corrected.source, 'manual');
  assert.deepEqual(corrected.reps_detail, []);
  assert.equal(corrected.effortNote, 'grind');
});

test('commits one mission set and its transition atomically across camera/check races', () => {
  const mission = { items: [{ exercise: 'push_up', sets: 2, reps: 10, weight: 0, unit: 'lb', camera: true, rest_s: 90 }] };
  const state = missionStep(missionStart(mission), { type: 'ready' });
  const active = { id: 'workout', sets: [] };
  const data = { active, mission: { startedAt: 100, state } };
  const set = { exercise: 'push_up', unit: 'lb', reps: 8, weight: 0, effortNote: 'little grind', reps_detail: [] };
  const request = { workoutId: active.id, set, now: 200, slot: { startedAt: 100, index: 0, setNo: 1 } };
  const checked = { ...data, mission: { ...data.mission, state: missionStep(state, { type: 'set_done', reps: 7 }) } };
  const saved = applyCoachSet(checked, request);
  assert.equal(saved.active.sets.length, 1);
  assert.equal(saved.mission.state.log[0].reps, 8);
  assert.equal(saved.mission.state.log[0].effortNote, 'little grind');
  assert.equal(saved.mission.state.setNo, 2);
  assert.equal(saved.mission.state.phase, 'rest');
  assert.equal(saved.mission.state.restUntil, 90200);
  assert.equal(applyCoachSet(saved, request), saved);
  assert.equal(applyCoachSet(data, { ...request, workoutId: 'stale' }), data);
});

test('commits the next standalone set once and records the rest deadline', () => {
  const data = { active: { id: 'workout', sets: [] } };
  const request = {
    workoutId: 'workout', expectedCount: 0, now: 500, restSeconds: 90,
    set: { id: 'test-set', exercise: 'push_up', reps: 8, weight: 0, unit: 'lb' },
  };
  const updated = applyCoachSet(data, request);
  assert.equal(updated.active.sets.length, 1);
  assert.deepEqual(updated.active.coachRest, { exercise: 'push_up', until: 90500 });
  assert.equal(applyCoachSet(updated, request), updated);
});

test('next-set answer omits the set goal when the lift has no set target', () => {
  const text = answerCoachSet("what's next", {
    target: { exercise: 'deadlift', reps: 8, sets: null, setNo: 2, weight: 135, unit: 'lb' },
  });
  assert.equal(text, 'Deadlift · 8 reps · 135 lb.');
});
