# Event contract, schema 1.0

Runtime: `apps/expo/src/lib/events.js` (`makeEvent`, `validateEvent`, `EVENT_TYPES`).
Types: `apps/expo/src/lib/events.d.ts`, a discriminated union on `type`.

Changing a field's meaning or removing a field is a breaking change: bump `SCHEMA_VERSION` and
note it here. Adding optional fields is not breaking.

## Envelope (every event)
| Field | Meaning |
|---|---|
| `schemaVersion` | `"1.0"` |
| `eventId` | `<sessionId>-<n>`, unique per process |
| `type` | One of the types below |
| `sessionId`, `exerciseId` | Caller's session id; library exercise id (`curl`, `squat`, …) |
| `timestamp` | ms. **Vision events:** frame time from the camera page. **Coach events:** epoch ms |
| `source` | `vision` · `coach` · `user` · `ai` |
| `confidence` | 0–1, or `null` when not applicable (tracking quality for vision events) |
| `validation` | How tested the producing logic is: `tested_real`, `tested_sim`, `experimental` (from the exercise's analyzer), `computed` (arithmetic on other events), `user_reported`, `unvalidated` (heuristic, e.g. form and fatigue thresholds) |
| `units` | Unit per numeric data field, e.g. `{ "lift_ms": "ms", "rom_deg": "deg" }` |
| `data` | Type-specific payload (below) |

## Types
| Type | Source | Data (required **bold**) | When |
|---|---|---|---|
| `TrackingStatus` | vision | **status** `ok/low/lost`, hint, guidance | On change only |
| `ExerciseDetected` | vision | **view** `side/front`, **side** `left/right` | First good tracking |
| `ExerciseMismatch` | vision | **expected**, **observed** (exercise id or `unknown`), **reason**, guidance | Once per episode (e.g. lunges in squat mode) |
| `RepStarted` | vision | **repIndex** | Movement leaves rest |
| `RepCompleted` | vision | **repIndex**, **count**, lift_ms, lower_ms, pause_ms, rom_deg, variant | A rep passes every gate |
| `RepRejected` | vision | **reason** (`arm_swing`, `framing`, `implausible_motion`, `tracking`), words | A moving rep was aborted by a quality gate |
| `FormObservation` | vision | **repIndex**, **fault**, **cue**, why, fix, severity, measured, threshold | After the set; validation `unvalidated` |
| `SetCompleted` | vision | **count**, **target**, **reps[]**, **partials**, partialAfterLastRep, trackingPct | `finishSet()` |
| `PerformanceMeasurement` | vision | **calibrated** (`false`), meanLiftMs, velocityLossPct, romLossPct, consistencyCv, omitted[] | `finishSet()`; m/s, displacement, force and power fields are **rejected** while uncalibrated |
| `FatigueAssessment` | coach | **level**, **signals[]**, **text** | `completeSet()`; validation `unvalidated` |
| `LoadRecommendation` | coach | **action**, **needsApproval** (`true`), **reasons[]**, weight, unit, reps, extraRestS | `completeSet()` |
| `CoachResponse` | coach | **text**, **kind** (`count/cue/after_set/answer/summary`), **speak**, question | Counts, cues (once per set), after-set, answers |
| `WorkoutSummary` | coach | **setsDone**, **repsDone**, setsPlanned, minutes, lines | `summarize()` |
| `CameraPerformance` | vision | **fps**, **inferenceMs**, droppedPct, device | Measured on the running device |

Fatigue levels: `normal`, `possible_fatigue`, `increasing_difficulty`, `incomplete_rep`,
`failed_attempt`, `uncertain`.

Load actions: `increase`, `same`, `decrease`, `more_rest`, `fewer_reps`, `none`.

## Examples
[examples/fs_squat_rear.events.jsonl](examples/fs_squat_rear.events.jsonl) is the full stream from
replaying a real squat clip. To regenerate it:

```bash
cd apps/expo
npm run harness -- fs_squat_rear --json
```

```json
{"schemaVersion":"1.0","eventId":"harness-4","type":"RepCompleted","sessionId":"harness","exerciseId":"squat","timestamp":3300,"source":"vision","confidence":0.93,"validation":"tested_real","units":{"lift_ms":"ms","lower_ms":"ms","pause_ms":"ms","rom_deg":"deg"},"data":{"repIndex":1,"count":1,"lift_ms":250,"lower_ms":250,"pause_ms":1250,"rom_deg":137}}
```

```json
{"type":"LoadRecommendation","source":"coach","validation":"computed","data":{"action":"increase","weight":140,"unit":"lb","reps":8,"extraRestS":0,"reasons":["All 8 reps at RPE 7.","A small step to 140 lb is reasonable for the next set."],"needsApproval":true}}
```
