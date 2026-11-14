# Camera performance analysis: status and roadmap

This covers universal camera support, velocity, fatigue, weight recommendations and validation.
For each phase it says what is **built and tested**, what is **built but not validated**, and what
is **not built**, with the reason.

## Status by phase
| Phase | Status | Where | Evidence |
|---|---|---|---|
| 1. Analyzer for every exercise | ✅ Registry: every exercise declares status, joints, anchor, views, lifting phase, limits | `lib/analyzers.js` | Unit tests; existing 4 lifts unchanged |
| — curl, squat, shoulder press | Counted; **tested on real video** (4 clips) | `reps.js`, `live.js` | `tools/vision-lab` |
| — push-up | Counted; **simulation only** | | 480/480 per variant (simulated) |
| — pull-up, deadlift | Counted; **experimental, simulation only** | `live.js` gates | 10/10 settings each; 0 false counts from presses, curls, squats, waving, half reps (simulated) |
| — bench press, lunge | **Manual**, with reason shown | | Bench: lying down, a phone rarely sees bar and arms. Lunge: detected, not counted |
| 2. Equipment tracking | ❌ Not built | | See below |
| 3. Velocity and movement metrics | ✅ Relative only: lift/lower time, ROM (°), speed (°/s), velocity loss, ROM loss, consistency | `lib/performance.js` | Unit tests |
| — m/s, displacement, peak velocity, acceleration | ❌ Omitted on purpose, with the reason in the data | | No calibration; only phase times stored per rep |
| 4. Force and power | ❌ Not built | | See below |
| 5. Fatigue and failure | ✅ Six levels: normal, possible fatigue, increasing difficulty, incomplete rep, failed attempt, uncertain | `lib/performance.js` | Unit tests; "failed attempt" only when an unfinished attempt follows the last rep and the target was missed |
| 6. Weight recommendations | ✅ Increase (≤5%), same, decrease (~7.5%), more rest, fewer reps, none; **needs approval** | `lib/recommend.js`, Mission | Unit tests; browser run-through |
| 7. Learning from history | ✅ Each set stores metrics, fatigue, suggestion and whether it was accepted; outcomes counted | `recommend.js` `evaluateRecommendations` | Says "too early" until 5 outcomes; no model is trained |
| 8. Voice and chat | ✅ One short live cue per set; after-set question; chat answers from recorded data | `lib/perfCoach.js` | Unit tests; browser chat check |
| 9. UI | ✅ Live: last rep time, speed change; after set: fatigue, suggestion, Use it / Keep plan | CoachScreen, Mission, Log a set | Browser run-through |
| 10. Datasets and validation | ❌ Plan only | | See below |

Nothing here is calibrated. Speeds are degrees per second of a joint angle, not bar speed. The
effort estimate in the set report is shown as an RPE range from rep speed. The app never states a
reps-in-reserve number from video; it asks the user.

## Phase 2: equipment tracking (not built)
- **Why not yet:** MediaPipe Pose has no barbell, plate or dumbbell landmarks. COCO-trained
  detectors (EfficientDet-Lite in MediaPipe Object Detector) have no barbell or dumbbell class.
- **Options to evaluate:**
  - A custom MediaPipe Model Maker object detector, or a small YOLO model exported to
    TFLite/ONNX-web, trained on labeled gym footage.
  - Tracking-by-detection with a Kalman filter.
  - For barbells from the side: plate detection, since a plate is a circle of known diameter. That
    gives a scale for metres and the bar path. It needs the plate face roughly parallel to the
    camera, and a perspective correction otherwise.
- **Risks:**
  - occlusion by the body (bench, deadlift lockout);
  - motion blur at 20–30 fps;
  - on-device speed on phones (pose already runs in a WebView);
  - lens distortion at the image edges.

## Phase 4: force and power (not built)
- For a vertically moving free weight with calibrated vertical acceleration:
  `F = m(g + a)` and `P = F·v`. That describes the bar, not the muscle.
- **Preconditions:**
  - calibrated displacement (Phase 2: known plate size);
  - the actual moving load, entered by the user (never body weight as a stand-in);
  - acceleration from a filtered trajectory, with an error estimate.
- **Not applicable as-is to:** cables and machines (pulleys, cams, friction), multi-joint body
  segments, or bodyweight movements.
- **If built:** label it "estimated bar force", show the uncertainty, and never call it muscle force.

## Phase 10: datasets and validation (plan)
The candidates below have **unverified licenses and annotations**. Read each license and inspect
the labels before use.

| Need | Candidates to check |
|---|---|
| Repetition counting | Countix (Kinetics-based), RepCount (TransRAC) |
| Technique assessment | Fitness-AQA |
| 3D pose in fitness | Fit3D (AIFit) |
| Multimodal workouts | MM-Fit (video + IMU) |
| Equipment detection | Open Images ("Dumbbell" class; check others), community gym-equipment sets |
| Bar velocity ground truth | Few or none public. Record our own against a linear position transducer or a validated device |

**Evaluation plan** (each exercise separately; squat results say nothing about other lifts):
- Recruit independent participants, with consent, and keep a held-out split that is never tuned on.
- Use a reference device: a linear position transducer for bar velocity, motion capture for
  joint range of motion.
- Metrics:
  - exercise classification accuracy and rep count accuracy;
  - velocity error in m/s once calibrated, and correlation for the relative measures;
  - range-of-motion error;
  - failed-rep detection (precision and recall) and false fatigue warnings per set;
  - recommendation outcomes (`evaluateRecommendations`) and on-phone latency.
- Real and simulated results are reported separately, always.

## Next steps, in order
1. Record consented real clips for pull-up and deadlift; promote them from experimental only if they pass.
2. Store per-frame angle traces for a camera set (landmarks only) so peak velocity can be computed honestly.
3. Prototype plate detection for calibrated bar speed on deadlift (side view), against a transducer.
4. Bench press from a side camera on the floor: feasibility study before registering it as experimental.
5. The rest of the catalog (cable and machine lifts, isometric holds, cardio): add each as a
   registry entry with `status: 'manual'` first. Write its analyzer only with a clip set to validate it.
