# Jim Bro CV: exercise coverage and training-data gaps

Status as of 14 Nov 2026, branch `feat/cv-lunge-legs`. "Reliable feedback"
means feedback we can stand behind for real users today, not whether the code
runs.

## Summary

| Exercise | Counting | Rule-based feedback | Learned model | Labelled data we can ship-train on | Reliable feedback today? |
|---|---|---|---|---|---|
| Squat (side) | Tuned on camera | Depth, hip drop, fast descent, torso shift vs. your own reps | UI-PRMD pattern score (records only) | UI-PRMD (deep overhead squat, correct/incorrect only); Multi-View Fitness (bodyweight squat, good/bad; **not yet inspected**) | **Counting and depth: yes.** Learned score: no (domain gap) |
| Squat (front) | Untested | Knees caving (2D proxy, estimated) | none | none verified | Estimated only |
| Deadlift | Untested on people | Lean-back at lockout; extension timing and torso change measured, not judged | none | **none** | Counting: unverified. Faults: **no** |
| Lunge | Front/back legs identified (this branch); untested on people | Step length, torso lean; front and back knee depth measured | none | **none** (UI-PRMD's inline lunge is a different movement) | Counting: unverified. Faults: **no** |
| Push-up | Untested on people | Hips sag/pike, chest drop | none | Multi-View Fitness (standard push-up, good/bad; not yet inspected) | Counting: unverified |
| Bicep curl | Untested on people | Elbow drift (side), body swing; per-arm range, style detection | none | Multi-View Fitness (alternating dumbbell curl, good/bad; not yet inspected) | Counting: unverified. Faults: rules only |
| Shoulder press | Untested on people | Uneven arms; per-arm lockout, overhead reach measured | none | Multi-View Fitness (standing dumbbell press, good/bad; not yet inspected) | Counting: unverified |

## Datasets checked

| Dataset | Access | Licence | Relevant content | Labels | Can train a shipped model? |
|---|---|---|---|---|---|
| [UI-PRMD](https://zenodo.org/records/23104965) | Open, downloaded and used | PDDL 1.0 (public domain) | Deep squat, inline lunge, side lunge (FMS / rehab style) | Correct vs. deliberately incorrect, no error type | Yes (done for squat; see `ml/uiprmd/REPORT.md`) |
| [Multi-View Fitness Exercise Dataset](https://data.mendeley.com/datasets/kgbb3yn47p/1) (Pai et al., Jul 2026) | Public on Mendeley, **but Mendeley's file and download endpoints returned errors (HTTP 502) on 14 Nov, so the files couldn't be inspected** | CC BY 4.0 (commercial use OK with attribution) | 7 exercises, 26 people, gym, smartphone, front / side / diagonal views: dumbbell side bend, bent-over row, **alternating dumbbell curl**, **push-up**, **standing dumbbell shoulder press**, **bodyweight squat**, overhead triceps extension. Raw MP4s | Good / bad per video, "manually reviewed"; **no error types; labellers' expertise not stated** | Probably, as weak labels (see below) |
| [Fitness-AQA](https://github.com/ParitoshParmar/Fitness-AQA) | Request form only | **Non-commercial** | Back squat, overhead press (barbell), barbell row; in-the-wild gym video | Trainer-labelled form errors (e.g. knees inward, shallow) | **No.** Research benchmark only |
| [Fit3D](https://fit3d.imar.ro/fit3d) | Account + licence acceptance | **Non-commercial; forbids training models for commercial use** | 47 exercises with mocap ground truth and rep intervals (exercise list includes deadlift / curl / lunge variants per the site; not verified at file level) | Exercise and rep timing only; **no form labels** | **No.** Usable to *measure* our angle and rep-timing accuracy under research terms |
| [FitAQA](https://huggingface.co/datasets/Kelly0510/FitAQA) | Open (annotations only) | Apache-2.0 annotations; videos keep source terms | Bodyweight exercises; 38-type error taxonomy | Question/answer and time-interval labels; test split only | No (no videos, no training split) |

### Why "good/bad" videos aren't automatically ground truth

The Multi-View Fitness labels say a video was manually categorised as good or
bad, not by whom or against which criteria. Plan for it:

1. Treat them as **weak labels**. Before training, have a qualified coach
   re-label a random 20% sample per exercise; report agreement (Cohen's κ).
   Below κ ≈ 0.6, don't train on that exercise's labels.
2. A video-level "bad" doesn't say which rep or what was wrong, so a model
   trained on it can only say "this set looks like the bad examples", like
   the UI-PRMD model. Rep-level, error-typed labels must come from our own
   annotation (below).
3. Validate subject-wise (leave-subjects-out across all 26), per view, and
   compare against the rule-based analyzer on the same reps, as was done for
   UI-PRMD.

## Gaps and what's needed

| Exercise | Missing | Footage needed (minimum for a first validated model) |
|---|---|---|
| Deadlift | Any shippable labelled data; rep-level error labels (hips rising first, bar drift, lockout) | 30+ lifters, side view, 2 sessions each, ~10 reps per session at mixed loads; both conventional and sumo kept separate |
| Lunge | Gym-style lunge data of any kind; labels for depth, knee travel, balance | 30+ people, side view, forward and reverse lunges as separate variations, both legs leading, ~10 reps each |
| Squat | Rep-level labels on ordinary gym squats (parallel, with and without load); front-view knee data with valgus labels | 30+ people, side and front views together (multi-camera), ~10 reps each, plus deliberate errors coached by a trainer |
| Bicep curl | Error-typed labels (swing, elbow drift, partial range) | Multi-View Fitness may cover good/bad; add ~20 people side and front with rep-level labels |
| Shoulder press | Error-typed labels (back arch, uneven lockout, partial range); barbell variation | Multi-View Fitness may cover dumbbell good/bad; add ~20 people, front and side |
| Push-up | Rep-level labels (sag, pike, partial range) | Multi-View Fitness may cover good/bad; add ~20 people, side view at floor level |

### Collection and annotation plan

1. **Capture**: a Record button on the test page that saves landmarks (not
   video) plus exercise, variation, view and a pseudonymous subject ID. Video
   only with explicit consent, for annotation, stored separately.
2. **Protocol per session**: natural reps first, then coached deliberate
   errors (one error type per set, named in the metadata), so every error type
   has examples from every subject.
3. **Annotation**: two qualified coaches label each rep independently, using
   the app's flag codes (multi-label, plus "unsure"). Disagreements go to a
   third coach. Report κ per label; drop or redefine labels below ~0.6.
4. **Splits**: by person, never by rep. Hold out whole people and one camera
   setup for testing.
5. **Release rule**: a learned check only gives feedback once, on held-out
   people, it beats the rule-based analyzer on the same reps at precision of
   at least 85%, and it never contradicts a measured rule.

## What changed on this branch

- **Lunge leg roles** (`leg_roles.ts`): the front leg is identified from foot
  position and facing direction, locked for each rep, re-decided for
  alternating reps, robust to left/right label swaps, and "uncertain"
  (no reading, a hint) when a leg is out of view or facing is unclear.
  Counting uses the front knee; the back knee is measured.
- **Exercise-specific measurements** (`RepEvent.metrics`): lunge front/back
  knee depth and step length; deadlift set-up and lockout hip/knee angles,
  torso-angle change, hip-vs-knee extension timing; curl per-arm range,
  upper-arm movement, set style (alternating / simultaneous / single-arm);
  press per-arm lockout, lockout difference, overhead reach. These are
  measurements only. None is turned into a fault flag without labels.
