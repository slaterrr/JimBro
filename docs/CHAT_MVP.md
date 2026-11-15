# Chat-centered JimBro MVP

Implementation branch: `codex/chat-mvp`, based on main `70891a3`.

## What changed

Jim's conversation is now the app workspace on Expo web, Android and iOS. A desktop
sidebar and a compact mobile menu open the existing workout studio, progress/history,
muscle map, training plan and import/photo tools **inside the conversation**. The
composer remains available while these tools are open. Settings and detailed form
controls retain their existing accessible sheets.

This builds on Claude's merged work, especially #47 (vision/coach engines, missions,
measured speed, tool proposals), #55 (shared live camera context and retained chat),
and #62 (connection status and phone layout). It does not replace the MediaPipe
analyzers, the mission planner, AppState storage, personas or the Claude proxy with a
second implementation. The old `backend/` Python/Pi server remains paused; workout
records stay in the existing local store. This change does not add cloud accounts or
multi-device synchronization.

Camera sets create a save card in chat. Reps and timing come from `LiveSession`;
added weight and optional RPE are entered by the user. No video recording is saved
or uploaded. "Record a workout" here means persist exercise measurements and sets.

Chat still supports workout missions, goal-aware plans, workout questions, imports,
consented reference-photo planning, goals/progress, body-map recovery and five coach
personas. Talk uses keyboard dictation plus speech output, as before; there is no
streaming speech recognition or wake word.

## API and AI boundary

`POST /chat` retains `{messages, context, persona}` and `{reply, proposals}`. Optional
new response fields:

```json
{
  "actions": [{"type":"show_panel","panel":"camera","exercise":"squat"}],
  "toolCalls": [{"name":"get_live_session","status":"completed"}]
}
```

- `get_live_session` reads the active workout and fresh camera snapshot. Missing
  camera measurements remain null. The client strips identifiers and pose data.
- `show_panel` opens camera/progress/muscles/plan/import locally. Camera exercise ids
  must be supported by the existing analyzer registry. Browser/device permission
  still has to be granted.
- All tool schemas are strict, including nested objects. The server independently
  validates tool arguments and rejects unknown tools, extra fields, wrong types and
  unsupported modes. The client validates actions/receipts again.
- Receipts show completed reads, rejected calls and proposals waiting for approval.
  The model cannot write the workout store. No model call occurs per camera frame.
- Log/correct/delete proposals use the existing validator and AppState writes.
  Only the newest save card is active; it expires after five minutes and is consumed
  synchronously exactly once. Targets are validated again when confirmed. Deletion
  needs the explicit card button; an ambiguous "yes" cannot delete a set.
- A local stop or pain message preempts an in-flight response, unmounts the camera
  and invalidates late model results. Offline fallback remains explicit in the UI.
- `createJimServer` in `server/jim-proxy/http.js` is the shared production HTTP
  boundary. Startup alone constructs the real SDK client. Tests inject the client,
  rather than replacing browser HTTP responses.

## Run the app and real Claude service

Use Node 22. In the repo root:

```sh
npm ci --prefix server/jim-proxy
npm ci --prefix apps/expo
```

Copy `server/jim-proxy/.env.example` to its ignored `.env` and privately configure
`ANTHROPIC_API_KEY` and `JIM_PROXY_KEY`. Then:

```sh
npm run start:env --prefix server/jim-proxy
```

In `apps/expo/.env`, configure the matching non-provider app settings:

```dotenv
EXPO_PUBLIC_JIM_PROXY_URL=http://localhost:8787
EXPO_PUBLIC_JIM_PROXY_KEY=your-prototype-proxy-access-key
```

Run `npm start --prefix apps/expo -- --web`. For a physical phone, use the server's
reachable LAN address or deployed HTTPS URL, not localhost. The shared app key is a
prototype access gate, not private user authentication. The Anthropic key belongs
only on the server. Existing Render + EAS preview deployment instructions still apply.

With no proxy URL/key, the app uses the offline coach and labels that state. GitHub's
`CLAUD_TOKEN` smoke-test secret is not a deployed API endpoint and cannot be read back.

## Verification

Actual results in the task environment:

| Check | Result |
|---|---|
| Expo app engine/helper tests | 580 passed |
| Vision lab tests | 51 passed |
| Proxy/API tests | 44 passed |
| Playwright full-stack browser scenarios | 20 passed |
| Android and iOS production exports | Both built |

The Playwright agent uses the **production HTTP boundary and real tool loop**, with
a deterministic mocked Claude SDK. It exercises log/confirm/cancel/reload, correction
and deletion, follow-up history, tool-triggered and local panels, invalid/unknown
tools, authorization, offline fallback, denied camera, stale replies after stop/pain,
new-chat cleanup, and overflow/composer reachability at 320, 390 and 1440 pixels.

One scenario replays the existing real squat landmark fixture from inside the real
pose iframe, through its message bridge and `LiveSession`. It counts two reps, reads
them through Jim's live-session context and saves two camera-sourced rep details only
after confirmation, including timing and user-reported weight/RPE. This is recorded
landmark replay, **not a physical-camera or new-video accuracy trial**. No production
rep counts are hardcoded.

Run the full browser suite from `apps/expo`:

```sh
npm run test:chat
```

It builds a separate test-only `dist-chat` export pointed at the SDK fixture, then
runs Playwright. It needs Chrome (`CHROME_PATH`), defaults to `/usr/bin/chromium`,
and uses local ports 8787 and 18085. Output: `e2e-artifacts/chat-mvp-report` and
`e2e-artifacts/chat-mvp`. `test:ui` now runs this chat-focused suite in CI.

## Remaining validation and delivery limits

- No provider API key was available here. Live Claude reasoning and production
  hosting are unverified; the mocked-SDK tests do not establish either.
- A precise Muse URL/screen was not supplied. The delivered layout uses a minimal
  conversation workspace with charcoal/seafoam styling; pixel-identical matching
  needs that reference.
- Physical-phone camera accuracy, permissions, speech quality, thermal behavior
  and fatigue estimates need device validation. Existing analyzer limitations and
  real-vs-simulated evidence remain unchanged.
- The supplied GitHub credential returned HTTP 401. Source changes are committed
  locally; remote push/draft-PR delivery requires a valid repository connection.
