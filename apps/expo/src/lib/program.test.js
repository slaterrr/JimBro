// Multi-week training programs: intake, generation, validation, versions, swaps and shorter sessions.
// Original JimBro plans built from general programming principles; no external program is copied.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canDo, exerciseInfo } from './exercises.js';
import { nextWorkout } from './homeActions.js';
import {
  answerIntake, buildProgram, nextQuestion, parseProgramRequest, prefillIntake, programNext, programToPlan,
  shortenSession, swapExercise, validateIntake, validateProgram, weeklySets,
} from './program.js';

const FULL_GYM = ['barbell', 'dumbbells', 'bench', 'cable', 'machine', 'pullup_bar', 'dip_bars', 'kettlebell'];
const base = { goal: 'powerbuilding', experience: 'experienced', daysPerWeek: 4, minutes: 60, equipment: FULL_GYM, avoid: [], weeks: 10 };
const opts = { id: 'p1', now: '2026-11-14T12:00:00.000Z', unit: 'lb' };
const items = (program) => program.weeks.flatMap((w) => w.sessions.flatMap((s) => s.items));
const setsIn = (week) => week.sessions.reduce((t, s) => t + s.items.reduce((a, i) => a + i.sets, 0), 0);

describe('program request and intake', () => {
  it('recognizes program requests and reads the details given', () => {
    const r = parseProgramRequest('Build me a 10-week 4-day powerbuilding program, 60 minutes a session');
    assert.equal(r.recognized, true);
    assert.deepEqual({ ...r.intake }, { goal: 'powerbuilding', daysPerWeek: 4, weeks: 10, minutes: 60 });
    assert.equal(parseProgramRequest('Build me a full training program').recognized, true);
    assert.equal(parseProgramRequest('Create a new plan').recognized, false); // weekly plan panel stays
    assert.equal(parseProgramRequest('how was my last set?').recognized, false);
  });

  it('asks only for what is missing, in order, and prefills saved settings', () => {
    const intake = prefillIntake({ goal: 'powerbuilding', daysPerWeek: 4 }, { experience: 'new', profile: { equipment: ['dumbbells'] } });
    assert.equal(intake.experience, 'new');
    assert.deepEqual(intake.equipment, ['dumbbells']);
    assert.equal(nextQuestion(intake).id, 'minutes');
    assert.equal(nextQuestion({ ...base }), null);
    assert.ok(nextQuestion({}).question.length > 10);
  });

  it('parses typed answers and rejects invalid ones with a reason', () => {
    assert.deepEqual(answerIntake({}, 'daysPerWeek', '4 days').intake, { daysPerWeek: 4 });
    assert.equal(answerIntake({}, 'daysPerWeek', '9 days').ok, false);
    assert.match(answerIntake({}, 'daysPerWeek', '9 days').error, /2.*5/);
    assert.deepEqual(answerIntake({}, 'equipment', 'full gym').intake.equipment, FULL_GYM);
    assert.deepEqual(answerIntake({}, 'equipment', 'just dumbbells and a bench').intake.equipment, ['dumbbells', 'bench']);
    assert.deepEqual(answerIntake({}, 'avoid', 'none').intake.avoid, []);
    assert.deepEqual(answerIntake({}, 'avoid', 'my knees get sore').intake.avoid, ['squat', 'lunge']);
    assert.equal(answerIntake({}, 'weeks', '10').intake.weeks, 10);
    assert.equal(answerIntake({}, 'weeks', '40').ok, false);
    assert.equal(answerIntake({}, 'experience', "I'm a beginner").intake.experience, 'new');
    assert.equal(answerIntake({}, 'goal', 'banana').ok, false);
    assert.equal(answerIntake({}, 'minutes', 60).intake.minutes, 60); // chip values too
  });

  it('validateIntake lists every bad field', () => {
    assert.deepEqual(validateIntake(base), []);
    const bad = validateIntake({ ...base, daysPerWeek: 7, minutes: 5, weeks: 30, equipment: ['laser'], goal: 'x', experience: 'y' });
    assert.equal(bad.length, 6);
  });
});

