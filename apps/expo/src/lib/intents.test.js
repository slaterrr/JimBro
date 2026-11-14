// Intent layer: chat text -> a proposed data change the UI confirms before applying.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDelete, applyUpdate, parseIntent } from './intents.js';

const s = (id, exercise, reps, weight, unit = 'lb') => ({ id, exercise, reps, weight, unit, rpe: null });
const history = [{ id: 'w1', sets: [s('h1', 'squat', 5, 225), s('h2', 'bench', 8, 135)] }];
const active = { id: 'w2', sets: [s('a1', 'curl', 10, 20), s('a2', 'squat', 5, 225)] };
const ctx = { history, active, unit: 'lb' };

describe('parseIntent: log', () => {
  it('logs a single set with a summary', () => {
    const r = parseIntent('10 curls at 20 pounds', ctx);
    assert.equal(r.type, 'log');
    assert.deepEqual(r.sets, [{ exercise: 'curl', reps: 10, weight: 20, unit: 'lb' }]);
    assert.deepEqual(r.set, r.sets[0]);
    assert.equal(r.summary, 'Log 10 × curl at 20 lb?');
  });
  it('expands "3 sets of 5"', () => {
    const r = parseIntent('did 3 sets of 5 squats at 225', ctx);
    assert.equal(r.type, 'log');
    assert.equal(r.sets.length, 3);
    assert.deepEqual(r.sets[2], { exercise: 'squat', reps: 5, weight: 225, unit: 'lb' });
    assert.equal(r.summary, 'Log 3 sets of 5 × squat at 225 lb?');
  });
  it('uses the default unit', () => {
    assert.equal(parseIntent('8 bench at 60', { ...ctx, unit: 'kg' }).set.unit, 'kg');
  });
});

describe('parseIntent: correct', () => {
  it('fixes reps on the last set', () => {
    const r = parseIntent('actually that last set was 8 reps', ctx);
    assert.equal(r.type, 'correct');
    assert.deepEqual(r.target, { setId: 'a2' });
    assert.deepEqual(r.changes, { reps: 8 });
    assert.equal(r.summary, 'Change your last squat (5 × 225 lb) to 8 × 225 lb?');
  });
  it('changes the weight on the last named exercise', () => {
    const r = parseIntent('change my last squat to 135', ctx);
    assert.deepEqual(r.target, { setId: 'a2' });
    assert.deepEqual(r.changes, { weight: 135 });
    assert.equal(r.summary, 'Change your last squat (5 × 225 lb) to 5 × 135 lb?');
  });
  it('finds sets in history', () => {
    const r = parseIntent('change my last bench to 6 reps', ctx);
    assert.deepEqual(r.target, { setId: 'h2' });
    assert.deepEqual(r.changes, { reps: 6 });
  });
  it('switches unit', () => {
    const r = parseIntent('that was kg not lb', ctx);
    assert.equal(r.type, 'correct');
    assert.deepEqual(r.target, { setId: 'a2' });
    assert.deepEqual(r.changes, { unit: 'kg' });
  });
  it('switches exercise', () => {
    const r = parseIntent('that last set was bench not squat', ctx);
    assert.deepEqual(r.target, { setId: 'a2' });
    assert.deepEqual(r.changes, { exercise: 'bench' });
    assert.equal(r.summary, 'Change your last squat (5 × 225 lb) to bench 5 × 225 lb?');
  });
  it('asks when a bare number is ambiguous', () => {
    assert.equal(parseIntent('actually that was 8', ctx).type, 'clarify');
  });
  it('asks when there is nothing to change', () => {
    assert.equal(parseIntent('change my last deadlift to 300', ctx).type, 'clarify');
    assert.equal(parseIntent('actually that was 8 reps', { history: [], active: null }).type, 'clarify');
  });
});

describe('parseIntent: delete', () => {
  it('deletes the last set', () => {
    const r = parseIntent('delete my last set', ctx);
    assert.deepEqual(r, { type: 'delete', target: { setId: 'a2' }, summary: 'Delete your last squat (5 × 225 lb)?' });
  });
  it('deletes the last named exercise', () => {
    assert.deepEqual(parseIntent('remove the last bench', ctx).target, { setId: 'h2' });
  });
  it('asks when nothing is logged', () => {
    assert.equal(parseIntent('delete my last set', { history: [], active: null }).type, 'clarify');
  });
});

describe('parseIntent: fallback', () => {
  it('questions and safety go to chat', () => {
    assert.equal(parseIntent('what should I do next on squat?', ctx).type, 'question');
    assert.equal(parseIntent('my knee hurts, delete my last set', ctx).type, 'question');
    assert.equal(parseIntent('', ctx).type, 'question');
  });
});

describe('applyUpdate / applyDelete', () => {
  const data = { history, active, settings: {} };
  it('updates active and history sets only', () => {
    const a = applyUpdate(data, 'a2', { weight: 135 });
    assert.equal(a.active.sets[1].weight, 135);
    assert.equal(a.active.sets[1].reps, 5);
    assert.equal(a.history[0].sets[0], data.history[0].sets[0]);
    const h = applyUpdate(data, 'h1', { unit: 'kg' });
    assert.equal(h.history[0].sets[0].unit, 'kg');
    assert.equal(h.active.sets[1].unit, 'lb');
  });
  it('deletes from active or history', () => {
    assert.deepEqual(applyDelete(data, 'a1').active.sets.map((x) => x.id), ['a2']);
    assert.deepEqual(applyDelete(data, 'h2').history[0].sets.map((x) => x.id), ['h1']);
    assert.equal(applyDelete({ ...data, active: null }, 'h1').active, null);
  });
});
