# Real-phone validation checklist

These are the tests that need physical hardware. Nothing below has been measured yet. Record
results in VALIDATION_REPORT.md under a "Phone" heading with the device model, OS and app build.

**Setup:** Expo Go on the phone (same Wi-Fi as the laptop), `npx expo start`. Phone on a stand at
hip height, 2–3 m away, good light, one person in frame. Consented participants only.

## 1. Speed (Coach screen footer: "NN fps · NN ms")
| Check | How | Pass |
|---|---|---|
| Effective FPS | Stand in frame for 60 s; note the fps readout every 10 s | ≥ 15 fps sustained (target 20) |
| Inference time | Same readout (ms) | p95 < 50 ms |
| Thermal | Run 3 sets × 2 min back to back; compare the first and last fps readings | Drop ≤ 30% |
| Battery | Battery % before and after 15 min of Coach use | Note it (no target yet) |
| Both cameras | Repeat FPS with the front and back cameras (flip button) | Note both |

At least one iPhone and one Android phone, ideally one older model of each.

## 2. Counting accuracy (Coach screen; count reps yourself)
For each lift: one set of 10–15 reps side-on, and one with the camera 45° off side. Write down
your count and the app's count.

| Lift | Status | Also try |
|---|---|---|
| Curl | real-tested | Alternating arms (known gap: only the locked arm counts); deliberate swinging (should show "Caught it") |
| Squat | real-tested | Facing the camera; quarter squats (should not count) |
| Shoulder press | real-tested | Seated; dumbbells |
| Push-up | simulation only | Knee and incline variants (check the variant label); phone on the floor vs. a table |
| Pull-up | experimental | Facing the camera, hips in frame; one kipping set |
| Deadlift | experimental | Conventional and sumo (known gap: sumo may be flagged as a squat); RDL from standing |
| Lunge | experimental | Alternating and same-leg; check the lead leg per rep in the set report |

**Negatives** (should count 0): walking past, waving, stretching, picking something up, a second
person walking through.

## 3. Feedback and voice
| Check | Pass |
|---|---|
| Rep counts are spoken in time, at most one cue per issue per set | Heard on device |
| iPhone with the ringer on silent still speaks | Heard |
| After a set: "You completed all N reps. How many more…?" | Heard and shown |
| "Caught it" badge on an aborted rep | Shown with the reason |
| Workout Mission end to end with camera counting | Completes; summary matches what happened |
| The experimental label shows for pull-up, deadlift and lunge | Shown |

## 4. Recording real clips for the validation system
On a laptop: `cd tools/vision-lab && npm run record`, then open the printed URL in Chrome. Tick
consent, choose the exercise, view and split, record, and press **Space** at each rep end. Move the
saved JSON into `tools/vision-lab/recordings/`, then run `npm run validate -- --cross`. Put half of
each person's clips in `heldout`.

## 5. AI on the phone
`server/jim-proxy/.env` (key + `JIM_PROXY_KEY`) and `npm run start:env`. Set
`apps/expo/.env` (proxy URL with the laptop's LAN IP + key). The header badge should read **AI**.
Ask "how was my last set?" after a camera set; the reply should cite your counted reps.