describe('buildProgram', () => {
  const program = buildProgram(base, opts);

  it('builds a complete, valid multi-week block', () => {
    assert.equal(program.schema, 'jimbro.program.v1');
    assert.equal(program.weeks.length, 10);
    assert.ok(program.weeks.every((w) => w.sessions.length === 4));
    assert.deepEqual(validateProgram(program, base), []);
    assert.match(program.name, /powerbuilding/i);
    assert.ok(program.progression.increase && program.progression.hold && program.progression.reduce && program.deload);
  });

  it('every session has a name, focus, warm-up, order, duration; every item has full prescriptions', () => {
    for (const w of program.weeks) for (const s of w.sessions) {
      assert.ok(s.name && s.focus && s.warmup.length && s.estimated_minutes <= 60, `${w.week}/${s.day}`);
      for (const i of s.items) {
        assert.ok(exerciseInfo(i.exercise), i.exercise);
        assert.ok(canDo(i.exercise, FULL_GYM));
        assert.ok(i.sets >= 1 && i.reps_low >= 1 && i.reps_low <= i.reps_high);
        assert.ok(i.rpe_low >= 5 && i.rpe_high <= 9.5 && i.rpe_low <= i.rpe_high);
        assert.ok(i.rest_sec >= 30 && i.rest_sec <= 240);
        assert.ok(i.load?.text && i.why);
        assert.ok(i.substitutes.every((x) => exerciseInfo(x) && x !== i.exercise));
      }
    }
  });

  it('pairs compound strength work with hypertrophy accessories and covers push, pull, squat and hinge', () => {
    const w1 = program.weeks[0].sessions;
    assert.ok(w1.some((s) => s.items.some((i) => i.role === 'main' && i.reps_high <= 6)));
    assert.ok(w1.some((s) => s.items.some((i) => i.role === 'accessory' && i.reps_high >= 12)));
    const patterns = new Set(w1.flatMap((s) => s.items.map((i) => exerciseInfo(i.exercise).pattern)));
    for (const p of ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'squat', 'hinge']) assert.ok(patterns.has(p), p);
  });

  it('schedules deloads (every 4th week and the last week) with less volume and easier effort', () => {
    const deloads = program.weeks.filter((w) => w.deload).map((w) => w.week);
    assert.deepEqual(deloads, [4, 8, 10]);
    for (const n of deloads) {
      const week = program.weeks[n - 1];
      assert.ok(setsIn(week) < setsIn(program.weeks[n - 2]));
      assert.ok(week.sessions.every((s) => s.items.every((i) => i.rpe_high <= 6)));
    }
  });

  it('effort builds across each wave', () => {
    const main = (w) => program.weeks[w - 1].sessions[0].items[0];
    assert.ok(main(1).rpe_high < main(3).rpe_high);
  });

  it('respects equipment and limitations', () => {
    const home = { ...base, equipment: ['dumbbells', 'bench'], avoid: ['hinge'] };
    const p = buildProgram(home, opts);
    assert.deepEqual(validateProgram(p, home), []);
    assert.ok(items(p).every((i) => canDo(i.exercise, home.equipment)));
    assert.ok(items(p).every((i) => exerciseInfo(i.exercise).pattern !== 'hinge'));
    assert.ok(items(p).every((i) => i.substitutes.every((x) => canDo(x, home.equipment) && exerciseInfo(x).pattern !== 'hinge')));
  });

  it('fits the session time', () => {
    for (const minutes of [30, 45]) {
      const p = buildProgram({ ...base, minutes }, opts);
      assert.ok(p.weeks.every((w) => w.sessions.every((s) => s.estimated_minutes <= minutes && s.items.length >= 1)), String(minutes));
      assert.deepEqual(validateProgram(p, { ...base, minutes }), []);
    }
  });

  it('reduces workload for beginners: fewer sets, easier effort, no low-rep heavy work, no skill lifts', () => {
    const beginner = buildProgram({ ...base, experience: 'new' }, opts);
    assert.deepEqual(validateProgram(beginner, { ...base, experience: 'new' }), []);
    assert.ok(setsIn(beginner.weeks[0]) < setsIn(program.weeks[0]));
    assert.ok(items(beginner).every((i) => i.rpe_high <= 7.5 && i.reps_low >= 5));
    assert.ok(items(beginner).every((i) => exerciseInfo(i.exercise).level <= 2));
  });

  it('keeps weekly volume per muscle within limits', () => {
    for (const w of program.weeks) for (const [muscle, n] of Object.entries(weeklySets(w))) assert.ok(n <= 20, `${muscle} ${n}`);
  });

  it('offers full-body for 2-3 days and a 5th day for 5', () => {
    for (const daysPerWeek of [2, 3, 5]) {
      const intake = { ...base, goal: 'muscle', daysPerWeek };
      const p = buildProgram(intake, opts);
      assert.equal(p.weeks[0].sessions.length, daysPerWeek);
      assert.deepEqual(validateProgram(p, intake), [], String(daysPerWeek));
    }
  });

  it('is deterministic for the same intake', () => {
    assert.deepEqual(buildProgram(base, opts), program);
  });

  it('throws on invalid intake instead of guessing', () => {
    assert.throws(() => buildProgram({ ...base, daysPerWeek: 9 }, opts), /days/i);
  });
});

