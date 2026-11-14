# Validation report

Status as of 2026-11-14, branch `feat/engines`. **Real** and **simulated** results are reported
separately and must never be combined.

## Test suites (all passing)
| Suite | Command | Count |
|---|---|---|
| App logic, engines, wiring | `cd apps/expo && npm test` | 544 |
| Vision lab (simulator, scoring, validation framework, real-clip regressions) | `cd tools/vision-lab && npm test` | 51 |
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

**Speed from the angle trace (fix for the above):** reps now carry `peak_dps` and `mean_dps`, measured
from the joint-angle trace over the lifting phase. On the real squat clip, rep 1 measures 242°/s
peak and 103°/s mean. The old ROM ÷ threshold-phase-time figure was 137° / 0.25 s ≈ 548°/s, more than 5×
too high. Speed metrics now use the trace (`speed_dps` = `mean_dps` when present). These are still
relative joint speeds, not bar velocity. On simulated curls with known motion, the measured peak is
within the expected ±30% of 196°/s.

## Real-landmark cross checks (validation framework, `npm run validate -- --cross`)
Every real clip was replayed in every other camera mode (curl, squat, press, push-up, pull-up,
deadlift, lunge): **24 wrong-mode runs, 0 false reps**. This includes the real squat in lunge mode.
Landmark reliability on the real clips: tracked frames 80–100% (`ez_talk_a`: 80%, 4 dropouts),
jitter noise floor 0.9–1.2% of torso length.

## Engine CPU time (this laptop, not a phone)
`npm run bench`: Apple M5, Node 26, 73,050 frames of real landmarks. Per-frame vision and coach
logic: median 0.3 µs, p95 about 2 µs, rare GC spikes up to about 2 ms. The 20 fps budget is 50 ms per
frame, so the logic is negligible. **Pose inference (MediaPipe) is the real cost and has not been
measured on a phone:** use PHONE_VALIDATION_CHECKLIST.md.

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
| Lunge (experimental), side view, 4 seeds × alternating/same-leg × 2 noise levels | 8/8 exact counts and lead legs in every setting; 0 from half lunges, squats (flagged), walking, curls |
| Angle-trace peak speed vs. known simulated motion (curl, 2 s reps) | within ±30% of 196°/s |

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
- **Claude: real vision measurements → coaching, verified live** (run 43648254980), PASS in 3.8 s.
  The real squat clip went through the vision engine and was logged as a camera set. Asked about it,
  Claude cited the measured set ("2 of 2 reps at 135 lb… the last rep about 22% slower than the
  first and depth about 6% shallower") and flagged that 2 reps are too few to trust. No m/s claims.
- **`/physique` route verified live with a synthetic non-person image** (same run): it ran end to
  end and was declined as `not_physique`. **Not tested:** a real physique photo; that needs a
  consented image.
- **Equipment detection, calibrated velocity, force and power:** not built.

## Next data to collect (consented participants; half to `heldout`)
- 15–20-rep sets side-on: curl, squat, press, push-up.
- Pull-up facing the camera; deadlift side-on.
- Negatives: walking, bending over, stretching.
- Bad-form reps: swing, shallow squat, lean-back press.
- Sets taken close to failure, with the user's reported reps left (to calibrate fatigue).
- Phone runs: FPS and inference time on at least one iPhone and one Android phone.

Label before looking at predictions, and never tune on held-out clips.
