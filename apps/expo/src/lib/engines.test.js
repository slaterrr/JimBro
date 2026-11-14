// Vision engine -> events -> coach engine. Simulated landmarks test the plumbing, not real accuracy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { simulateLunges, simulateSet } from '../../../../tools/vision-lab/lib/simulate.mjs';
import { createCoach } from './coachEngine.js';
import { EVENT_TYPES, SCHEMA_VERSION, makeEvent, validateEvent } from './events.js';
import { analyzeRecording, createVisionSession } from './visionEngine.js';

describe('event contract', () => {
  it('lists the required event types and versions every event', () => {
    for (const t of ['ExerciseDetected', 'ExerciseMismatch', 'RepStarted', 'RepCompleted', 'SetCompleted', 'FormObservation', 'PerformanceMeasurement', 'FatigueAssessment', 'LoadRecommendation', 'CoachResponse', 'WorkoutSummary']) {
      assert.ok(EVENT_TYPES.includes(t), t);
    }
    const e = makeEvent('RepCompleted', { sessionId: 's1', exerciseId: 'curl', source: 'vision', validation: 'tested_real', confidence: 0.9, data: { repIndex: 1, count: 1, lift_ms: 900, lower_ms: 1100, pause_ms: 100, rom_deg: 110 } });
    assert.equal(e.schemaVersion, SCHEMA_VERSION);
    assert.ok(e.eventId && e.timestamp && e.units);
    assert.equal(e.units.lift_ms, 'ms');
    assert.deepEqual(validateEvent(e), { ok: true, errors: [] });
  });

  it('rejects malformed events', () => {
    assert.equal(validateEvent({ type: 'Nope' }).ok, false);
    const bad = makeEvent('RepCompleted', { sessionId: 's1', exerciseId: 'curl', source: 'vision', validation: 'tested_real', data: { repIndex: 1 } });
    const v = validateEvent(bad);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((x) => /count/.test(x)));
    assert.equal(validateEvent({ ...bad, data: { ...bad.data, count: 1 }, validation: 'made_up' }).ok, false);
  });

  it('uncalibrated measurements say so', () => {
    const e = makeEvent('PerformanceMeasurement', { sessionId: 's', exerciseId: 'curl', source: 'vision', validation: 'tested_real', data: { calibrated: false, meanLiftMs: 900, velocityLossPct: 10, omitted: [] } });
    assert.equal(validateEvent(e).ok, true);
    const lie = { ...e, data: { ...e.data, velocity_mps: 0.5 } };
    assert.equal(validateEvent(lie).ok, false); // no m/s without calibration
  });
});

