# JimBro

Preliminary frontend for JimBro, an adaptive training companion. Open `index.html` in a browser or serve this directory with `python -m http.server 8000`.

The prototype includes a dashboard, workout and set logging, Jim's four tones, browser voice input where supported, a camera preview, starter workout plans, progress comparisons, and a private leaderboard placeholder. Workout data is stored in the browser with `localStorage`.

Camera preview does not perform pose estimation, repetition detection, form analysis, or time-under-tension measurement. Jim's messages and plans are starter frontend behavior, not AI-generated advice. Shared leaderboards and persistence across devices need accounts and a backend. The Google Doc's FastAPI, SQLite, MoveNet/LiteRT, Raspberry Pi, WebSocket, and testing requirements remain backend work.

The frontend is plain HTML, CSS, and JavaScript so it can be revised quickly and connected to the specified REST and WebSocket API later.

