# Jim Bro CV: codebase review and dataset compatibility

Reviewed 14 Nov 2026 against `frontend/src/cv/` on branch `feat/cv-form-analysis`.
Dataset facts below come from each dataset's own README, licence page or API
listing, checked the same day. No dataset files were downloaded.

## 1. What the existing code does

| Question | Finding (from the code) |
|---|---|
| Pose model | MediaPipe Tasks Vision `PoseLandmarker` 1.1.1, `pose_landmarker_lite` float16, VIDEO mode, 1 person, GPU with CPU fallback (`pose_detection.ts`). 33 image landmarks with visibility, plus 33 world landmarks (metres) |
| How the visualiser tracks landmarks | `PoseLoop` runs `detectForVideo` once per new video frame on `requestAnimationFrame`; `drawSkeleton` paints straight onto a canvas over the video, counting joints in lime. Works for camera and video files |
| Joint angles | `calculateAngle`: 2D angle at the middle joint with x scaled by the video aspect ratio (fixes non-square pixels in normalised coordinates). `calculateAngle3D` on world landmarks for front-on squats. Each exercise picks the better-seen side (`pickSide`, with a margin so it doesn't flicker) |
| Movement measurements | Per exercise: a "progress" signal (hip drop, shoulder rise, chest drop, hands above shoulders) as a fraction of a body length learned in the start position; torso lean, knee-to-ankle ratio, step length, body line |
| Form evaluation | **Rules only, no ML.** Hardcoded thresholds for counting (start / full-range / partial angles, minimum progress, rep duration) and for some form checks; personal-baseline comparisons (vs. the user's own earlier reps) for torso shift and elbow drift; set-level trend checks |
| Reusable as-is for ML | Rep segmentation (the counter gives exact rep start/peak/end times), per-frame feature extraction (`exercise.read`), evidence/coverage filtering, `FormFlag` output format, the measured/estimated contract, video-file input for offline evaluation |

## 2. Likely causes of inaccurate readings

Ranked by how likely they are to produce a wrong count or wrong feedback.

1. **One-frame landmark glitches** (fixed in this change). Smoothing was a
   fixed EMA (alpha 0.5) with no outlier rejection, so a single bad frame
   was only halved. In a synthetic test, a one-frame jump to 40° in the middle of
   a 110° half squat made the old pipeline **count the rep**. The new filter
   rejects it (`signal_filter.test.ts`).
2. **Brief occlusions reset everything** (fixed). A single low-visibility
   frame reset the smoother and blanked the angle; the next frame came in
   unsmoothed. Gaps up to 150 ms are now bridged.
3. **Fixed lag/jitter trade-off** (fixed). The EMA smoothed equally at rest and
   in motion. The One Euro filter smooths hard at rest and lightly when moving.
4. **Camera angle.** 2D angles are only true from the view each exercise asks
   for. Mitigated, not solved: the view check warns, front-on squats use 3D
   angles. A phone that isn't level (camera roll) tilts "vertical" and biases
   torso-lean readings; personal-baseline checks absorb this within a session,
   fixed thresholds don't.
5. **Lite model.** The fastest and least accurate MediaPipe variant. Feet,
   wrists and a far-side limb are its weak points. The test page can now switch
   to `full` or `heavy` for a like-for-like comparison (see section 4).
6. **Thresholds not validated on real users** for deadlift, lunge, push-up,
   curl, press and front-on squat. Only side-on squats were tuned on camera.
7. **Left/right swaps** when the body is side-on (the model mislabels near and
   far limbs). The glitch gate catches the jump, and `pickSide` hysteresis
   limits flicker, but a sustained swap still reads the far limb.

## 3. Pose-pipeline changes made

`signal_filter.ts` (new), wired into `exercise_tracker.ts` for the counting
angle, the progress signal and every form signal:

| Problem | Change | Default |
|---|---|---|
| Jitter vs. lag | One Euro filter (timestamp-based, so dropped frames and video files behave the same) | min cutoff 3 Hz, beta 0.05 |
| Brief occlusion | Hold the last good value through short gaps; longer gaps still return null so tracking-loss rules apply | 150 ms |
| False detections | Reject readings implying a joint speed above a human limit; accept a new level only if it persists | 1000 °/s, 3 frames |
| Visibility of quality | `trackingQuality` in tracker state: % of frames visible, glitches rejected, gaps bridged; shown on the test page | – |

Already in place and unchanged: visibility gating (0.6), aspect-ratio
correction, side picking with hysteresis, body-length normalisation (so
thresholds scale with the person), personal baselines, 70% evidence rule.

## 4. Should the model be replaced?

**Not yet; no test has shown a clear benefit.**

- **MoveNet** (Lightning/Thunder): 17 COCO keypoints, no heels or toes and no 3D
  world landmarks. Switching would break facing detection (heel→toe) and
  front-on squat angles, and would mean rewriting every exercise reader. Only
  worth it if a measured test showed much better tracking, which published
  comparisons don't suggest for single-person fitness video.
- **MediaPipe full / heavy**: same 33 landmarks and API, so a drop-in swap
  (`detector.modelAssetPath`). Larger downloads (lite ≈ 5.8 MB, full 9.4 MB,
  heavy 30.7 MB) and slower on phones. This is the candidate to test.
- **How to decide**: on the test page, analyse the same recorded sets with
  `?model=lite`, `?model=full` and `?model=heavy`, and compare rep-count errors,
  the tracking row (visible %, glitches %), and frame rate on a mid-range phone.
  Switch only if full/heavy cut errors noticeably at an acceptable speed.

## 5. Dataset compatibility

| | Fitness-AQA | Fit3D | UI-PRMD | FitAQA |
|---|---|---|---|---|
| Available | Yes, **by request form** (not on GitHub) | Yes, download site (login link present) | Yes, **open** on [Zenodo](https://zenodo.org/records/23104965) | Yes, open on [Hugging Face](https://huggingface.co/datasets/Kelly0510/FitAQA) |
| What's actually in it | In-the-wild gym videos (Instagram/YouTube) with trainer labels for form errors; repo has code + licence PDF only | 4-view RGB (900×900, 50 fps), Vicon 25-joint 3D skeletons, SMPL-X meshes, rep time intervals; 47 exercises, 611 recordings | Vicon + Kinect joint positions (mm) and angles, comma-separated text; full and per-rep files; correct and `_inc` (incorrect) versions; 10 subjects × 10 moves × 10 reps | **Annotations only, no videos.** Two Parquet test files: 5,124 multiple-choice questions + 388 temporal-grounding items over 2,219 videos from QEVD, EgoExo-Fitness, Kinetics-700, UCF101; 38-type form-error taxonomy |
| Labels | Binary form errors per exercise (e.g. knees inward, shallow squat for back squat) | Exercise name + rep intervals; **no form-error labels** | Correct vs. incorrect only (**no error type**); the "reduced" package adds quality scores | Error type per question; time intervals for errors |
| Licence | Non-commercial only | Non-commercial; explicitly **forbids training models for commercial use** | **PDDL 1.0 (public domain): commercial use OK** | Apache-2.0 for annotations; videos stay under their sources' terms (QEVD: research-only) |
| Overlap with Jim Bro | Back squat, overhead press (barbell row not supported) | All six of ours, plus many more | Deep squat, inline lunge, side lunge | Bodyweight exercises incl. squat, lunge, push-up variants; no deadlift, curl or barbell press |
| Preprocessing needed | Run MediaPipe on the videos ourselves | Map 25 joints → our 33-landmark subset; or run MediaPipe on the RGB and compare with mocap | Map Kinect/Vicon joints → our subset; project 3D to a side or front view; resample to 30 fps | Obtain videos from each source under its terms; run MediaPipe; map 38 error types to our flag codes |
| Can teach | What real gym form errors look like, in real gym conditions | How accurate our angles and rep segmentation are (mocap ground truth) | The difference between correct and deliberately poor squats and lunges, as joint trajectories | How well our feedback explains errors; a vocabulary of error types |
| Can't teach | Anything shippable (licence); deadlift, lunge, curl | Form errors (none labelled); anything shippable | Which error was made; gym lifts with load; real phone-camera noise (mocap is clean) | Training (test split only, no landmarks) |
| Verdict | Research benchmark only | Research validation of angles and rep counting only | **Only one usable to train a shipped model.** Small, rehab-style, simulated errors: an initial squat/lunge quality score, labelled estimated | Evaluation of feedback wording and error taxonomy; not training |

### What this means

- Only **UI-PRMD** can train a model inside the app without a commercial
  licence, and it covers just squats and lunges, with "correct vs. incorrect" and
  no reasons. A UI-PRMD model can give an "unusual movement" score, but it
  can't say *what* was wrong. The rule-based checks keep doing that.
- **Fit3D** is the right tool to measure our joint-angle and rep-segmentation
  accuracy, under its research licence, provided nothing trained on it ships.
- **Fitness-AQA** and **FitAQA** are evaluation sets for research; FitAQA's
  error taxonomy is also useful for aligning our flag codes and wording.
- Everything else needs our own data (see `form-analysis-ml-plan.md`).

## 6. UI-PRMD model: done, with a finding

Built and evaluated (`ml/`, report in `ml/uiprmd/REPORT.md`): a squat
movement-quality model on UI-PRMD deep squats, using the app's own filter and
feature code. Held-out subjects: AUC 0.88, and 0.83 on reps deep enough for the
app to count, so it adds something beyond depth. But a normal parallel gym squat
at the app's minimum depth scores 87% "incorrect", because the dataset's correct
squats are deep overhead squats. So the app records the score and gives no
feedback from it until it's recalibrated on labelled gym recordings. Lunges were
not trained (UI-PRMD's inline lunge is a different movement).

## 7. Next steps

1. Record button on the test page and a small labelled set of real gym squats,
   to recalibrate the UI-PRMD model (or retrain it with gym data mixed in) and
   then turn its feedback on.
2. Fit3D angle-accuracy study (research licence; requires accepting its terms).
3. Model comparison (lite / full / heavy) on recorded sets.
