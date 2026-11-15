// Gym attendance: one gym day per calendar day (in the user's time zone), from completed workouts only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, attendance, dayKey, gymDays, weekdayOf, workoutMinutes } from './attendance.js';

const w = (id, start, minutes = 60, sets = 3) => ({
  id, name: 'Push', startedAt: start, finishedAt: new Date(new Date(start).getTime() + minutes * 60000).toISOString(),
  sets: Array.from({ length: sets }, (_, i) => ({ id: `${id}-s${i}`, exercise: 'bench', reps: 8, weight: 135, unit: 'lb' })),
});
const NY = 'America/New_York';

describe('days', () => {
  it('uses the local calendar day of the time zone', () => {
    assert.equal(dayKey('2026-11-10T03:30:00.000Z', NY), '2026-11-09'); // 10:30 pm in New York
    assert.equal(dayKey('2026-11-10T03:30:00.000Z', 'UTC'), '2026-11-10');
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(weekdayOf('2026-11-09'), 'mon');
  });
});

describe('attendance', () => {
  const now = new Date('2026-11-14T15:00:00.000Z'); // Saturday
  const history = [
    w('a', '2026-11-09T14:00:00.000Z'), // Mon
    w('b', '2026-11-10T14:00:00.000Z', 70), // Tue
    w('c', '2026-11-10T22:00:00.000Z', 30), // Tue again: same gym day
    w('d', '2026-11-11T14:00:00.000Z'), // Wed
    w('e', '2026-10-20T14:00:00.000Z'), // last month
  ];

  it('completing a workout counts that calendar day once, however many workouts', () => {
    assert.deepEqual(gymDays(history, { timeZone: NY }), ['2026-10-20', '2026-11-09', '2026-11-10', '2026-11-11']);
    const a = attendance(history, { now, timeZone: NY });
    assert.equal(a.thisWeek, 3);
    assert.equal(a.thisMonth, 3);
    assert.equal(a.lifetime, 4);
  });

  it('only completed workouts with sets count (opening the app or an empty session does not)', () => {
    const empty = { id: 'x', startedAt: '2026-11-12T14:00:00.000Z', finishedAt: '2026-11-12T15:00:00.000Z', sets: [] };
    const unfinished = { id: 'y', startedAt: '2026-11-13T14:00:00.000Z', sets: [{ id: 'q', exercise: 'bench', reps: 5 }] };
    assert.equal(attendance([...history, empty, unfinished], { now, timeZone: NY }).lifetime, 4);
  });

  it('a workout late at night counts for the local day', () => {
    const late = [w('n', '2026-11-14T03:30:00.000Z')]; // Fri 10:30 pm in New York
    assert.deepEqual(gymDays(late, { timeZone: NY }), ['2026-11-13']);
  });

  it('streaks: rest days in the schedule do not break a streak; a missed training day does', () => {
    const isRestDay = (key) => ['thu', 'sun'].includes(weekdayOf(key));
    const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-13'].map((d, i) => w(`s${i}`, `${d}T15:00:00.000Z`));
    const withRest = attendance(days, { now, timeZone: NY, isRestDay });
    assert.equal(withRest.currentStreak, 4); // Thu is rest; Sat (today) isn't over yet
    assert.equal(withRest.longestStreak, 4);
    const noSchedule = attendance(days, { now, timeZone: NY });
    assert.equal(noSchedule.currentStreak, 1); // Thu was missed
    assert.equal(noSchedule.longestStreak, 3);
    assert.equal(attendance([], { now, timeZone: NY }).currentStreak, 0);
  });

  it('duplicate copies of a workout (a retried sync) count once', () => {
    const dup = [w('a', '2026-11-09T14:00:00.000Z'), w('a', '2026-11-09T14:00:00.000Z')];
    assert.equal(attendance(dup, { now, timeZone: NY }).lifetime, 1);
  });

  it('workout duration in minutes', () => {
    assert.equal(workoutMinutes(w('m', '2026-11-09T14:00:00.000Z', 65)), 65);
    assert.equal(workoutMinutes({ startedAt: '2026-11-09T14:00:00.000Z' }), null);
  });
});
