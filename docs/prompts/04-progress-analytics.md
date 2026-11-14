# Prompt: Progress tracking and analytics (Jim Bro phone app)

Refined from the original request on 14 Nov 2026, after inspecting the code.
Written for the codebase as it is, not as assumed.

## Context: what exists (don't rebuild it)

- **App:** `apps/expo` (Expo SDK 58, React Native, plain JS). It runs entirely on
  the phone: **no server, no account, no database**. All data lives in one
  AsyncStorage key (`jimbro.data.v2`), managed by `src/AppState.js`. One phone =
  one user; "users can only see their own records" holds by construction.
- **Data:** a workout is `{ id, name, startedAt, finishedAt, sets[], planned }`.
  A set is `{ id, exercise, weight, unit: "kg"|"lb", reps, rpe?, source:
  "manual"|"voice"|"camera", reps_detail?, loggedAt, pr }`. Six exercises
  (`src/lib/exercises.js`): curl, squat, bench, deadlift, shoulder press, pull-up.
- **Already built:**
  - Workout history with delete and repeat.
  - Epley e1RM (`tools.js`, sets of 10 reps or fewer, labelled "Est.").
  - Records per exercise and unit (`progress.js`).
  - Weekly volume and "Total Strength" for 4 weeks (`stats.js`).
  - Streak and weekly goal; period comparison (`comparison.js`).
  - The exercise → muscle map (`muscles.js`).
  - The Progress screen (Overview / Strength / Volume / PRs) with SVG line and bar charts (`Charts.js`).
  - Design tokens in `theme.js`.
- **Tests:** `npm test` = `node --test src/lib/*.test.js` (logic only).
- **The camera visualizer:**
  - The Coach screen counts reps on the phone (MediaPipe in a WebView, `live.js`, `reps.js`) and logs camera sets with per-rep timing (`reps_detail`).
  - The richer browser tracker in `frontend/src/cv` (form flags, movement validation, per-rep metrics) is a separate web module and is **not validated on real recordings** (`docs/cv/reliability-report.md`).
- **Known bug:** the `pr` flag is stored on a set when it's logged and never recalculated, so records go stale when history is edited or deleted.
- `backend/` (Pi server) is paused. Don't extend it.

## Task

Extend the existing app. Don't replace the Progress screen, charts, storage or
design; don't add dependencies.

### 1. Data model (backwards compatible)
- **New optional set fields:**
  - `variation` (e.g. "paused", "incline"), `equipment` (barbell / dumbbell / machine / cable / bodyweight / other) and `notes`;
  - `restSec` (measured from the previous set's log time in the same workout, when under 10 minutes; editable);
  - `completed` (default true).
- **New optional workout fields:** `notes`, `program` (the plan it came from).
  Workout duration = `finishedAt − startedAt`.
- Migrate old data on load without losing anything. Imports and exports keep working.

### 2. Editing
- View, edit and delete any set (weight, unit, reps, RPE, variation, equipment,
  rest, notes, completed) and any workout (name, notes, delete) in history.
- Never store derived values (PRs, e1RM, volume): compute them from history,
  so edits and deletes are always reflected. Drop reliance on the stored `pr` flag.

### 3. Analytics (pure functions in `src/lib/analytics.js`, unit-tested)
- **"Same lift" = same exercise + variation + equipment.** Never compare or
  combine different lifts or equipment set-ups. Units are converted exactly
  (1 lb = 0.45359237 kg) for display; original values are kept.
- **Per lift:**
  - top weight per session;
  - total volume (Σ reps × weight of completed sets);
  - **estimated 1RM (Epley; sets of 10 reps or fewer; always labelled "estimated")**;
  - average weight per rep (volume ÷ reps);
  - reps per session;
  - set completion (completed ÷ logged, and vs. planned sets when the workout came from a plan);
  - latest session vs. previous session.
- **Weekly and monthly volume** over a chosen range; volume by lift.
- **Volume by muscle group (documented allocation):**
  - each set's volume and set count go 100% to the exercise's primary muscles and 50% to its secondary muscles;
  - the table is in `muscles.js`;
  - shown as relative training load, not muscle "work".
- **Consistency:** workouts per week, average sessions per week, a month
  calendar of training days, the current streak (existing definition).
- **Bodyweight lifts** (pull-ups at 0 added weight): volume and e1RM need a
  load, so show reps and sets instead, and say so.

### 4. Personal records (computed from history, chronological)
- **Measured achievements:**
  - heaviest completed weight;
  - most reps at a given weight;
  - highest session volume for a lift.
- **Estimated:** best estimated 1RM.
- Each record type is kept per lift. A record is only a record if it strictly
  beats the previous one; ties and duplicates are not new records.
- Provide the full record history (when each was set), recalculated from scratch
  after any edit or delete.

### 5. Dashboard (existing Progress screen and visual style)
- **Tabs:** Overview (existing), Strength, Consistency, Volume, Performance, PRs.
- **Strength:** top-weight and e1RM line charts; record timeline.
- **Consistency:** workouts-per-week bars, frequency, streak, calendar.
- **Volume:** weekly/monthly bars, by lift, by muscle (with the allocation note).
- **Performance:**
  - rep trend, average working weight, completion;
  - this session vs. the previous one;
  - camera timing where available.
- **Filters:** lift, date range (4 weeks / 12 weeks / 6 months / all), program.
- **Labels:** measured vs. estimated everywhere.

### 6. Visualizer integration
- Camera-logged sets keep `source: "camera"` and `reps_detail`. Their rep
  count is what the user confirmed when ending the set, so it's treated like a
  logged set (and stays editable).
- Show per-rep timing (estimated time under tension) on camera sets in history and
  Performance, labelled estimated.
- Form measurements or flags from the CV tracker may be attached to a set as
  `form` and displayed, but only labelled "estimated", and **never used for
  PRs, volume or e1RM until the reliability report marks them validated**.
- No unvalidated form score is presented as a judgement of technique.

### 7. Quality
- Unit tests for every analytics function, including:
  - unit conversion;
  - lifts that must not be combined;
  - PR recalculation after edit and delete;
  - ties not being records;
  - bodyweight sets;
  - empty data;
  - week and month boundaries.
- `npm test` passes; old exports still import; the app runs on web preview.
- Report what was verified (tests, preview) and what wasn't (on a real phone).
