# Jim Bro: form analysis, datasets and ML plan

Status: plan. Nothing here is trained yet. The shipped tracker (`frontend/src/cv/`)
is rule-based; this document covers how to add a learned technique classifier on
top of it, which data to use, and how to prove it works.

Researched: 14 Nov 2026. Licences change; re-check each source before downloading.

## 1. What already exists (rule-based, in the browser)

| Area | Done today |
|---|---|
| Pose estimation | MediaPipe Pose Landmarker (lite), 33 landmarks + 3D world landmarks, GPU→CPU fallback |
| Sources | Live camera, and prerecorded video files (timed on the video's own clock) |
| Exercises | Squat, deadlift, lunge, push-up, bicep curl, shoulder press |
| Counting | Per-exercise state machine on one joint angle + a body-movement check (hip drop, shoulder rise...). Partial, too-fast, too-slow and tracking-lost reps are rejected with a reason |
| Biomechanics | Joint angles (aspect-corrected 2D; 3D for front-on squats), torso lean, phase timings (eccentric / concentric / hold), range of motion per rep |
| Form checks | Fixed checks only where a fixed number is defensible (push-up body line, curl elbow drift, lunge step length, deadlift lean-back at lockout). Personal-baseline checks where anatomy makes fixed angles unreliable (squat/deadlift torso shift, curl elbow drift vs. your usual). Knees caving (front-on squats, 2D knee-to-ankle ratio). Set-level: inconsistent depth, range lost over the set, reps slowing |
| Evidence rules | A signal is judged only if seen in ≥ 70% of the rep's frames; personal comparisons need 3 earlier reps; camera-view check warns instead of guessing; joints below visibility 0.6 give no reading |
| Labels | Every metric is tagged measured or estimated |

Not done: bench press (needs a side-on camera at bench height; same pattern as
the push-up, a good next exercise), automatic exercise recognition, and any
learned model.

## 2. Datasets

### What we need

1. Correct and incorrect technique, labelled per rep, ideally by a coach.
2. Pose sequences (or video we can run MediaPipe on, so train and run time see
   the same landmarks).
3. Camera angles matching the app: side-on and front-on, phone height.
4. Licence that allows training a model shipped in a product.

### Candidates

| Dataset | Exercises (ours in bold) | Labels | Data | Size | Licence / access | Fit for Jim Bro |
|---|---|---|---|---|---|---|
| [Fitness-AQA](https://github.com/ParitoshParmar/Fitness-AQA) (Parmar et al., ECCV 2022) | **Back squat, overhead press**, barbell row | 7 error types (e.g. knees inward, shallow squat), labelled by professional trainers | Real gym videos from Instagram/YouTube; occlusion by plates, racks | Thousands of clips | Request form, **non-commercial only** | Best match on labels and realism. Research and benchmarking only unless a commercial licence is negotiated |
| [EC3D](https://senakicir.github.io/projects/exercise_feedback) (Zhao et al., ACCV 2022) | **Squat, lunge**, plank | Correct + specific mistakes (feet too wide, knees inward, not low enough, bent back; lunge not low enough, knee past toes) | Multi-view 3D poses | 4 subjects | Academic release (check terms) | Mistake taxonomy is close to ours; far too few people to generalise. Good for a first prototype and unit fixtures |
| [QEVD / FIT-Coach](https://www.qualcomm.com/developer/software/qevd-dataset) (Qualcomm, 2024) | Many home-workout exercises incl. **squat, lunge, push-up** | Live coach-style feedback text, timestamped | Front-facing webcam videos | Large (hundreds of thousands of short clips + full sessions) | **Research-use licence** | Closest to our camera setup; feedback is free text, so labels need mapping to our codes. Research only |
| [Fit3D / AIFit](https://fit3d.imar.ro/) (Fieraru et al., CVPR 2021) | 47 exercises incl. **squat, deadlift, press, curl, lunge, push-up** | Rep segmentation; one instructor + trainees of varying skill (no per-rep error labels) | Vicon mocap + 4 RGB views, 3D skeletons and SMPL-X | 611 sequences, ~3M 3D frames | Academic (licence text not confirmed) | **Ground truth for joint-angle accuracy** and rep segmentation. Not a form-error dataset |
| [UI-PRMD](https://webpages.uidaho.edu/ui-prmd/) (Vakanski et al., 2018) | **Deep squat**, inline and side **lunge**, + rehab moves | Correct vs. incorrect (simulated patient errors) | Vicon + Kinect skeletons, no RGB | 10 subjects × 10 moves × 10 reps | **Open Data Commons PDDL (public domain)** | Only openly licensed one. Kinect/Vicon skeletons ≠ MediaPipe landmarks, so useful for angle-trajectory features and validation, not end-to-end training |
| [FLEX](https://haoyin116.github.io/FLEX_Dataset) (2025) | 20 fitness actions | Quality scores, multi-view, with EMG | RGB, 3D joints, sEMG | 7,512 samples, 38 subjects | Request form, **academic only** | Rich, but academic only and not error-coded per our taxonomy |
| [M3GYM](https://finalyou.github.io/M3GYM) (CVPR 2025) | Gym exercises, Pilates, yoga | 2D/3D keypoints, meshes, subject IDs | 8 cameras, 50+ subjects, 47M frames | Large | Request form, **non-commercial academic** | Pose-estimation robustness testing (multi-view, many bodies); not form labels |
| [MM-Fit](https://doi.org/10.5281/zenodo.7672767) (2020) | Full-body workouts incl. **squat, push-up, press, lunge, curl** | Exercise type + rep counts | RGB-D video, 2D/3D pose, IMUs | 20 sessions | Zenodo (licence not confirmed in research) | Exercise recognition and rep counting, not form |
| [kinetic-place/exercises-db](https://github.com/kinetic-place/exercises-db) | 900+ exercises | None (text instructions, muscles, equipment, YouTube links) | No coordinates | n/a | MIT | Exercise library for the Muscles/Coach screens, not for CV training |

### Takeaways

- **Every dataset with real form-error labels is research or non-commercial
  only.** They're fine for prototyping, choosing an architecture and
  benchmarking, but a model shipped in the app should be trained on data we're
  licensed to use. Get legal sign-off before any of this data touches a
  production model.
- **Camera mismatch** is the second risk: mocap/Kinect skeletons and
  multi-view rigs don't look like one phone on the floor. Always re-extract
  MediaPipe landmarks from the dataset's RGB video where it exists, rather than
  using the dataset's own skeletons.
- So the long-term dataset is **our own**: users who opt in record sets with the
  test bench (a Record button that saves landmarks, not video, is the next
  feature to build), and a coach labels reps in a simple review tool.

## 3. Labelling scheme

One record per rep, produced by the existing rule-based segmenter (so labels
line up with exactly what the app sees at run time):

```jsonc
{
  "exercise": "squat",
  "view": "side",                // side | front
  "subject": "anon-0142",        // pseudonymous; needed for subject-wise splits
  "frames": [[/* 33 × (x, y, z, visibility) */], ...],
  "fps": 30,
  "labels": {
    "SHALLOW_DEPTH": 0, "KNEES_CAVING": 1, "TORSO_SHIFT": 0, "HEELS_RISE": 0
  },
  "labeller": "coach-3",
  "confidence": "sure"           // sure | unsure, unsure reps are excluded from test sets
}
```

- Multi-label: one binary label per mistake code, matching the app's
  `FormFlag.code`s, so a model output plugs straight into the existing UI and
  voice.
- Mistakes per exercise (initial): squat (shallow, knees caving, excessive
  forward lean, heels rising, uneven depth), deadlift (hips rising first, bar
  drifting forward, rounding*, lean-back at lockout), lunge (short step, knee
  caving, torso lean), shoulder press (incomplete lockout, uneven arms, excessive
  back arch), curl (swing, elbow drift, partial range), bench press (partial
  range, uneven arms, bouncing).
  *Spinal rounding is not reliably visible to a single 2D camera; keep it out
  until we can show the model detects it on held-out data.
- Two coaches label a 10% overlap; report Cohen's κ per label and drop or
  redefine any label below κ ≈ 0.6. A model can't be more reliable than its labels.

## 4. Model

**Recommendation: a small temporal convolutional network (TCN) over one
segmented rep of normalised landmarks**, multi-label sigmoid head per exercise.

- **Input**: the rep resampled to 64 time steps × (selected joints × [x, y, z,
  visibility]) plus derived channels the rules already compute (joint angles,
  torso lean, knee-to-ankle ratio). Normalise: centre on mid-hip, scale by torso
  length, rotate so the body faces one way, and mirror left/right sides for
  side views.
- **Why a TCN**: reps are short (1–4 s), fixed-length after resampling, and
  datasets will be small (thousands of reps, not millions). A TCN trains fast,
  is stable on small data and runs on-device in a few ms with TF.js / ONNX
  Runtime Web.
- **Alternatives**: ST-GCN (graph conv over the skeleton) if the TCN plateaus,
  since it models joint relationships explicitly. A transformer only once there
  are tens of thousands of labelled reps; below that it overfits. An LSTM works
  but is slower to train and no more accurate here.
- **Exercise recognition**: the same backbone with a softmax head over a
  2–3 s sliding window (not a rep, since recognition must happen before
  counting starts). Train on MM-Fit/QEVD-style data for prototyping, then on
  our own recordings. Until it reaches the targets below, keep the manual picker
  and use recognition only to suggest ("Looks like lunges, switch?").
- **How it fits the app**: the rule-based counter stays in charge of counting
  (it's explainable and already validated). The model only adds or confirms form
  flags, tagged `estimated`, and it can abstain: if max(p, 1 − p) is under a
  calibrated threshold for a label, no flag is raised.

## 5. Training

1. **Splits by subject, never by rep.** Train / validation / test = 70 / 15 / 15
   by person, so the test set measures generalisation to new users. Also keep a
   "new camera" test slice (a phone height or distance not seen in training).
2. **Augmentation** (on landmarks, cheap): small 3D rotations about the vertical
   axis (±20°, re-projected), scale ±15%, time-warp 0.8–1.25×, Gaussian jitter,
   random joint dropout (simulates occlusion), left/right mirroring.
3. **Imbalance**: mistakes are rarer than good reps; use per-label positive
   weighting or focal loss and report per-label metrics, never only accuracy.
4. **Overfitting control**: small model (≈ 50–200k parameters), dropout, weight
   decay, early stopping on validation macro-F1, and a learning curve (does
   adding subjects still help?).
5. **Calibration**: temperature scaling on the validation set so confidences
   mean something; the abstain threshold is set from the calibrated curve.
6. **Export**: ONNX / TF.js, quantised; measured on a mid-range phone.

## 6. Accuracy targets and validation

These are targets to meet before a feature ships, not current results.

| What | Metric | Target | How it's measured |
|---|---|---|---|
| Pose detection | % of frames with all counting joints ≥ visibility 0.6, recommended setup | ≥ 95% | Held-out recordings across body types, clothing, lighting |
| Joint angles | Mean absolute error vs. mocap | ≤ 5° side view (knee, hip, elbow); ≤ 10° front view 3D | Fit3D (mocap + RGB): run MediaPipe on its RGB, compare with mocap angles; plus a goniometer spot check on 10 volunteers |
| Rep counting | Count error per set | ≥ 98% of sets exact; partial reps rejected ≥ 95% | Own labelled sets incl. deliberate partial reps (the existing synthetic tests stay as regression tests) |
| Exercise recognition | Macro-F1, confusion matrix | ≥ 0.95 | Subject-wise test set, 6 exercises + "other" |
| Technique classification | Per-label precision / recall / F1, PR curves | Precision ≥ 0.85 at recall ≥ 0.70 per label | Subject-wise test set, coach labels as ground truth; compare against inter-coach agreement |
| Abstention | Coverage vs. precision | Report both; never ship a label whose precision drops below target at the chosen coverage | Calibrated thresholds |

Precision matters more than recall for coaching: a wrong "your knees caved"
erodes trust faster than a missed one.

**Subgroups.** Report every metric separately by body size (BMI band), sex,
skin tone (Fitzpatrick bands), clothing (loose / fitted), lighting (bright /
dim / backlit), camera height and distance, and gym vs. home. Ship only if no
subgroup falls more than 5 points below the overall figure.

## 7. Order of work

1. Record button on the test bench (landmarks + exercise + view to JSON, no
   video) and a review page for coaches to label reps.
2. Joint-angle validation on Fit3D, to prove the measurements before building
   on them.
3. Prototype the TCN on EC3D + Fitness-AQA (research use) to choose
   architecture and features; report subject-wise results.
4. Collect our own labelled data (consent, pseudonymous IDs, landmarks only);
   train the production model on it.
5. Ship behind a flag as `estimated` flags with abstention; compare in-app
   against the rule-based checks before enabling for everyone.
6. Bench press as the next rule-based exercise; exercise recognition as a
   suggestion, then automatic once it meets target.
