# JimBro

Preliminary Expo Go frontend for JimBro, an adaptive training companion.

## Open on your phone

1. Install Node.js and Expo Go on your phone.
2. Run `npm install` in this directory.
3. Run `npx expo start` and scan the QR code with Expo Go. Keep the phone and computer on the same Wi-Fi. If local networking fails, try `npx expo start --tunnel`.

This project targets Expo SDK 57, the SDK recommended for Expo Go during the SDK 58 transition. On a physical iPhone, sign in to the same Expo account in Expo CLI and Expo Go if prompted.

The native app includes a dashboard, workout and set logging, four Jim tones, spoken preset replies, a camera preview, starter plans, progress comparisons between completed workouts, and a private leaderboard placeholder. Workout data is stored on the device with AsyncStorage. The earlier browser prototype remains in `index.html`, `app.js`, and `styles.css` for reference; Expo Go launches `App.jsx`.

The camera does not perform pose estimation, repetition detection, form analysis, or time-under-tension measurement. Jim's messages and plans are starter frontend behavior, not AI-generated advice. Speech input, shared leaderboards, and persistence across devices need backend work. The Google Doc's FastAPI, SQLite, MoveNet/LiteRT, Raspberry Pi, WebSocket, and testing requirements remain future integration work.

