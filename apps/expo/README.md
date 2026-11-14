# JimBro for Expo Go

The phone app for JimBro (Expo SDK 58). It started as the Expo Go prototype and now
connects to the JimBro Raspberry Pi for everything the prototype faked.

## Run it
```bash
cd apps/expo
npm install
npx expo start          # scan the QR code with Expo Go (same Wi-Fi as your computer)
```
If local networking fails, try `npx expo start --tunnel`. On a physical iPhone, sign in to
the same Expo account in Expo CLI and Expo Go if prompted.

In the app, open **Home → Your Pi** and enter the Pi's address (`jimbro.local`, or the IP in
`jimbro-status.txt` on the USB stick). The app uses the Pi's LAN HTTP port **8080**, because
Expo Go can't accept the Pi's self-signed HTTPS certificate.

## What each tab does
| Tab | With the Pi | Without the Pi |
|---|---|---|
| Home | connection status, pending sync count, tone and units | same; sets wait on the phone |
| Workout | log sets for the six lifts (kg/lb, RPE); **live camera rep counts** fill the set, with per-rep timing | log sets offline; they sync later under the same IDs |
| Jim | coaching in four tones from your history, next-set suggestion you can apply, spoken replies; type or dictate "10 curls at 20 pounds" to log a set (confirmed first) | preset replies; pain mentions still get the safety reply |
| Plan | validated plan for goal, days, minutes and equipment | on-phone starter plan |
| Progress | per-exercise trends from the Pi (units never mixed) | first-vs-latest comparison from this phone |
| Board | opt-in weekly leaderboard, labeled demo athletes | needs the Pi |

**Camera rep counting.** Expo Go can't load the on-device pose model, so *Open camera counter*
launches the JimBro PWA in the phone's browser (accept the certificate once). Video never
leaves the phone; the Pi broadcasts each counted rep and this app shows the live count.

## Develop
- Logic lives in `src/lib` (API client, offline queue, station feed, parser, fallbacks) and is
  tested with `npm test` (Node's test runner, no extra dependencies).
- `JIMBRO_API=http://127.0.0.1:8080 npm test` also runs integration tests against a live
  server: from the repo root, `JIMBRO_HTTP_PORT=8080 JIMBRO_PORT=0 PYTHONPATH=backend python -m jimbro.serve`.
- The API contract is `docs/openapi.json`; websocket messages are in `docs/API.md`.
- The first browser prototype is kept in `legacy-web/` for reference.

Not a medical device. TUT is estimated movement timing, not muscle tension.
