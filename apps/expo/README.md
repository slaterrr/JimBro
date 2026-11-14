# JimBro for Expo Go

The JimBro phone app (Expo SDK 58). It runs **entirely on your phone**: no server, no
account, no Raspberry Pi. Workouts are stored with AsyncStorage and never uploaded.

## Run it
```bash
cd apps/expo
npm install
npx expo start          # scan the QR code with Expo Go (same Wi-Fi as your computer)
```
If local networking fails, try `npx expo start --tunnel`. On a physical iPhone, sign in to
the same Expo account in Expo CLI and Expo Go if prompted.

## Tabs
| Tab | What it does |
|---|---|
| Home | weekly goal and week streak, recent personal records, tone/units/rest timer, export or erase your data |
| Workout | log the six lifts (kg/lb, RPE); Jim's next-set hint; rest timer with vibration; 🏆 record detection; plan-day checklist; delete a set |
| Jim | coaching in four tones from your history, next-set suggestion you can apply, spoken replies; type or dictate "10 curls at 20 pounds" to log a set (confirmed first); pain gets a fixed safety reply |
| Plan | weekly plan for goal, days, minutes and equipment; *Start this day* opens a workout with the checklist |
| Progress | per-exercise trends (units never mixed), estimated TUT for camera sets, personal records |

## How it works
`src/lib` holds the logic, ported from the tested Python backend so behaviour matches it
exactly: rep counting (`reps.js`), Jim's bounded progression and tones (`coach.js`), plans
(`plans.js`), progress, records and streaks (`progress.js`), and the spoken-set parser. Run
`npm test` (Node's built-in test runner, no extra dependencies).

Not a medical device. TUT is estimated movement timing, not muscle tension. The first
browser prototype is kept in `legacy-web/` for reference.
