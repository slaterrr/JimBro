# JimBro feature register

Status: planned unless a PR is merged and its acceptance tests pass. "Supported" for workout logging does not imply camera form analysis.

| ID | Feature | MVP / stretch | Target sprint | Acceptance |
|---|---|---|---|---|
| F01 | Installable mobile PWA with camera and microphone permissions | MVP | S1 | Real phone opens secure URL and permissions work |
| F02 | Live pose skeleton with landmark-confidence indicator | MVP | S1 | Visible overlay; tracking-loss state |
| F03 | Curl repetition counter | MVP | S2 | Counts full reps; ignores partials and jitter |
| F04 | Per-rep phase timing and estimated TUT | MVP | S2 | Timestamp-tested concentric/eccentric phases |
| F05 | Explicit exercise selection and manual logs for six lifts | MVP | S3 | Curls, squat, bench, deadlift, shoulder press, pull-up |
| F06 | Workout session/set records on Pi, offline-safe retry | MVP | S3 | Save/restart/reload; idempotent event IDs |
| F07 | Jim four tone variants and text coaching | MVP | S4 | Tone changes style, not safety or facts |
| F08 | Push-to-talk set logging and spoken response | MVP | S4 | Confirm transcription before record mutation |
| F09 | Goal/frequency/equipment-based workout plans | MVP | S4 | Structured plan validated against constraints |
| F10 | History and same-exercise comparisons | MVP | S5 | Display before/after metrics with correct denominator |
| F11 | Weekly challenges / leaderboard | MVP | S5 | Opt-in, comparable metrics; labeled sample data |
| F12 | Physical Pi display with real-time rep events | Stretch | S5 | Pi responds to phone events; optional GPIO |
| F13 | Squat / shoulder-press camera rep analysis | Stretch | After MVP | Separate validated movement configurations |
| F14 | Bench / deadlift / pull-up camera form analysis | Future | Post-hack | Dataset, camera angles and safety review required |
| F15 | Deep Agents planning / Photon messaging | Conditional | S6 | Only build if core demo passes and sponsor rules met |
| F16 | Accuracy + robustness evidence panel | MVP | S6 | Report n, precision, false positives, device FPS and limits |

## Data contracts to retain
Workouts have athlete, session, set, repetition, exercise, weight, units, timestamps, RPE, confidence, model version, and recommendation rationale. Raw workout video is opt-in only and not persisted by default.

## Non-claims
Video cannot directly measure muscular force or physiological fatigue. Report estimated movement-phase duration / TUT, not actual muscle tension. Technique feedback is limited by camera angle and tracking confidence.
