# JimBro API (for the frontend team)

The full REST contract is [`openapi.json`](openapi.json) (CI fails if it drifts). Interactive
docs run at `https://<pi>/docs` (or `http://localhost:8000/docs` in dev). Generate TS types with
`npx openapi-typescript docs/openapi.json -o apps/mobile/src/api/schema.d.ts` if useful.

## Conventions
- Every `/v1` call may send `X-Athlete-Id: <[A-Za-z0-9_-]{1,40}>`; default `me`. It separates
  household members; it is **not** authentication.
- Set IDs are client-generated idempotency keys: resend the same body → `200` with the stored
  record; a different body under the same ID → `409`. New → `201`.
- Units are explicit (`kg` | `lb`) and never mixed in totals (`volume` is per unit).
- Errors: `404` unknown/foreign resource, `409` conflict, `422` validation (`detail` explains).

## Endpoints at a glance
| Method & path | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /v1/status` | headless diagnostics: version, uptime, counts, disk, coach mode |
| `GET /v1/exercises` | the six lifts and which support camera tracking |
| `POST /v1/sessions` · `GET /v1/sessions` · `POST /v1/sessions/{id}/end` | workouts |
| `GET /v1/sessions/{id}/summary` | sets, total reps, per-unit volume |
| `POST /v1/sets/{id}/complete` | log a set (camera / manual / voice) |
| `POST /v1/coach` | Jim reply `{text, tone, source: ai\|fallback\|safety, suggestion}` |
| `GET /v1/suggestions/{exercise}` | bounded next-set suggestion or `null` |
| `POST /v1/plans` | weekly plan from goal, days, minutes, equipment |
| `GET /v1/progress/{exercise}` | per-unit trend points and % change |
| `GET`/`PUT /v1/athletes/me` | display name and leaderboard opt-in |
| `GET /v1/leaderboard?metric=reps\|sessions&week=YYYY-Www` | opt-in weekly ranks |
| `POST /v1/demo/seed` | labeled demo athletes |
| `GET /v1/export` · `DELETE /v1/athletes/me?confirm=true` | own data export / erasure |
| `POST /v1/station/button` | same as pressing the GPIO button |

## WebSocket: live rep counting `wss://<pi>/v1/live/{curl|squat|shoulder_press}?athlete=<id>`
Client → server (JSON per message):
```json
{"type": "sample", "t": 12345, "angle": 151.2, "confidence": 0.91}
{"type": "reset"}
{"type": "ping"}
```
`t` is a monotonically increasing ms timestamp (e.g. `performance.now()`); out-of-order and
non-finite samples are ignored; samples below 0.5 confidence count as tracking loss.

Server → client:
```json
{"type": "state", "state": "rest|concentric|peak|eccentric", "count": 3, "partials": 1}
{"type": "rep", "index": 3, "start_ms": 0, "end_ms": 0, "concentric_ms": 820,
 "peak_pause_ms": 140, "eccentric_ms": 1210, "tut_ms": 2170}
{"type": "error", "detail": "..."}
{"type": "pong"}
```
The first message after connecting is a `state`. Unknown movement → close code `4404`;
bad athlete id → `4422`.

## WebSocket: station feed `wss://<pi>/v1/station`
First message `{"type": "hello", "last": <last event or null>}`, then events, each with an
increasing `seq` (drop any `seq` ≤ the last one you applied; after reconnect, trust `hello`):
```json
{"type": "rep", "seq": 7, "movement": "curl", "athlete_id": "me", "index": 3, "tut_ms": 2170, ...}
{"type": "set", "seq": 8, "athlete_id": "me", "exercise": "curl", "reps": 10, "weight": 12.5,
 "unit": "kg", "avg_tut_ms": 2100}
{"type": "button", "seq": 9}
```
Retried (idempotent) set submissions are not re-announced.
