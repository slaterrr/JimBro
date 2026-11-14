# JimBro engines: handoff

These are two standalone, tested engines for the rest of the team to build on. The UI, the
database and authentication stay yours.

```
Camera / recorded video
  → pose (MediaPipe, on device)                       lib/poseHtml.js, components/PoseView*.js
  → exercise checks + rep counting + quality gates    lib/live.js, lib/angles.js, lib/reps.js, lib/analyzers.js
  → System A: vision engine (events)                  lib/visionEngine.js
  → versioned events                                  lib/events.js (+ events.d.ts)
  → System B: coach engine (fatigue, load, words)     lib/coachEngine.js, performance.js, recommend.js, perfCoach.js, coachQA.js
  → voice / text                                      lib/sound.js (voice), chat on Home
  → AI for open conversation only                     lib/jimAI.js → server/jim-proxy (Claude)
```

There are no AI calls per frame or per rep. Counting, cues, fatigue and load suggestions are
deterministic. Claude handles open conversation and planning. It reads numbers through tools and
never makes them up. Load changes always need the user's approval.

| Doc | For |
|---|---|
| [ASSESSMENT.md](ASSESSMENT.md) | What exists, what is validated, what is missing |
| [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md) | Starting a camera session, events, uncertainty, voice/text, cleanup |
| [BACKEND_GUIDE.md](BACKEND_GUIDE.md) | Proxy API, auth, env vars, errors, rate limits, profile and history formats, privacy |
| [EVENTS.md](EVENTS.md) | Every event type, fields, units, validation status, examples |
| [VALIDATION_REPORT.md](VALIDATION_REPORT.md) | What was tested how; real and simulated results kept apart |
| [LIMITATIONS.md](LIMITATIONS.md) | Known limits and what would lift them |
| [examples/](examples) | Real event stream (squat clip), chat request/response shapes |

**Try it without a phone:**

```bash
cd apps/expo
npm ci
npm run harness -- fs_squat_rear
npm test
```

The first command replays real-clip landmarks through both engines; `npm test` runs all 517 tests.
**Live Claude check:** `cd server/jim-proxy && npm ci && npm run smoke` (needs an API key or `ant auth login`).
