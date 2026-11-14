# Agentic Jim — sprint board for coding agents

Source: research report (2026-11-14), summarized here. Context: `docs/AGENTIC_JIM_CONTEXT.md`. Rules: `AGENTS.md` (TDD, branch off `main`, draft PR, never merge without a human, no fabricated numbers).

## Architecture decision (do not relitigate)
- **Local event-driven session controller on the phone + strict typed Claude tools through `server/jim-proxy`.** No LangGraph / Deep Agents / Pi rewrite now.
- The phone is the authority for measurement (rep counts, tracking, weights), safety, persistence and confirmation. Claude only **proposes**; the phone validates and executes.
- No per-frame model calls. Only *meaningful events* exist; most are handled locally. The LLM is called at decision boundaries: workout intent, ambiguous changes, post-set adaptation, history questions, end-of-workout summary.
- Video never leaves the phone. Only derived events/summaries go to the proxy (consented physique photo stays the one exception).
- Voice for the hackathon: existing `expo-speech` out + keyboard dictation in. Streaming STT / wake word are post-hackathon (Expo SDK 58 `expo-audio` has PCM streaming; wake word needs a dev build).
- Raspberry Pi: optional sidecar only, after S0–S5, and only for a capability the phone can't provide (equipment sensors / shared station).

## In-flight team PRs — build on these, do not duplicate (checked 2026-11-14)
| PR | Covers | Use it for |
|---|---|---|
| #43 `feat/workout-mission` → main | "I have 20 minutes, help me finish chest day": on-phone plan (`lib/mission.js`), explain, ask, run hands-free, check at end | **S3** (orchestrator should call `mission.js`, not re-implement planning) |
| #44 camera performance engine (stacked on #43) | analyzer registry, pull-up/deadlift (experimental), fatigue, weight recommendations | S4 cue sources |
| #46 `feat/engines` (stacked on #44) / #47 | versioned event contract `lib/events.js` + `events.d.ts` (14 types), vision + coach engine APIs, proxy hardening | **S1**: if #46 merges first, use its event types and map the session reducer onto them instead of a new `agentEvents.js`; **S5** proxy auth may already be there |
| #41 `codex/shared-session-context` → main | ephemeral camera summary shared with Jim (no frames/landmarks) | S1 perception adapter input |

Before starting a sprint: `git fetch` and check whether these merged; if they did, rebase the sprint on them and adjust file names below.

## Contracts (implement exactly; other sprints depend on them)
Event (`src/lib/agentEvents.js`):
```js
{ id, type, sessionId, at, source: 'vision'|'user'|'timer'|'system', payload, confidence }
// type: 'rep.completed' | 'rep.blocked' | 'tracking.lost' | 'camera.framing_issue' |
//       'exercise.switch_suggested' | 'set.completed' | 'rest.elapsed' | 'user.intent' |
//       'user.stop' | 'safety.pain_reported' | 'network.offline'
```
Session (`src/lib/agentSession.js`): `createAgentSession({ dispatchTool, getContext, speak, now }).dispatch(event)` returns one of
```js
{ kind: 'none' } | { kind: 'local_cue', text } | { kind: 'agent_turn', reason, context } |
{ kind: 'pending_confirmation', confirmation } | { kind: 'navigation', screen, params } | { kind: 'safety_stop', text }
```
State: `idle → planning → awaiting_confirmation → active_set → resting → reporting → done`, plus `stopped` and `safety_stop` reachable from any state. Keep a bounded `lastEventIds` set (dedupe) and at most **one** `pendingConfirmation`.

Confirmation:
```js
{ id, actionId, tool, summary, argsHash, createdAt, expiresAt, allowedResponses: ['confirm','cancel'] }
```
"Yes" confirms only the current, unexpired card with matching `argsHash`. Deletes need "yes, delete set N".

Autonomy (enforced in `agentPolicy.js`, never by the model):
| Autonomous (read / deterministic) | Bounded (reversible) | Needs confirmation | Never |
|---|---|---|---|
| read history/goals, camera counting, framing + not-counted cues, `restFor`, plan *proposal* | open screen, start camera mode, start/reset rest timer, suggest exercise switch | save plan, log / correct / delete set, import workouts, physique photo (consent each time) | diagnosis / medical advice, arbitrary code / URL / file access |

Safety: `user.stop`, pain/dizziness, tracking lost, permission revoked **preempt everything**, checked locally before any model call (extend `SAFETY` in `jimAI.js`).

Test files must sit directly in `apps/expo/src/lib/*.test.js` (test glob). Assert invariants (state, tool, permission, args, dedupe, fallback), never exact model sentences.

