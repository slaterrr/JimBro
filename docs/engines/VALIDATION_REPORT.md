# Validation report

Status as of 2026-11-14, branch `feat/engines`. **Real** and **simulated** results are reported
separately and must never be combined.

## Test suites (all passing)
| Suite | Command | Count |
|---|---|---|
| App logic, engines, wiring | `cd apps/expo && npm test` | 519 |
| Vision lab (simulator, scoring, real-clip regressions) | `cd tools/vision-lab && npm test` | 44 |
| AI proxy (Claude SDK mocked) | `cd server/jim-proxy && npm test` | 33 |

## Real-world evidence (labeled real video, landmarks from the production MediaPipe config)
| Clip | Exercise | Split | Labeled reps | Counted | Notes |
|---|---|---|---|---|---|
| fs_squat_rear | squat | dev | 2 | 2 | Also through `analyzeRecording` (engine API) |
| fs_press_rear | shoulder press | dev | 1 | 1 | Same |
| ez_talk_a | curl mode, person talking | dev | 0 | 0 | Adversarial |
| ez_talk_b | curl mode, person talking | **held out** | 0 | 0 | Adversarial; 5 fake reps → 0 after the torso-in-frame gate; never tuned on |

That is 4 clips and 3 true reps, which is **far too few to state accuracy**. These are regression
guards, not benchmarks.

**Phase timing finding:** on the real squat clip, `lift_ms` and `lower_ms` read 250 ms with
`pause_ms` 1250 ms. Phase boundaries are the counter's hysteresis thresholds, so slow movement
near the bottom is counted as "pause". Use the times only for comparisons within one set, not as
absolute tempo.

## Simulated evidence (logic only; says nothing about real accuracy)
| Check | Result |
|---|---|
| Curl / squat / press, 20-rep sets | 20/20 per lift |
| Push-up type (standard / knee / incline) | 480/480 per variant, 0 mislabels |
| Pull-up (experimental), 5 seeds × 2 noise levels, slowing reps | exact count in all 10 |
| Deadlift (experimental), same | exact count in all 10 |
| False reps: presses, curls and waving in pull-up mode; squats, curls and waving in deadlift mode; deadlifts in squat and curl mode; half reps | 0 counted |
| Walking across the frame in squat, deadlift, curl, press and push-up modes (3 seeds) | 0 counted |
| Lunges in squat mode | 0/640 counted; detected and reported as `ExerciseMismatch` |
| Live and recorded paths | Identical event streams on the same frames |

## Not validated (built, needs data)
- **Phone performance:** the app now measures FPS and inference time on the device (`perf`
  messages, shown on the Coach screen), but **no phone has been measured yet**. Desktop numbers
  don't transfer.
- **Fatigue thresholds** (30% / 15% velocity loss, 15% ROM loss) and the effort (RPE) estimate:
  uncalibrated against labeled fatigued sets.
- **Form-review thresholds:** no real bad-form clips.
- **Load recommendations:** the outcome tracking exists (`evaluateRecommendations`), but there are
  0 real outcomes; it reports "too early" until there are at least 5.
- **Claude: one live call verified** (GitHub Actions run 43642717579 (2026-11-14), workflow `claude-smoke.yml`, key from the
  `CLAUD_TOKEN` repository secret). `claude-sonnet-5-5`, fallbacks on: **PASS** in 2.4 s. Jim called
  `get_workout_context`, then answered from it: "Today is plan day 2, which is deadlift for 3 sets
  of 5…". That was 2 API calls and 78 output tokens.
- **Claude: history lookup and proposals verified live** (run 43646764489). Both PASS:
  - **Read tool:** `get_recent_sets` was called and the reply cited the exact sets (225 × 5 at RPE 8,
    then 235 × 5 at RPE 8.5, a new PR). 3.3 s.
  - **Write tool:** "Log 3 sets of 10 curls at 25 pounds" came back as one confirm-first proposal
    ("Log 3 sets of 10 × bicep curl at 25 lb?"); nothing was applied. 3.0 s.
  - **Not yet run live:** `/physique`.
- **Equipment detection, calibrated velocity, force and power:** not built.

## Next data to collect (consented participants; half to `heldout`)
- 15–20-rep sets side-on: curl, squat, press, push-up.
- Pull-up facing the camera; deadlift side-on.
- Negatives: walking, bending over, stretching.
- Bad-form reps: swing, shallow squat, lean-back press.
- Sets taken close to failure, with the user's reported reps left (to calibrate fatigue).
- Phone runs: FPS and inference time on at least one iPhone and one Android phone.

Label before looking at predictions, and never tune on held-out clips.
