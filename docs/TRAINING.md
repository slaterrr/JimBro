# Attendance, weekly split, pre-filled sets, progression and Excel export

Branch `feat/split-attendance`. Everything runs on the phone (or browser) from the account's local
data. No AI call is made for any of it.

## What existed before vs. what this adds

| Area | Before | Added here |
|---|---|---|
| Storage | Local accounts; each account's workouts, plan and settings in the device store (`jimbro.data.v2:<email>`) | Same store; the weekly schedule is saved with the plan (`plan.schedule`) |
| Attendance | Workouts saved with start/finish times; a week-based streak | One **gym day** per local calendar day from finished workouts with ≥ 1 set; this week, this month, lifetime; day streak and best streak (scheduled rest days don't break it); duplicate-safe |
| Split | Multi-week programs; next session by order | Named splits: push/pull/legs (3 or 6 days), bro split (5), upper/lower (4), full body (2–3). Weekday schedule with rest days; completed, missed, scheduled and rescheduled status; one-off date swaps; moving or swapping weekdays; missed-workout policy |
| Sets and reps | Plan days carried sets and reps; logging was a form | Workout checklist with sets, target reps, rest, RPE and (with history) weight pre-filled. One tap saves a set as prescribed; Edit saves the actual reps and weight |
| Progression | Next-set suggestion within a workout | Session-to-session double progression from history, with a reason for every target |
| Excel | `.xlsx`/`.csv` import; JSON export | Four-sheet `.xlsx` export with formulas, regenerated from saved data each time |

## How it behaves

- **Gym days.** A day counts only when a workout is finished with at least one saved set. Opening
  the app does not count, and JimBro does not detect where you are. Days use the device time zone,
  so a 10:30 pm workout counts for that evening's date.
- **Today's split.** Each weekday holds a session from the saved program or is a rest day.
  - Saving a program creates a schedule. It starts this week only if none of this week's training
    days has passed; otherwise it starts next Monday, so there are no instant "missed" days.
  - Swapping a program exercise keeps the schedule.
- **Missed workouts.** You choose the policy on the Training page:
  - **Keep the calendar** (default): a missed session stays missed and the week carries on.
  - **Push it back:** a missed session moves to your next training day, and later sessions shift
    with it.
- **Start Today's Workout** starts today's session, or on a rest day the next one early (the card
  says so). The workout remembers its scheduled date, so that date shows as done. A second tap
  while a workout is open keeps the open one, so retries don't duplicate sessions.
- **Pre-filled sets.**
  - Targets come from the plan (sets, rep range, rest, RPE) and from history (target reps and
    weight).
  - Ticking a set saves the target reps and weight with `prescribed: true`, `set_index` and
    `target`. Edit saves what actually happened.
  - With no weight history, the set can't be ticked until you enter a weight, so nothing is
    invented. After the first set, later sets use the weight you used.
  - Every tick is saved immediately, so a reload or an app restart keeps the workout.
- **Progression (`lib/progression.js`):**
  - every set at the working weight reached the top of the range: add the smallest step (lb: 5
    upper / 10 lower; kg: 2.5 / 5);
  - two drops in a row: about 10% lighter, with a recovery note;
  - the same result three sessions running: hold and aim for one more rep;
  - otherwise: same weight, one more rep.

  History is never changed.
- **Excel (`lib/workbook.js`).** The four sheets:
  - **Gym Attendance:** date, day, split, status, duration;
  - **Workout History:** one row per set, with target and actual reps;
  - **Workout Split:** this week's sessions, exercises, sets, rep targets and rest days;
  - **Progression Analytics:** COUNTIF, COUNTA and SUMPRODUCT formulas over the other sheets
    (with cached values), weekly and monthly attendance, and per-exercise progress, volume,
    heaviest set and actual-vs-target reps.

  The same data gives byte-identical files and duplicate sessions are dropped. Web downloads the
  file; phones open the share sheet. No spreadsheet credentials exist, and nothing is uploaded by
  JimBro. Charts are not generated; use Insert › Chart on the analytics tables.

## Where

| File | Purpose |
|---|---|
| `apps/expo/src/lib/attendance.js` | Day keys in a time zone, gym days, attendance and streaks |
| `apps/expo/src/lib/schedule.js` | Weekly schedule, statuses, swaps, missed-workout policies, month calendar |
| `apps/expo/src/lib/program.js` | Adds named splits (`split`) and recognizes them in chat |
| `apps/expo/src/lib/progression.js`, `prescription.js` | Session-to-session targets; prepared workout and one-tap sets |
| `apps/expo/src/lib/workbook.js`, `exportFile.js` | `.xlsx` builder (fflate); download or share |
| `apps/expo/src/components/TodayCard.js` | Home dashboard card |
| `apps/expo/src/components/WorkoutChecklist.js` | Workout screen with the camera off |
| `apps/expo/src/screens/TrainingScreen.js` | Calendar, split editor, analytics, Excel export |
| `apps/expo/src/lib/homeActions.js` | `nextWorkout` follows the schedule by date |
| `apps/expo/src/AppState.js` | `saveSchedule`, `createDefaultSchedule`, duplicate-safe `startWorkout` |

## AI usage

None of these actions call Claude: opening the dashboard, attendance, the calendar, the split,
starting a workout, loading targets, ticking sets, progression and export. Claude is still used
where it was before: chat questions it can't answer locally, optional plan personalization and
the photo route, all through the existing proxy. No key is in the app.

## Not done (needs the backend)

The app has no server sync yet; `backend/jimbro/v2` is a database schema only. These items need
the backend's login and workout API with idempotency keys before they can work:

- the same schedule and history across devices;
- server-side checks that each request belongs to its user;
- offline logging with sync when back online.

On one device, accounts are separated by their storage keys, and a retried save cannot duplicate
a workout.
