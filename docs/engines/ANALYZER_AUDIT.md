# Camera analyzer audit: what limits real-workout accuracy

Read from the code (`lib/analyzers.js`, `reps.js`, `live.js`, `angles.js`) on `feat/engines`.
"Real evidence" means labeled real clips; everything else is simulation or untested.

## Shared to all analyzers
| Limit | Effect on real workouts | Status |
|---|---|---|
| One joint angle per lift, hysteresis rest/peak thresholds | Reps with less range than the peak threshold are not counted (by design), so partial-range users may be under-counted | Thresholds tuned on simulation plus 3 real reps |
| `min_rep_ms` 500 ms, `cooldown_ms` 250 ms | Very fast reps (< 0.5 s per rep) are rejected as partials | Fine for strength work; may miss fast push-ups |
| `max_gap_ms` 1000 ms of low confidence aborts a rep | Occlusion longer than 1 s (a plate passing in front, a spotter) loses the rep | Correct direction (no fake reps) |
| Single pose (MediaPipe numPoses 1) | A second person in frame can take over tracking; gates abort the rep, but no person ID | Untested on real multi-person footage |
| 20 fps cap, Lite model | Fast movements blur; landmark jitter is higher than the Full model | Not measured on phones |
| Side lock: the side chosen at first good tracking | **Alternating dumbbell curls: only the locked arm is counted** | Real gap |
| Smoothing EMA 0.5 | Adds about 1 frame (50 ms) of lag to rep times | Small |
| Phase times from threshold crossings | Real squat clip: 250 ms lift, 1250 ms "pause". Use for relative comparisons only | Documented |

## Per analyzer
| Lift | Status | Real-accuracy risks | What would validate it |
|---|---|---|---|
| Curl | real (2 clips, 0 FP) | Front-on cannot count (elbow flexion is in depth); alternating arms; the 50° swing gate is not validated on real swinging; hammer curls should behave the same (untested) | 15–20-rep side-on sets, alternating sets, deliberate swing sets |
| Squat | real (1 clip, 2/2) | Quarter squats not counted (peak 95°); front view uses a calibrated foreshortening estimate (sim only); ankles must be visible; heavy forward lean is fine for the knee angle | Front-view sets, varied depth, a lunge-mode false-count check |
| Shoulder press | real (1 clip, 1/1) | Seated vs standing untested; behind-the-neck and Arnold press untested; front view only via the arms-in-image-plane sim | Seated dumbbell, standing barbell, front-on sets |
| Push-up | sim only | Side view only; camera height matters (floor-level phone vs. table); very fast reps < 0.5 s rejected; front view not handled | Knee, standard and incline sets from the side; a floor-level phone |
| Pull-up | **experimental**, sim only | Facing view only; hips must be in frame (camera far back); kipping may trip the joint-speed gate; the chin-over-bar peak (80°) may be too strict for some arms; chin-ups same logic | Strict, kipping and chin-up sets, facing and side-on |
| Deadlift | **experimental**, sim only | **Sumo deadlift: knee bends below 100°, so it is flagged as a squat** (real limitation); unloaded bending is indistinguishable; RDL from standing works (rest = bottom) | Conventional, sumo and RDL sets side-on |
| Bench | manual | Lying down: a side camera at bench height is needed; the bar often hides the far arm | Feasibility clips with a side phone on the floor |
| Lunge | **experimental** (sim; real squat in lunge mode counts 0) | Side view only; depth = the more-bent knee; lead leg per rep; front view unsupported; walking lunges untested | Forward, reverse and walking lunges from the side |

## Priorities for real accuracy (in order)
1. **Collect labeled real sets** with the recorder (`tools/vision-lab/record.html`) and score them with
   `node validate.mjs`. Nothing else matters as much.
2. ~~Lunge counting with leg roles~~: done (experimental, side view); needs real clips.
3. Alternating-arm curls (count both arms when both are visible).
4. Sumo stance for deadlift (stance-width check before the squat gate).
5. Side-view pull-ups.
