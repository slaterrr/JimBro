// Weekly schedule on top of a saved program: weekdays -> sessions, rest days, statuses,
// swaps, and the user's missed-workout policy.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProgram, parseProgramRequest, validateProgram } from './program.js';
import { calendarMonth, createSchedule, moveTrainingDay, nextScheduled, planFor, swapDates, validateSchedule } from './schedule.js';
import { nextWorkout } from './homeActions.js';

const FULL_GYM = ['barbell', 'dumbbells', 'bench', 'cable', 'machine', 'pullup_bar', 'dip_bars', 'kettlebell'];
const NY = 'America/New_York';
const intake = { goal: 'muscle', experience: 'experienced', daysPerWeek: 3, minutes: 60, equipment: FULL_GYM, avoid: [], weeks: 8, split: 'ppl' };
const program = buildProgram(intake, { id: 'p1', now: '2026-11-09T12:00:00.000Z' });
const schedule = createSchedule(program, { startDate: '2026-11-09', timeZone: NY }); // Mon start; Mon/Wed/Fri
const done = (date, planned) => ({ id: `w-${date}`, name: 'x', startedAt: `${date}T15:00:00.000Z`, finishedAt: `${date}T16:00:00.000Z`, planned, sets: [{ id: `${date}-s`, exercise: 'bench', reps: 8, weight: 100, unit: 'lb' }] });

describe('split templates', () => {
  it('push/pull/legs, bro split, upper/lower and full body are real programs', () => {
    assert.deepEqual(program.weeks[0].sessions.map((s) => s.name), ['Push', 'Pull', 'Legs']);
    assert.deepEqual(validateProgram(program, intake), []);
    const six = { ...intake, daysPerWeek: 6 };
    assert.deepEqual(buildProgram(six, { id: 'p6', now: 'n' }).weeks[0].sessions.map((s) => s.name), ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']);
    const bro = { ...intake, split: 'bro', daysPerWeek: 5 };
    const b = buildProgram(bro, { id: 'b', now: 'n' });
    assert.deepEqual(b.weeks[0].sessions.map((s) => s.name), ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms']);
    assert.deepEqual(validateProgram(b, bro), []);
    assert.ok(buildProgram({ ...intake, split: 'upper_lower', daysPerWeek: 4 }, { id: 'u', now: 'n' }).weeks[0].sessions[0].name.startsWith('Upper'));
  });

  it('rejects a split with the wrong number of days', () => {
    assert.throws(() => buildProgram({ ...intake, split: 'bro', daysPerWeek: 3 }, { id: 'x', now: 'n' }), /split/i);
  });

  it('chat requests name the split', () => {
    assert.equal(parseProgramRequest('build me a push pull legs program').intake.split, 'ppl');
    assert.equal(parseProgramRequest('make a bro split program').intake.split, 'bro');
    assert.equal(parseProgramRequest('I want an upper lower program').intake.split, 'upper_lower');
  });
});

describe('weekly schedule', () => {
  it('maps weekdays to sessions and recognizes rest days', () => {
    assert.deepEqual(validateSchedule(schedule, program), []);
    assert.equal(planFor('2026-11-09', { schedule, program }).name, 'Push');
    assert.equal(planFor('2026-11-10', { schedule, program }).type, 'rest');
    assert.equal(planFor('2026-11-11', { schedule, program }).name, 'Pull');
    assert.equal(planFor('2026-11-13', { schedule, program }).name, 'Legs');
    assert.equal(planFor('2026-11-16', { schedule, program }).week, 2);
  });

  it('statuses: completed, missed, scheduled, rest', () => {
    const history = [done('2026-11-09')];
    const today = '2026-11-12';
    assert.equal(planFor('2026-11-09', { schedule, program, history, today }).status, 'completed');
    assert.equal(planFor('2026-11-11', { schedule, program, history, today }).status, 'missed');
    assert.equal(planFor('2026-11-12', { schedule, program, history, today }).status, 'rest');
    assert.equal(planFor('2026-11-13', { schedule, program, history, today }).status, 'scheduled');
  });

  it('keep_calendar: a missed workout stays missed; push_back: it moves to the next training day', () => {
    const history = [done('2026-11-09')];
    const today = '2026-11-13';
    assert.equal(planFor('2026-11-13', { schedule, program, history, today }).name, 'Legs');
    const push = { ...schedule, missedPolicy: 'push_back' };
    const fri = planFor('2026-11-13', { schedule: push, program, history, today });
    assert.equal(fri.name, 'Pull'); // Wednesday's Pull moved to Friday
    assert.equal(planFor('2026-11-16', { schedule: push, program, history, today }).name, 'Legs');
    assert.match(planFor('2026-11-11', { schedule: push, program, history, today }).note, /moved/i);
  });

  it('swap two dates this week only, or move a training weekday permanently', () => {
    const s = swapDates(schedule, '2026-11-11', '2026-11-12');
    assert.equal(planFor('2026-11-11', { schedule: s, program }).type, 'rest');
    assert.equal(planFor('2026-11-12', { schedule: s, program }).name, 'Pull');
    assert.equal(planFor('2026-11-12', { schedule: s, program }).rescheduled, true);
    assert.equal(planFor('2026-11-18', { schedule: s, program }).name, 'Pull'); // next week unchanged
    const moved = moveTrainingDay(schedule, 'fri', 'sat');
    assert.deepEqual(validateSchedule(moved, program), []);
    assert.equal(planFor('2026-11-14', { schedule: moved, program }).name, 'Legs');
    assert.equal(planFor('2026-11-13', { schedule: moved, program }).type, 'rest');
    assert.throws(() => moveTrainingDay(schedule, 'mon', 'wed'), /already/i);
  });

  it('the next workout follows the saved split', () => {
    const history = [done('2026-11-09')];
    const n = nextScheduled({ schedule, program, history, today: '2026-11-10' });
    assert.equal(n.date, '2026-11-11');
    assert.equal(n.name, 'Pull');
    const plan = { program, schedule, days: [] };
    const started = nextWorkout(plan, history, { today: '2026-11-11' });
    assert.match(started.name, /Pull/);
    assert.equal(started.planned.scheduledFor, '2026-11-11');
    assert.equal(started.planned.items[0].exercise, program.weeks[0].sessions[1].items[0].exercise);
  });

  it('a month calendar shows completed, missed, scheduled and rest days', () => {
    const cal = calendarMonth('2026-11', { schedule, program, history: [done('2026-11-09')], today: '2026-11-12' });
    const by = Object.fromEntries(cal.days.map((d) => [d.date, d.status]));
    assert.equal(by['2026-11-09'], 'completed');
    assert.equal(by['2026-11-11'], 'missed');
    assert.equal(by['2026-11-12'], 'rest');
    assert.equal(by['2026-11-13'], 'scheduled');
    assert.equal(by['2026-11-02'], 'none'); // before the schedule started
    assert.equal(cal.days.length, 30);
    assert.equal(cal.leadingBlanks, 6); // Nov 1 2026 is a Sunday, weeks start Monday
  });

  it('validation catches a broken schedule', () => {
    assert.ok(validateSchedule({ ...schedule, week: { ...schedule.week, mon: null } }, program).length > 0);
    assert.ok(validateSchedule({ ...schedule, missedPolicy: 'whatever' }, program).length > 0);
  });
});
