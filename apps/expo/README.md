# JimBro for Expo Go

The JimBro phone app (Expo SDK 58), built to the four-screen design (Home · Muscles · Coach ·
Progress). It runs **entirely on your phone**: no server, no account. Workouts are stored with
AsyncStorage and never uploaded.

| Home | Muscles | Progress | Coach |
|---|---|---|---|
| ![Home](../../docs/design/expo-Home.png) | ![Muscles](../../docs/design/expo-Muscles.png) | ![Progress](../../docs/design/expo-Progress.png) | ![Coach](../../docs/design/expo-Coach.png) |

(Web-preview screenshots with sample data; the Coach camera only runs on a phone.)

## Run it
```bash
cd apps/expo
npm install
npx expo start          # scan the QR code with Expo Go (same Wi-Fi as your computer)
```
If local networking fails, try `npx expo start --tunnel`.

## Screens
- **Home (Jim):** "Hey, I'm Jim" with three goals. *Build Muscle*, *Improve Endurance* and *Get
  Stronger* each produce a real weekly plan you can tune (days, minutes, equipment), save and
  start. Chat with Jim in four tones (set in the 🔔 sheet): he answers from your history with a
  bounded next-set suggestion. Type or dictate "10 curls at 20 pounds" to log a set (confirmed
  first). **+** opens *Log a set* (Jim's hint, plate calculator, RPE, 🏆 record detection, rest
  timer). Pain or dizziness always gets the same safety reply.
- **Muscles:** front and back body map coloured by when each group was last trained (≤3 days,
  4–7 days, ≥8 days). Tap a group to see its recent work and log a lift that trains it. The
  calendar opens your history.
- **Coach (live):** the camera counts reps on the phone (MediaPipe in a WebView, video never
  leaves the device) for curl, squat and shoulder press. It shows *Set x of y* and *Reps n / target*,
  and Jim's live cue (pace from measured rep timing, plus a form tip). Buttons: voice cues on/off,
  end set (logs it with per-rep timing) and flip camera. Bench, deadlift and pull-ups are logged
  with **+**. The camera can't judge form, so the cues don't pretend to.
- **Progress:** *Overview* has Total Strength (sum of each lift's best estimated 1RM, vs. last 4
  weeks) with a chart, plus tiles for top-lift Est. 1RM, volume change, consistency and PRs, and
  workout history (repeat or delete). *Strength* shows top weight per exercise, *Volume* weekly
  bars, *PRs* records with estimated 1RM.

The 🔔 sheet holds your weekly goal and streak, recent records, settings (tone, voice, units,
weekly goal, rest timer) and your data (export, restore by pasting an export, erase).

## Jim AI (optional)
Run `server/jim-proxy` (see its README) and start the app with
`EXPO_PUBLIC_JIM_PROXY_URL=http://<laptop-LAN-IP>:8787 npx expo start` (or set
`expo.extra.jimProxyUrl` in `app.json`). Jim then answers through Claude; the header badge shows
**AI**. Without a URL, or if the proxy fails, it shows **offline** and uses the built-in rules.
Only a text snapshot is sent (last 14 days of sets, records, goal progress, weekly check-in, last
camera set report, unit and persona); never video, names or workout ids. Claude can only *propose*
log/fix/delete changes; the app re-validates them and you confirm on the usual card. Pain or
dizziness gets the fixed safety reply before any network call.

**Talk mode** (header button): Jim speaks every reply in the persona's voice and reopens the
keyboard when he finishes; dictate with the keyboard's mic and the text is sent after ~2 s of
silence. Expo Go has no speech-to-text API, so the keyboard mic is still one tap per turn.

## How it works
`src/lib` holds the tested logic: rep counting (`reps.js`, ported from the backend), Jim
(`coach.js`), plans (`plans.js`), progress and records (`progress.js`), progression stats
(`stats.js`), the muscle map (`muscles.js`), live cues (`cues.js`), lifter tools (`tools.js`) and
the camera pipeline (`angles.js`, `live.js`, `poseHtml.js`). UI is in `src/screens` and
`src/components` (design tokens in `src/theme.js`). Run `npm test`.

Not a medical device. 1RM is an estimate (Epley); TUT is estimated movement timing, not muscle
tension. The first browser prototype is kept in `legacy-web/` for reference.
