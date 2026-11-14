// Workout Mission: "I have 20 minutes, help me finish chest day" -> an explained, time-boxed
// session from the user's history, run hands-free, checked at the end.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  currentTarget,
  missionStart,
  missionStep,
  missionSummary,
  parseMission,
  planMission,
  shouldEndSet,
} from './mission.js';

const NOW = new Date('2026-11-14T18:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
let id = 0;
const set = (exercise, weight, reps, rpe, unit = 'lb') => ({ id: `s${++id}`, exercise, weight, reps, rpe, unit });
const workout = (n, sets) => ({ id: `w${n}`, name: 'Session', startedAt: day(n), sets });

describe('parseMission', () => {
  it('reads minutes and focus from natural requests', () => {
    assert.deepEqual(parseMission('I have 20 minutes; help me finish chest day'), { minutes: 20, focus: 'chest', recognized: true });
    assert.deepEqual(parseMission('30 min leg day'), { minutes: 30, focus: 'legs', recognized: true });
    assert.deepEqual(parseMission('quick full body workout, 45 mins'), { minutes: 45, focus: 'full', recognized: true });
    assert.equal(parseMission('back and biceps for half an hour').focus, 'back');
    assert.equal(parseMission('back and biceps for half an hour').minutes, 30);
    assert.equal(parseMission('arms today, an hour').minutes, 60);
  });

  it('ignores messages that are not session requests', () => {
    assert.equal(parseMission('log 3x10 curls at 25').recognized, false);
    assert.equal(parseMission('how was my bench last week?').recognized, false);
    assert.equal(parseMission('hello').recognized, false);
  });
});

describe('planMission', () => {
  const history = [
    workout(3, [set('bench', 185, 8, 7), set('bench', 185, 8, 7.5)]),
    workout(10, [set('squat', 225, 5, 8)]),
  ];
  const settings = { fitnessGoal: 'muscle', unit: 'lb' };

  it('fits the time budget and prefers lifts that train the focus', () => {
    const m = planMission({ minutes: 20, focus: 'chest', history, settings, now: NOW });
    assert.ok(m.items.length >= 1);
    assert.ok(m.estMinutes <= 20, `estimated ${m.estMinutes} min`);
    assert.equal(m.items[0].exercise, 'bench');
    assert.ok(m.items.every((i) => ['bench', 'push_up', 'shoulder_press'].includes(i.exercise)));
  });

  it('progresses load from history and explains every choice', () => {
    const m = planMission({ minutes: 20, focus: 'chest', history, settings, now: NOW });
    const bench = m.items.find((i) => i.exercise === 'bench');
    // Last bench was RPE 7.5: good working effort -> same load, one more rep.
    assert.equal(bench.weight, 185);
    assert.ok(bench.why.length > 0);
    assert.ok(m.reasons.some((r) => /20 min/.test(r)));
    assert.ok(m.items.every((i) => typeof i.camera === 'boolean'));
  });

  it('picks the least recently trained area when no focus is given', () => {
    const m = planMission({ minutes: 30, focus: null, history, settings, now: NOW });
    assert.notEqual(m.focus, 'chest'); // chest was trained 3 days ago
    assert.ok(m.reasons.some((r) => /haven't trained|not trained|rested/i.test(r)));
  });

  it('works with no history (bodyweight or light start) and a longer budget adds work', () => {
    const short = planMission({ minutes: 15, focus: 'legs', history: [], settings, now: NOW });
    const long = planMission({ minutes: 45, focus: 'legs', history: [], settings, now: NOW });
    const sets = (m) => m.items.reduce((t, i) => t + i.sets, 0);
    assert.ok(sets(long) > sets(short));
    assert.ok(short.items.every((i) => i.weight === null || i.weight === 0 || i.weight > 0));
    assert.ok(short.items.some((i) => /light|no history|start/i.test(i.why)));
  });
});

describe('mission wording', () => {
  it('describes bodyweight history in reps and joins lists naturally', async () => {
    const { listText } = await import('./mission.js');
    assert.equal(listText(['squat', 'shoulder press', 'bicep curl']), 'squat, shoulder press and bicep curl');
    const m = planMission({ minutes: 30, focus: 'back', history: [workout(4, [set('pull_up', 0, 8, 8)])], settings: { unit: 'lb' }, now: NOW });
    const pull = m.items.find((i) => i.exercise === 'pull_up');
    assert.match(pull.why, /8 reps, bodyweight/);
    assert.doesNotMatch(pull.why, /0 lb/);
  });
});

describe('guided session', () => {
  const mission = {
    title: 'Chest',
    minutes: 20,
    estMinutes: 18,
    focus: 'chest',
    reasons: [],
    items: [
      { exercise: 'bench', sets: 2, reps: 8, weight: 185, unit: 'lb', rest_s: 90, camera: false, why: '' },
      { exercise: 'push_up', sets: 1, reps: 12, weight: 0, unit: 'lb', rest_s: 60, camera: true, why: '' },
    ],
  };

  it('runs position -> set -> check -> rest through every set, then done', () => {
    let s = missionStart(mission);
    assert.equal(s.phase, 'position');
    assert.deepEqual(currentTarget(s), { exercise: 'bench', setNo: 1, sets: 2, reps: 8, weight: 185, unit: 'lb', camera: false, rest_s: 90 });
    s = missionStep(s, { type: 'ready' });
    assert.equal(s.phase, 'set');
    s = missionStep(s, { type: 'set_done', reps: 8 });
    assert.equal(s.phase, 'check');
    s = missionStep(s, { type: 'confirm', rpe: 7 });
    assert.equal(s.phase, 'rest');
    assert.equal(s.log.length, 1);
    // RPE 7 -> room to add load for the next set.
    assert.ok(currentTarget(s).weight > 185);
    assert.ok(s.note && /RPE 7/.test(s.note));
    s = missionStep(s, { type: 'rest_done' });
    assert.equal(s.phase, 'position');
    s = missionStep(missionStep(missionStep(s, { type: 'ready' }), { type: 'set_done', reps: 8 }), { type: 'confirm', rpe: 9 });
    assert.equal(currentTarget(s).exercise, 'push_up');
    s = missionStep(missionStep(missionStep(missionStep(s, { type: 'rest_done' }), { type: 'ready' }), { type: 'set_done', reps: 12 }), { type: 'confirm', rpe: null });
    assert.equal(s.phase, 'done');
    assert.equal(s.log.length, 3);
  });

  it('can skip an exercise, switch it, or end early', () => {
    let s = missionStart(mission);
    s = missionStep(s, { type: 'switch', exercise: 'shoulder_press' });
    assert.equal(currentTarget(s).exercise, 'shoulder_press');
    assert.ok(s.changes.some((c) => /shoulder press/i.test(c)));
    s = missionStep(s, { type: 'skip' });
    assert.equal(currentTarget(s).exercise, 'push_up');
    s = missionStep(s, { type: 'end' });
    assert.equal(s.phase, 'done');
  });

  it('ignores events that do not fit the current phase', () => {
    const s = missionStart(mission);
    assert.equal(missionStep(s, { type: 'confirm', rpe: 7 }), s);
    assert.equal(missionStep(s, { type: 'rest_done' }), s);
  });
});

describe('shouldEndSet', () => {
  it('ends after the target with a short pause, or after a long pause with reps done', () => {
    assert.equal(shouldEndSet({ count: 8, target: 8, msSinceLastRep: 2500 }), true);
    assert.equal(shouldEndSet({ count: 8, target: 8, msSinceLastRep: 800 }), false);
    assert.equal(shouldEndSet({ count: 5, target: 8, msSinceLastRep: 4500 }), false);
    assert.equal(shouldEndSet({ count: 5, target: 8, msSinceLastRep: 6500 }), true);
    assert.equal(shouldEndSet({ count: 0, target: 8, msSinceLastRep: 20000 }), false);
  });
});

describe('missionSummary', () => {
  it('checks the result against the plan', () => {
    const mission = {
      title: 'Chest', minutes: 20, estMinutes: 18, focus: 'chest', reasons: [],
      items: [
        { exercise: 'bench', sets: 2, reps: 8, weight: 185, unit: 'lb', rest_s: 90, camera: false, why: '' },
        { exercise: 'push_up', sets: 1, reps: 12, weight: 0, unit: 'lb', rest_s: 60, camera: true, why: '' },
      ],
    };
    const log = [
      { exercise: 'bench', reps: 8, target: 8, weight: 185, unit: 'lb', rpe: 7, camera: false },
      { exercise: 'bench', reps: 7, target: 8, weight: 190, unit: 'lb', rpe: 9, camera: false },
      { exercise: 'push_up', reps: 12, target: 12, weight: 0, unit: 'lb', rpe: null, camera: true },
    ];
    const r = missionSummary(mission, log, { startedAt: 0, endedAt: 17 * 60000 });
    assert.equal(r.setsPlanned, 3);
    assert.equal(r.setsDone, 3);
    assert.equal(r.repsDone, 27);
    assert.equal(r.repsTarget, 28);
    assert.equal(r.cameraReps, 12);
    assert.equal(r.minutes, 17);
    assert.equal(r.onTime, true);
    assert.ok(r.lines.length >= 2);
    assert.ok(r.nextTime.some((t) => /bench/i.test(t)));
  });
});