## Sprints (P0 = hackathon critical path, in order)
| # | Branch | Files | First failing tests | Done when | Rollback |
|---|---|---|---|---|---|
| **S0** | `chore/agent-s0-baseline` | none (docs only) | — | record real pass counts; phone run of camera + TTS; live Claude smoke if key available | — |
| **S1** | `feat/agent-s1-session-events` | `lib/agentEvents.js`, `lib/agentSession.js`, `lib/agentSession.test.js`; then `screens/CoachScreen.js` emits events | duplicate `rep.completed` ignored; `user.stop` → stopped from any state; pain preempts coaching; `set.completed` persists nothing | CoachScreen dispatches typed events; LiveSession untouched; all suites green | remove adapter, restore inline cues |
| **S2** | `feat/agent-s2-tools` (parallel with S1 — pure modules only, no CoachScreen/AppState/jimAI edits) | `lib/agentTools.js`, `lib/agentPolicy.js`, `lib/agentTools.test.js` | `delete_set` never runs without confirmation; malformed args rejected; repeated `actionId` runs once; two writes serialize; expired / replaced confirmation rejected | every persistent tool returns `pending_confirmation`; registry is compile-time only | unused module |
| **S3** | `feat/agent-s3-orchestrator` | `lib/agentOrchestrator.js` + test; extend `lib/jimAI.js`; proxy: `strict: true` schemas for the new tools | "20 min arms" → context read → valid plan proposal, no writes; proxy timeout → local `planFromGoal` fallback; hallucinated exercise/tool rejected | Home input → plan → confirm → workout starts in the right camera mode | route Home back to `askJim` |
| **S4** | `feat/agent-s4-proactive` (after S1; both touch CoachScreen) | `lib/agentCues.js` + test; `CoachScreen.js` | framing cue cooldown 8 s; blocked-rep dedupe; switch suggestion once; `set.completed` queues one report; works with proxy offline | Jim reacts unprompted; no per-frame model calls; priority queue: safety > camera > transitions > hype | inline CoachScreen speech |
| **S5** | `chore/agent-s5-demo` | `lib/agentTelemetry.js` + test; proxy `X-Jim-Key` shared secret; feature flag `settings.agentMode` | replay / duplicate / offline / safety / adversarial-prompt cases (matrix below) | 10 clean phone rehearsals of the judge script; backup recording | flag off |
| **S6** | — | Devpost (`docs/DEVPOST.md`), README claims audit | — | ≥ 90 min reserved before 8:00 AM, no feature work | — |

Regression matrix (S2–S5 must cover): correct request → right tool; duplicate camera event; replayed actionId; two concurrent writes; Claude timeout; bad tool args; tracking lost (no fabricated reps); mic denied; "stop"; pain/dizziness; exercise switch keeps counted reps; "yes" after expiry; "yes" after the card was replaced; offline; prompt injection can't escape the registry; user correction requires confirmation.

Telemetry: event/action metadata only (ids, types, latency, outcome). No video, raw pose sequences or audio.

## Judge script (2 min) the sprints must make possible
0:00 "I have 20 minutes, let's train arms" → 0:12 Jim proposes from goals/history, user confirms → 0:25 camera opens on curls, 2 clean reps → 0:45 step out of frame / half rep, Jim explains → 0:58 switch to press, Jim adapts → 1:12 set report + rest from measured data → 1:28 Jim proposes logging, user confirms → 1:42 Progress shows it → 1:55 "the camera stays on the phone; Jim acts on structured workout events."

## Targets (unverified until measured on a device — label them so)
0 unconfirmed mutations; 0 LLM-authored rep counts; p95 local event→cue < 250 ms; p95 cloud decision < 3 s; ≤ 1 cloud call per ordinary set; 10/10 rehearsals.

## Post-hackathon (in order)
1. Session checkpoints across restarts, proxy auth, tracing. 2. Push-to-talk STT via `expo-audio` PCM + provider adapter. 3. Barge-in / VAD. 4. History-based adaptation policy. 5. Scenario eval harness. 6. Dev build: wake word, native Health. 7. Pi sidecar experiment (PI-S0 benchmark → S1 pairing → S2 one real sensor → S3 failover → S5 phone-vs-Pi comparison) only with a real sensor hypothesis. 8. Production security review.

## Status (update this table in every PR)
| Sprint | Status | PR | Notes |
|---|---|---|---|
| S0 | 📋 | | |
| S1 | 📋 | | |
| S2 | 📋 | | |
| S3 | 📋 | | |
| S4 | 📋 | | |
| S5 | 📋 | | |