describe('load guidance never invents numbers', () => {
  const history = [{ id: 'w1', startedAt: '2026-11-10T10:00:00.000Z', sets: [
    { id: 's1', exercise: 'squat', reps: 5, weight: 225, unit: 'lb', rpe: 7, loggedAt: '2026-11-10T10:10:00.000Z' },
    { id: 's2', exercise: 'bench', reps: 8, weight: 155, unit: 'lb', rpe: null, loggedAt: '2026-11-10T10:30:00.000Z' },
  ] }];

  it('uses logged weights and effort when they exist', () => {
    const p = buildProgram(base, { ...opts, history });
    const first = (id) => p.weeks[0].sessions.flatMap((s) => s.items).find((i) => i.exercise === id);
    assert.deepEqual(first('squat').load.from, { setId: 's1', weight: 225, unit: 'lb', reps: 5, rpe: 7 });
    assert.match(first('squat').load.text, /225 lb/);
    assert.match(first('bench').load.text, /155 lb/);
    assert.match(first('bench').load.text, /rate/i);
  });

  it('without history: no weights, no 1RM, no max test', () => {
    for (const i of items(buildProgram(base, opts))) {
      assert.equal(i.load.from ?? null, null);
      assert.doesNotMatch(i.load.text, /\d+\s?(lb|kg)/);
      assert.doesNotMatch(i.load.text, /1RM|one-rep max/i);
    }
  });

  it('validator rejects a load that is not backed by history', () => {
    const p = buildProgram(base, opts);
    p.weeks[0].sessions[0].items[0].load = { text: 'Use 300 lb', from: { setId: 'nope', weight: 300, unit: 'lb' } };
    assert.ok(validateProgram(p, base, { history }).some((x) => /history/i.test(x)));
  });
});

describe('validateProgram catches bad programs', () => {
  const fresh = () => buildProgram(base, opts);
  const cases = [
    ['unknown exercise', (p) => { p.weeks[0].sessions[0].items[0].exercise = 'moon_press'; }, /unknown exercise/i],
    ['equipment', (p) => { p.weeks[0].sessions[0].items[0].exercise = 'tricep_pushdown'; }, null],
    ['effort', (p) => { p.weeks[0].sessions[0].items[0].rpe_high = 11; }, /effort|rpe/i],
    ['time', (p) => { p.weeks[0].sessions[0].estimated_minutes = 95; }, /minutes/i],
    ['weeks', (p) => { p.weeks.pop(); }, /weeks/i],
    ['reps', (p) => { p.weeks[0].sessions[0].items[0].reps_low = 0; }, /reps/i],
  ];
  for (const [name, mutate, pattern] of cases) {
    it(name, () => {
      const p = fresh();
      mutate(p);
      const intake = name === 'equipment' ? { ...base, equipment: ['barbell', 'bench'] } : base;
      const problems = validateProgram(p, intake);
      assert.ok(problems.length > 0, name);
      if (pattern) assert.ok(problems.some((x) => pattern.test(x)), problems.join('; '));
    });
  }
});

