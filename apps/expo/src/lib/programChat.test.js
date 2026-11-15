// Chat answers about a saved program: today's workout, why an exercise, swaps, shorter sessions.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canDo } from './exercises.js';
import { buildProgram, programToPlan } from './program.js';
import { programQuery, startProgramChat } from './programChat.js';

const FULL_GYM = ['barbell', 'dumbbells', 'bench', 'cable', 'machine', 'pullup_bar', 'dip_bars', 'kettlebell'];
const intake = { goal: 'powerbuilding', experience: 'experienced', daysPerWeek: 4, minutes: 60, equipment: FULL_GYM, avoid: [], weeks: 10 };
const plan = programToPlan(buildProgram(intake, { id: 'p1', now: '2026-11-14T12:00:00.000Z' }));
const ctx = { plan, history: [], active: null, settings: { unit: 'lb' } };

describe('startProgramChat', () => {
  it('starts the intake with the first missing question', () => {
    const r = startProgramChat('Build me a 10-week powerbuilding program', { settings: {} });
    assert.equal(r.intake.goal, 'powerbuilding');
    assert.equal(r.intake.weeks, 10);
    assert.equal(r.question.id, 'experience');
  });
  it('is complete when everything is known', () => {
    const r = startProgramChat('Build me a 10-week 4-day powerbuilding program, 60 minutes', { settings: { experience: 'experienced', profile: { equipment: FULL_GYM, avoid: [] } } });
    assert.equal(r.question, null);
  });
  it('ignores other messages', () => {
    assert.equal(startProgramChat('Create a new plan', { settings: {} }), null);
  });
});

describe('programQuery', () => {
  it("answers what's today from the program", () => {
    const r = programQuery("What's today's workout?", ctx);
    assert.equal(r.type, 'today');
    assert.match(r.reply, /Week 1 · Day 1 · Upper strength/);
    assert.match(r.reply, /bench press 4 × 3–5/i);
    assert.equal(r.session.items[0].exercise, 'bench');
  });

  it('explains why an exercise is in the plan', () => {
    assert.match(programQuery('Why this exercise?', ctx).reply, /Main lift of the day/);
    const dl = programQuery('Why deadlifts?', ctx);
    assert.equal(dl.type, 'why');
    assert.match(dl.reply, /hip hinge/i);
    assert.match(programQuery('Why lateral raises?', ctx).reply, /side-shoulder/i);
    assert.match(programQuery('Why dips?', ctx).reply, /isn't in your program/i);
  });

  it('suggests equipment-aware swaps for this movement or a named one', () => {
    const r = programQuery('Swap this movement', ctx);
    assert.equal(r.type, 'swap');
    assert.equal(r.from, 'bench');
    assert.ok(r.options.length >= 1 && r.options.every((o) => o.exercise !== 'bench' && canDo(o.exercise, FULL_GYM)));
    assert.equal(programQuery('Can I swap squats for something else?', ctx).from, 'squat');
    const home = programToPlan(buildProgram({ ...intake, equipment: ['dumbbells', 'bench'] }, { id: 'p2', now: 'n' }));
    const h = programQuery('swap this movement', { ...ctx, plan: home });
    assert.ok(h.options.every((o) => canDo(o.exercise, ['dumbbells', 'bench'])));
  });

  it('makes today shorter', () => {
    const r = programQuery('Make this session shorter', ctx);
    assert.equal(r.type, 'shorter');
    assert.ok(r.session.estimated_minutes <= 45);
    assert.equal(r.session.items[0].exercise, 'bench');
    assert.ok(programQuery('make today 30 minutes', ctx).session.estimated_minutes <= 30);
  });

  it('stays out of the way without a saved program', () => {
    assert.equal(programQuery("What's today's workout?", { ...ctx, plan: { days: [] } }), null);
    assert.equal(programQuery('how was my last set?', ctx), null);
  });
});
