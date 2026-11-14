# JimBro

JimBro is a phone-first training app for Expo Go. It runs workout logging, camera rep counting, Jim's coaching, plans, and progress tracking on your phone. **A Raspberry Pi or backend server is not required.** Workout data stays on the phone unless you choose to export it.

## Run the phone app

Install Node.js and Expo Go, then from the repository root run:

```bash
npm run setup
npm start
```

Scan the QR code with Expo Go. Keep your phone and computer on the same Wi-Fi. If local networking fails, run `cd apps/expo && npx expo start --tunnel`. On a physical iPhone, sign in to the same Expo account in Expo CLI and Expo Go if prompted. In Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution blocks the `.ps1` launchers.

The phone app uses Expo SDK 58. Its full feature and camera instructions are in [apps/expo/README.md](apps/expo/README.md).

## What works on the phone

- Camera rep counting for curls, squats, and shoulder press, with estimated movement-phase timing. The pose model downloads on first use; video stays on the phone.
- Manual workout logging for six lifts, with weight units, RPE, rest timer, and personal records.
- Jim's four coaching tones, next-set suggestions, spoken replies, and typed or dictated set entry with confirmation.
- Goal- and equipment-based plans, exercise trends, workout history, and data export/restore.

Run `npm test` from the repository root to check the phone app's core logic. Camera behavior still needs testing on a physical device in varied lighting and angles. Jim's suggestions are based on local rules and workout history; this phone app does not call a cloud AI model.

## Earlier Pi and browser work

The former browser PWA (`apps/mobile`), Python backend (`backend`), and Pi deployment files remain in the repository for reference. They are not needed for the Expo Go app. Their earlier setup and architecture are preserved in [docs/LEGACY_PI.md](docs/LEGACY_PI.md).