describe('saving, position, swaps and shorter sessions', () => {
  const program = buildProgram(base, opts);

  it('a saved program is a plan that existing screens understand', () => {
    const plan = programToPlan(program);
    assert.equal(plan.program.id, 'p1');
    assert.equal(plan.days.length, 4);
    assert.ok(plan.days.every((d) => d.items.every((i) => i.exercise && i.sets && i.reps_low && i.rest_min > 0)));
  });

  it('tracks the week and day from completed program workouts', () => {
    const plan = programToPlan(program);
    assert.equal(programNext(program, []).week, 1);
    const done = Array.from({ length: 5 }, (_, k) => ({ id: `w${k}`, planned: { programId: 'p1', week: 1 + Math.floor(k / 4), day: (k % 4) + 1 }, sets: [{}] }));
    const next = programNext(program, done);
    assert.equal(next.week, 2);
    assert.equal(next.day, 2);
    assert.equal(next.planned.programId, 'p1');
    assert.match(next.name, /Week 2/);
    assert.equal(nextWorkout(plan, done).name, next.name);
    const all = Array.from({ length: 40 }, (_, k) => ({ id: `w${k}`, planned: { programId: 'p1' }, sets: [{}] }));
    assert.equal(programNext(program, all).done, true);
  });

  it('swaps an exercise from a week onward as a new version, validated', () => {
    const r = swapExercise(program, { from: 'bench', to: 'dumbbell_bench', fromWeek: 2 }, base);
    assert.equal(r.program.version, program.version + 1);
    assert.ok(r.program.weeks[0].sessions.some((s) => s.items.some((i) => i.exercise === 'bench')));
    assert.ok(r.program.weeks.slice(1).every((w) => w.sessions.every((s) => s.items.every((i) => i.exercise !== 'bench'))));
    assert.deepEqual(validateProgram(r.program, base), []);
    assert.ok(swapExercise(program, { from: 'bench', to: 'tricep_pushdown', fromWeek: 1 }, { ...base, equipment: ['barbell', 'bench'] }).error);
    assert.ok(swapExercise(program, { from: 'bench', to: 'moon_press', fromWeek: 1 }, base).error);
  });

  it('shortens one session without dropping the main lift', () => {
    const s = program.weeks[0].sessions[0];
    const short = shortenSession(s, 30);
    assert.ok(short.estimated_minutes <= 30);
    assert.equal(short.items[0].exercise, s.items[0].exercise);
    assert.ok(short.items.length <= s.items.length);
  });
});

describe('every combination produces a valid program', () => {
  it('goals × experience × days × minutes × equipment × limitations', () => {
    const gear = [FULL_GYM, ['dumbbells', 'bench'], [], ['barbell', 'bench'], ['cable', 'machine'], ['kettlebell', 'pullup_bar']];
    const avoids = [[], ['squat', 'lunge'], ['hinge'], ['vertical_push', 'dip']];
    let n = 0;
    for (const goal of ['powerbuilding', 'strength', 'muscle', 'general', 'endurance', 'fat_loss'])
      for (const experience of ['new', 'returning', 'experienced'])
        for (const daysPerWeek of [2, 3, 4, 5])
          for (const minutes of [30, 40, 45, 60, 90])
            for (const equipment of gear)
              for (const avoid of avoids) {
                const intake = { goal, experience, daysPerWeek, minutes, equipment, avoid, weeks: 8 };
                const p = buildProgram(intake, opts);
                assert.deepEqual(validateProgram(p, intake), [], JSON.stringify(intake));
                assert.ok(p.weeks.every((w) => w.sessions.every((s) => s.items.length >= 1)), JSON.stringify(intake));
                n += 1;
              }
    assert.equal(n, 6 * 3 * 4 * 5 * 6 * 4);
  });
});
