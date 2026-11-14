# Backend guide: AI proxy and data contracts

The proxy (`server/jim-proxy`) is stateless: it stores nothing and logs no bodies. Authentication,
user accounts and the production database belong to the backend; this guide covers what the
engines expect from them.

## Endpoints
| Route | Body | Reply |
|---|---|---|
| `POST /chat` | `{ messages: [{role, content}] (1–20, last from user, ≤2000 chars each), context, persona }` | `{ reply, proposals[] }`, plus `safety: true` or `refused: true` when applicable |
| `POST /physique` | `{ consent: true, image: { media_type, data (base64 ≤ ~3.75 MB) }, fitnessGoal, physiqueGoal, focusMuscles }` | `{ ok: true, emphasis[] }` or `{ ok: false, reason }` |
| `GET /health` | | `{ ok: true }` |

`proposals` are log, fix or delete intents shaped like `lib/intents.js` output. The app
re-validates them and shows a confirm card. **Nothing is applied server-side.**

## Auth and limits
- **`X-Jim-Key`:** required when `JIM_PROXY_KEY` is set (timing-safe compare). Without it the
  request gets **401**.
  - This is a shared secret that keeps strangers on the network off the proxy. It is **not** a user
    credential: anyone with the app bundle can read it.
  - Before production, the backend should put the proxy behind real user auth (session token →
    backend → proxy) and drop the bundled key.
- **Rate limit:** 20 requests/min per IP (`cf-connecting-ip` or socket address). Over the limit: **429**.
- **Body size:** chat ≤ the configured limit, photo ≤ ~5 MB of base64. Larger: **413**.
- **Timeouts:** 30 s per Claude call, 1 retry. The server's request timeout is 35 s; the app gives
  up after 12 s (chat) or 30 s (photo) and answers offline.

## Errors
| Status | Body `error` | Meaning |
|---|---|---|
| 400 | message | Bad JSON or failed validation |
| 401 | `missing or wrong X-Jim-Key` | Auth |
| 404 | `not found` | Unknown route or method |
| 413 | `body too large` | Size |
| 429 | `slow down` | Rate limit |
| 502 | `upstream error` | Claude call failed; only the status is logged |

The app treats every non-200 as "answer offline": rule-based replies, so the workout never stops.

## Environment
| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required (or an `ant auth login` profile) | Claude credentials; never sent to the app |
| `JIM_PROXY_KEY` | unset (warns at startup) | Shared secret for `X-Jim-Key` |
| `JIM_MODEL` | `claude-sonnet-5-5` | Model id |
| `JIM_FALLBACKS` | on | `0` turns off server-side refusal fallbacks (beta `server-side-fallback-2026-07-01`) |
| `PORT` / `ALLOW_ORIGIN` | `8787` / `*` | Listen port / CORS |
| App: `EXPO_PUBLIC_JIM_PROXY_URL`, `EXPO_PUBLIC_JIM_PROXY_KEY` (or `app.json` `extra.jimProxyUrl` / `jimProxyKey`) | | Where the app sends chat |

**Claude request:**
- `max_tokens` is 2048, because Sonnet 5.5 thinks by default and thinking counts against it.
- Effort is `low` for chat speed.
- Read tools: `get_recent_sets`, `get_goal_progress`, `get_weekly_checkin`, `get_last_set_report`,
  `get_workout_context`.
- Write tools (proposals only): `log_sets`, `correct_set`, `delete_set`.
- Refusals return a plain reply with no proposals; cut-off answers say so.

## Data the engines expect
**Context snapshot** (built on the phone by `lib/jimAI.js` `buildContext`; the backend can build the
same from the database):

```
{ unit, persona,
  recentSets: [{ id, exercise, reps, weight, unit, rpe, source, pr, date }],   // last 14 days
  prs: [{ exercise, unit, heaviest, mostReps, bestSetVolume }],
  goals: [{ label, pct, current, target, onTrack, nextStep }],
  weeklyCheckIn: { wins, misses, suggestion },
  lastSetReport: { movement, counted, target, rpe, partials, trackingPct, tempo, suggestions },
  workout: { today, setsLeft, profile } }
```

**Profile** (all optional; never required to use the app): `profile: { equipment: ['barbell',
'dumbbells', 'bench', 'pullup_bar', 'dip_bars', 'cable', 'machine', 'kettlebell'], avoid:
[movement patterns], level: 1|2|3 }`, plus settings `fitnessGoal`, `experience`, `activityLevel`,
`unit`, `persona`. Body weight is not used to set loads.

**A logged set** (persist every field; extra fields are for learning from history):

```
{ id, exercise, weight, unit, reps, rpe?, rir?, target?, source: 'camera'|'manual',
  reps_detail?: [{ index, concentric_ms, peak_pause_ms, eccentric_ms, rom_deg?, variant? }],
  camera_quality?, metrics?: { calibrated: false, meanLiftMs, velocityLossPct, romLossPct, consistencyCv },
  fatigue?: level, rec?: { action, weight, reps, accepted }, loggedAt, pr }
```

A workout is `{ id, name, startedAt, sets[], planned? }`.

**Needed queries:** a user's sets by exercise and date range (progress, substitutions, history
checks), the latest N workouts, and the current plan.

## Privacy (must hold end to end)
- No video is stored or uploaded; only landmarks are used, on the device.
- The proxy gets text only. The one exception is the physique photo: explicit consent, one
  request, never stored or logged, never judged on looks or weight.
- Pain, dizziness or chest symptoms get a fixed safety reply before any network call.
- Logs carry statuses, never request or response bodies.
