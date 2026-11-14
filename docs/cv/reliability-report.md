# Jim Bro CV: measurement reliability and the evidence needed for warnings

Status 14 Nov 2026, branch `feat/cv-validation`.

## Two different kinds of "passing"

| | What it shows | Current state |
|---|---|---|
| **Unit tests** (`npm test`, 256 passing) | The code does what it was designed to do on **synthetic** input: geometry, state machines, filters, the evaluation maths, the training gates | All pass |
| **Real-world accuracy** (validation lab → report) | How close the app's output is to what reviewers marked on **recorded people** | **Not measured yet: no annotated recordings exist.** Every measurement below is unvalidated until they do |

A green test suite never means a measurement is accurate on people.

## Reliability by measurement

"Field use" is the only real-person evidence so far: squats were tried live
on one person's camera during development, with no annotation.

| Exercise | Measurement | Evidence today | Status |
|---|---|---|---|
| Squat (side) | Rep count, depth gate, hip drop | Field use by one person; synthetic tests | **Unvalidated** (plausible) |
| Squat (front) | 3D knee angle, knees-caving ratio | Synthetic only | Unvalidated |
| Lunge | Rep count on the front knee; front/back leg roles; back knee depth; step length | Synthetic (both facings, alternating reps, label swaps, occlusion) | Unvalidated |
| Deadlift | Rep count; set-up/lockout hip and knee angles; torso-angle change; hip-vs-knee timing | Synthetic only | Unvalidated |
| Bicep curl | Rep count (side, and front with alternating-arm handover); per-arm range; set style | Synthetic only | Unvalidated |
| Shoulder press | Rep count; per-arm lockout and difference; overhead reach | Synthetic only | Unvalidated |
| Push-up | Rep count; body line | Synthetic only | Unvalidated |
| All | Joint angles (2D vs 3D sagittal) | Synthetic: 2D degrades with camera yaw (≈ 12° off at 40°), 3D doesn't; real MediaPipe depth noise untested | Unvalidated |
| Squat | UI-PRMD movement-pattern score | Held-out mocap AUC 0.88, but known domain gap | Recorded only, never shown |

## Exercise validation (squat vs lunge)

Bug reported from live use: with Squat selected, deliberate lunges were
counted. Cause: the squat reader judged only the camera-nearest leg's knee
and hip drop, which a deep lunge also passes; nothing checked the other leg,
foot placement or stepping. The same gap let squats count as lunges.

Fix: a movement-validation layer between the counter and the count (see the
CV README). Evidence so far is **synthetic only**:

| Test (synthetic 3D bodies, noise ≈ 0.5% of frame) | Result |
|---|---|
| Without validation, deep lunges with Squat selected | counted (bug reproduced) |
| Squats, 3 builds × 5 camera angles | all counted |
| Lunges, forward/reverse/alternating, with Squat selected | none counted ("doesn't match") |
| Walking, bending forward, partial squats with Squat selected | none counted |
| Squats with Lunge selected | none counted |
| One leg hidden through a squat | not counted ("couldn't confirm") |
| Squat → lunge → squat | 2 counted, numbered 1 and 2 |
| 30 varied squats / 30 varied lunges | 30/30 squats counted, 0/30 lunges |
| Heavy noise (1.2–2.2%), 60 each | 52/60 squats counted (front/diagonal views suffer), 0/60 lunges |

**Not yet measured on real people:** how many real squats are wrongly
rejected, and how many real lunges get through. To measure it, record squat
sets with deliberate lunges, walking and bends mixed in. Annotate every attempt
in the lab, setting "actually performed" on the non-squats, and run Evaluate.
The report then shows "real reps counted" and "wrong movements counted"
per view. A rep verdict can't be "validated" if any wrong movement was
counted.

## What's needed before anything is shown to users

### Counts and measurements (numbers on screen)

Per exercise and camera view, from the validation lab report:

| Measurement | Target | Minimum evidence |
|---|---|---|
| Rep count | ≥ 97% precision and recall; ≥ 95% of sets exactly right | 10 people, 100 annotated reps |
| Joint angles | Mean absolute error ≤ 5° side view, ≤ 10° front/diagonal, vs goniometer or mocap (on-screen estimates don't count) | 10 people, 30 reference angles |
| Lunge front leg / curl arm | ≥ 95% correct, with "uncertain" counted as not correct | 10 people, 50 reps |
| Latency | Tracker pipeline p95 ≤ 4 ms/frame (pose detection reported separately) | Any device mix you ship to |

Below the minimum evidence, the report says "insufficient evidence" however
good the numbers look.

### Technique warnings (telling someone their form is wrong)

A stricter bar, because a wrong warning does more harm than a missed one:

1. The characteristic is defined in writing by your coaches (what it is, and
   what it isn't), with the code used in the lab.
2. At least **two independent qualified reviewers** labelled it on recorded
   reps, with agreement **κ ≥ 0.6**. If coaches can't agree, a model can't
   learn it.
3. At least **10 people and 30 reps of each class** with agreed labels.
4. Held-out (leave-one-person-out) **precision ≥ 85%**, and better F1 than
   the existing rule for the same code, if there is one. The trainer
   (`npm run train:traits`) checks all of this and refuses otherwise.
5. The underlying measurements (counts, angles, leg roles) are already
   validated for that exercise and view (table above).
6. Shown as "estimated" with a confidence, and spoken only after a field trial
   shows users understand it.

Today, **no technique warning meets this bar**. The rule-based tips that
exist (e.g. hips sagging, elbow drift) are based on biomechanics, not
validated labels. They should be reviewed by a coach and checked in the lab
before they're trusted in production.

## How to produce the evidence

1. `npm run dev` in `frontend/`, open `/cv-lab.html`.
2. Load a video, give a pseudonymous subject ID, tick "mirrored" for selfie
   footage, and extract landmarks. Save the recording JSON.
3. Each reviewer annotates independently: reps (S/E keys), front leg or arm
   per rep, goniometer angles at marked times, and technique characteristics
   from your written definitions.
4. "Evaluate all" gives the report above per exercise and view. "Export
   dataset" gives the JSON Lines file for `npm run train:traits`.
5. Record both side and front (and diagonal) views of the same sets where
   possible, so the camera-angle comparison is like for like.

## Limitations fixed on this branch (each with an objective test)

| Limitation | Fix | Test |
|---|---|---|
| Alternating curls merge reps | One counting arm, handed over only after it's been straight for 200 ms | Overlapping synthetic set: old rule merges, new counts 6/6 |
| Lunges need both legs visible | While roles are locked, the back leg may be hidden ≤ 15 frames if the visible leg is the locked front leg; a hidden front leg is still "uncertain" | Short and long occlusions; hidden front leg |
| Camera perspective distorts angles | 3D sagittal-plane angle; the lab reports 2D and 3D error side by side so data decides | Synthetic yaw sweep, plus end-to-end evaluation |
| MediaPipe swaps/loses landmarks | Already handled by the glitch filter, gap bridging and lunge re-pairing; the lab now **counts** suspected knee swaps, missing and low-visibility frames | Swap detector test |