describe('vision engine', () => {
  it('emits valid rep events that match the live counter, then a set summary', () => {
    const { frames, trueEnds } = simulateSet('curl', { reps: 6, seed: 3 });
    const events = [];
    const v = createVisionSession({ exerciseId: 'curl', sessionId: 'sess', onEvent: (e) => events.push(e) });
    frames.forEach((f) => v.frame(f.t, f.pose));
    v.finishSet({ target: 6 });
    assert.ok(events.every((e) => validateEvent(e).ok), JSON.stringify(events.map(validateEvent).filter((x) => !x.ok)[0]));
    const reps = events.filter((e) => e.type === 'RepCompleted');
    assert.equal(reps.length, trueEnds.length);
    assert.equal(events.filter((e) => e.type === 'RepStarted').length >= reps.length, true);
    assert.ok(events.some((e) => e.type === 'ExerciseDetected'));
    const set = events.find((e) => e.type === 'SetCompleted');
    assert.equal(set.data.count, 6);
    const perf = events.find((e) => e.type === 'PerformanceMeasurement');
    assert.equal(perf.data.calibrated, false);
    assert.equal(set.validation, 'tested_real'); // curl's analyzer status
  });

  it('reports a mismatch, not reps, for lunges in squat mode', () => {
    const { frames } = simulateLunges({ reps: 6 });
    const events = [];
    const v = createVisionSession({ exerciseId: 'squat', sessionId: 's', onEvent: (e) => events.push(e) });
    frames.forEach((f) => v.frame(f.t, f.pose));
    assert.equal(events.filter((e) => e.type === 'RepCompleted').length, 0);
    const mm = events.filter((e) => e.type === 'ExerciseMismatch');
    assert.ok(mm.length >= 1);
    assert.equal(mm.length <= 6, true); // one per episode, not one per frame
    assert.equal(mm.at(-1).data.observed, 'lunge');
  });

  it('prerecorded frames go through the same logic as live frames', () => {
    const { frames } = simulateSet('squat', { reps: 5, seed: 9 });
    const live = [];
    const v = createVisionSession({ exerciseId: 'squat', sessionId: 'x', onEvent: (e) => live.push(e) });
    frames.forEach((f) => v.frame(f.t, f.pose));
    v.finishSet({ target: 5 });
    const rec = analyzeRecording(frames, { exerciseId: 'squat', target: 5 });
    const strip = (es) => es.map(({ type, data }) => ({ type, data }));
    assert.deepEqual(strip(rec.events), strip(live));
    assert.equal(rec.count, 5);
  });

  it('manual exercises cannot start a camera session', () => {
    assert.throws(() => createVisionSession({ exerciseId: 'bench', sessionId: 's', onEvent: () => {} }), /tap to count/i);
  });
});

describe('coach engine', () => {
  const setEvents = () => {
    const { frames } = simulateSet('curl', { reps: 8, seed: 5, slowdown: 1.2 });
    const events = [];
    const v = createVisionSession({ exerciseId: 'curl', sessionId: 'c', onEvent: (e) => events.push(e) });
    frames.forEach((f) => v.frame(f.t, f.pose));
    v.finishSet({ target: 8 });
    return events;
  };

  it('turns a completed set into fatigue, a recommendation needing approval, and one short spoken summary', () => {
    const out = [];
    const coach = createCoach({ sessionId: 'c', frequency: 'normal', onEvent: (e) => out.push(e) });
    for (const e of setEvents()) coach.handle(e);
    coach.completeSet({ weight: 30, unit: 'lb', rir: 2 });
    assert.ok(out.every((e) => validateEvent(e).ok));
    const fat = out.find((e) => e.type === 'FatigueAssessment');
    assert.ok(fat);
    const rec = out.find((e) => e.type === 'LoadRecommendation');
    assert.equal(rec.data.needsApproval, true);
    const after = out.filter((e) => e.type === 'CoachResponse' && e.data.kind === 'after_set');
    assert.equal(after.length, 1);
  });

  it('speaks rep counts only at "normal" frequency, never repeats a cue, and stays silent when off', () => {
    const run = (frequency) => {
      const out = [];
      const coach = createCoach({ sessionId: 'c', frequency, onEvent: (e) => out.push(e) });
      for (const e of setEvents()) coach.handle(e);
      return out.filter((e) => e.type === 'CoachResponse' && e.data.speak);
    };
    const normal = run('normal');
    assert.ok(normal.some((e) => e.data.kind === 'count'));
    const texts = normal.filter((e) => e.data.kind === 'cue').map((e) => e.data.text);
    assert.equal(new Set(texts).size, texts.length);
    assert.equal(run('minimal').filter((e) => e.data.kind === 'count').length, 0);
    assert.equal(run('off').length, 0);
  });

  it('answers questions from records and says when it cannot', () => {
    const coach = createCoach({ sessionId: 'c', onEvent: () => {} });
    const r = coach.ask('how was my last set?', { history: [], active: null });
    assert.equal(r.type, 'CoachResponse');
    assert.match(r.data.text, /don't have a set/i);
    assert.equal(coach.ask('tell me a joke', { history: [], active: null }), null); // not deterministic: hand to the AI
  });
});
