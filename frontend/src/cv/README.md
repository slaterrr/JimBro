# Jim Bro CV module: exercise tracking

In-browser rep counting and form feedback with MediaPipe Pose Landmarker, from
the live camera or a prerecorded video. Video never leaves the device.
Supported exercises: **squat, deadlift, lunge, push-up, bicep curl, shoulder press**.

The plan for datasets, a learned form classifier and accuracy targets is in
[docs/cv/form-analysis-ml-plan.md](../../../docs/cv/form-analysis-ml-plan.md); the
code review and verified dataset compatibility are in
[docs/cv/codebase-and-dataset-review.md](../../../docs/cv/codebase-and-dataset-review.md).

## Quick start (frontend)

```tsx
import { useRef } from "react";
import { useExerciseTracker } from "./cv";

function LiveWorkout() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useExerciseTracker(videoRef, canvasRef, { exercise: "pushup" });

  return (
    <>
      <div className="relative aspect-video">
        {/* Mirror both or neither */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain -scale-x-100" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain -scale-x-100" />
      </div>
      <p>{t.repCount} reps · {t.phaseLabel}</p>
      {(t.error ?? t.positionHint) && <p>{t.error?.message ?? t.positionHint}</p>}
      <button onClick={t.start}>Start</button>
      <button onClick={t.pause}>Pause</button>
      <button onClick={() => saveSession(t.stop())}>End</button>
    </>
  );
}
```

Outside React, use `new ExerciseTracker(video, canvas, { exercise })` directly: same API.

Prerecorded video (e.g. from `<input type="file" accept="video/*">`):

```ts
tracker.onSessionEnd((session) => save(session)); // fires when the video ends
await tracker.startFile(file, { playbackRate: 1 }); // lower the rate on slow devices
```

Test bench: `npm run dev` in `frontend/`, then open http://localhost:5173/cv-demo.html.

## Interface

| Member | What it is |
|---|---|
| `status` | `idle` → `starting-camera` → `loading-model` → `tracking` ⇄ `paused` → `stopped`, or `error` |
| `error` | `{ code, message }`. Codes: `PERMISSION_DENIED`, `NO_CAMERA`, `CAMERA_IN_USE`, `INSECURE_CONTEXT`, `NOT_SUPPORTED`, `STREAM_ENDED`, `MODEL_LOAD_FAILED`, `VIDEO_LOAD_FAILED`, `UNKNOWN`. `message` is user-ready. |
| `source`, `videoProgress` | `camera` or `file`; playback position of a video file |
| `startFile(file)`, `onSessionEnd(cb)` | Analyse a video file; the session ends (and `cb` fires) when it finishes. Rewinding drops the half-finished rep |
| `measuredView` | `side` or `front`: which view the angles were measured from |
| `exercise`, `setExercise(id)` | Current exercise. Switch only when not tracking; an unsaved session is discarded. |
| `phase`, `phaseLabel` | Generic phase (`start` / `toward_peak` / `peak` / `returning`) and its label for this exercise, e.g. "descending" |
| `armed` | `false` until the user is in the start position. Show `getExercise(id).startPrompt`. |
| `positionHint` | Set when the user is visible but out of position (standing during push-ups, an arm hidden during presses) |
| `repCount`, `lastRep` | Counted reps only. `lastRep` is a shared `RepEvent`. |
| `lastRejection` | `FormFlag` explaining why the last attempt didn't count |
| `lastAttempt` | Peak angle and progress of the last attempt, counted or not (for calibration) |
| `liveAngle`, `liveProgress` | Smoothed counting-joint angle (°) and progress signal (fraction), or `null` |
| `cameraView`, `viewWarning` | View check (estimated) and a warning if it doesn't suit the exercise |
| `start()`, `pause()`, `resume()` | Pausing keeps the camera on and discards a half-finished rep |
| `stop()` | Ends the session, stops the camera, returns a shared `WorkoutSession` ready to POST |
| `onRep(cb)`, `onRejected(cb)` | Immediate events (use in `useEffect`, return value unsubscribes) |
| `setCounterConfig(patch)` | Adjust the current exercise's thresholds live (calibration sliders) |

State updates are throttled to 10 Hz (`uiUpdateHz`). The skeleton is drawn on the
canvas directly (counting joints in lime), so it never triggers a React render.

## Exercises

Every exercise uses the same state machine (`rep_counter.ts`) on one joint angle,
plus an optional **progress** check that the body really moved. Each is one file
in `exercises/`; adding another is a new file plus a line in `exercises/index.ts`.

| | Squat | Deadlift | Lunge | Push-up | Bicep curl | Shoulder press |
|---|---|---|---|---|---|---|
| Camera | Side-on, 2–3 m, whole body. **Or front-on** (adds knee tracking) | Side-on, whole body and bar | Side-on, whole body, room to step | Side-on, at floor level, ~2 m | Side-on, curling arm nearest | Facing the camera, head to hips |
| Counting angle | Knee, better-seen leg (front-on: both knees, 3D estimate) | Hip (shoulder–hip–knee) | Knee, better-seen leg | Elbow, better-seen arm | Elbow, nearest arm | Elbow, **both** arms (lagging arm decides) |
| Start position | Knee ≥ 160° (standing) | Hip ≤ 115° (set up over the bar) | Knee ≥ 155° (standing) | Elbow ≥ 150° (top of plank) | Elbow ≥ 145° | Elbow ≤ 100° (weights at shoulders) |
| Full range | Knee ≤ 85° | Hip ≥ 165° (lockout) | Knee ≤ 105° | Elbow ≤ 90° | Elbow ≤ 65° | Elbow ≥ 155° |
| Progress check | Hips drop ≥ 40% of leg length | Shoulders rise ≥ 30% of torso length | Hips drop ≥ 25% of leg length | Shoulders drop ≥ 30% of arm length | none | Hands ≥ 70% of arm length above shoulders |
| Position gate | Front-on: both legs to the feet in view | none | none | Body within 40° of horizontal | none | Both arms visible |
| Fixed form checks | Knees caving on the way up (front-on only, estimated) | Leaning back > 15° at lockout | Step < 45% of leg length, torso > 25° from upright | Hips sagging / piked (< 160°) | Elbow drift > 35°, body swing > 15° | Uneven arms > 25° |
| Personal checks (vs. your earlier reps) | Torso angle change | Torso angle change on the way up | none | none | Elbow drift | none |

All exercises also get fast lowering (measured), and after 3 reps: uneven tempo
and less range than your previous reps (estimated).

A deadlift rep runs from the floor to lockout and back to the floor, so the
first pull counts and every rep must return the bar down. Romanian deadlifts
(starting standing) aren't supported.

Rough angle guides (side-on): half squat ≈ 100–110°, parallel ≈ 60–75°; full
lunge ≈ 80–100°; deadlift set-up ≈ 60–110°, lockout ≈ 165–180°; half push-up ≈
110–120°; half curl ≈ 90–100°; press lockout ≈ 160–175°.

### Personal baselines instead of universal angles

Some things can't be judged with one number for everyone: how far the torso
leans in a squat depends on limb proportions, squat style and bar position.
For those, each rep is compared with **your own earlier reps in the session**
(the median of at least 3), and only a clear change is flagged, e.g. "Your
torso angle changed about 18° more than on your usual reps". Fixed thresholds
are kept only where a fixed number is defensible (a sagging push-up, a lunge
step too short to be a lunge).

### Evidence rules: no guessing

- A form signal is judged only if it was seen in **≥ 70% of the rep's frames**
  (`minEvidence`); otherwise that check is skipped for the rep.
- Personal comparisons and consistency flags wait for 3 earlier reps; set-level
  insights need 4–6 reps.
- Joints below `minVisibility` give no reading at all; if the camera view
  doesn't suit the exercise, the user is told instead of being given feedback
  from a bad angle.

### Set-level insights (in `WorkoutSession.summary.insights`)

- `RANGE_INCONSISTENT`: e.g. "Your squat depth was inconsistent across the set"
  (peak-angle SD > 8°, 4+ reps)
- `RANGE_DECLINED`: range of the last 3 reps > 10° short of the first 3 (6+ reps)
- `TEMPO_SLOWED`: last 3 reps took > 1.4× as long as the first 3 (6+ reps)

### Not counted (all exercises)

- Not reaching the full-range line (`SHALLOW_DEPTH`, `SHALLOW_PUSHUP`, `INCOMPLETE_CURL`, `INCOMPLETE_PRESS`)
- Angle reached but the body didn't move (`NO_HIP_DROP`, `CHEST_NOT_LOWERED`, `NOT_OVERHEAD`): e.g. a raised leg on one foot, bending the elbows without lowering, straight arms out to the side
- Faster than the minimum rep time (`REP_TOO_FAST`) or over 12 s (`REP_TOO_SLOW`)
- Counting joints out of view for > 0.7 s (`TRACKING_LOST`)
- Nothing counts until the start position is seen, so starting mid-rep can't create a phantom rep. An incomplete "attempt" over 12 s is treated as a rest and stays silent (e.g. arms down between press sets).

## How counting works

1. **Landmarks → angle.** The exercise picks the limb(s) (`pickSide` keeps the
   better-seen side, with a margin so it doesn't flicker) and computes the
   angle, corrected for the video's aspect ratio. Joints below `minVisibility`
   (default 0.6) give `null`, never a guess.
2. **Filtering** (`signal_filter.ts`). One Euro smoothing (heavy at rest,
   light while moving, timestamp-based), gaps up to 150 ms bridged with the
   last good value, and readings implying a joint speed over 1000 °/s rejected
   as glitches, so one bad frame can't push a partial rep over the line.
   Tune with the `filter` option. `trackingQuality` reports visible / glitch /
   gap rates.
3. **State machine:** start → toward_peak → peak → returning → start, with a
   dead band between start and leave-start and hysteresis at the peak. The
   `direction` setting handles exercises whose angle opens toward the peak
   (shoulder press).
4. **Progress.** For squats and push-ups, the drop below the start-position
   height (baseline learned while in the start position) as a fraction of leg /
   arm length. For presses, hand height above the shoulders.
5. **Timing.** Duration runs from leaving the start zone to returning to it.

## Measured vs estimated

| Metric | Label | Why |
|---|---|---|
| Rep count, rep and phase durations | **measured** | Threshold crossings of the observed angle, timestamped |
| Joint angles, peak angle, progress signals | **measured** | Read from the image. Accurate only from the camera position each exercise asks for, which is why the view check exists |
| Fixed form checks in the table above (except knees caving), fast lowering | **measured** | From observed angles and timings |
| Front-on squat knee angle | **measured**, less precise | From the model's 3D estimate rather than a side-on 2D angle |
| Knees caving | **estimated** | A 2D knee-to-ankle ratio, front-on only: a screening proxy, not a true 3D valgus angle |
| Personal checks, set-level insights | **estimated** | Comparisons that assume your earlier reps were representative |
| Tempo consistency (CV of rep time, %) | **estimated** | Depends on tracking quality. Confidence scales with rep count and fraction of frames tracked |
| Range consistency (SD of peak angle, °) | **estimated** | Same |
| `UNEVEN_TEMPO`, `RANGE_VARIES` flags | **estimated** | Comparisons against the session median, after 3 reps |
| Camera view (side / front) | **estimated** | Heuristic from shoulder spread vs torso length; only when upright |

**Not claimed (never reported):** back rounding or spinal position, knee valgus
from a side view, weight distribution, bar path, load, grip, wrist angle,
shoulder-blade movement.

## Voice coaching

`VoiceCoach` speaks cues with the browser's built-in speech (Web Speech API),
offline, no API key. Wording comes from the current exercise.

```ts
const coach = new VoiceCoach(tracker);
startButton.onclick = () => { coach.attach(); tracker.start(); }; // must start from a click
coach.setEnabled(false);                  // mute toggle
coach.announceSession(tracker.stop());    // "Nice work. 8 reps."
```

It says: the exercise's setup instructions on start; its start prompt until
armed, then "Ready"; each rep number (interrupting anything else); why a rep
didn't count; at most one form tip per rep (measured first, then estimated tips
that have a spoken form such as "Push your knees out"); the first set-level
insight in the summary; the position hint or "I
can't see you" after 2.5 s out of view; camera-view warnings; pause/resume and
the session summary. Each cue has an 8 s cooldown. Estimated consistency flags
are shown, not spoken.

## Files

| File | Responsibility |
|---|---|
| `exercise_tracker.ts` | `ExerciseTracker`, which wires it all together (the public interface) |
| `useExerciseTracker.ts` | React hook |
| `exercises/*.ts` | One definition per exercise: thresholds, landmark reading, form checks, wording |
| `rep_counter.ts` | Generic `RepCounter` state machine, `BaselineDropMeter` |
| `form_analyzer.ts` | Generic rep flags, personal-baseline checks, evidence filter, session summary and insights, camera-view check |
| `body_metrics.ts` | Torso lean, facing direction, knee-to-ankle ratio |
| `pose_detection.ts` | Camera, model loading (GPU → CPU fallback), detection loop, side picking, overlay drawing |
| `angle_calculator.ts` | `calculateAngle`, `calculateAngle3D`, `AngleSmoother` (legacy EMA) |
| `signal_filter.ts` | `SignalFilter`: One Euro smoothing, gap bridging, glitch rejection |
| `voice_coach.ts` | `VoiceCoach` |
| `index.ts` | Public exports. Import from here only. |

## Known limitations

- Squat (side-on) thresholds were tuned on a real camera; deadlift, lunge,
  push-up, curl, press and front-on squat thresholds come from geometry and
  synthetic tests and need checking on real users. The test bench sliders and
  video upload make that quick.
- Bench press isn't supported yet (it needs a side-on camera at bench height).
- Form checks are rules; there is no learned model yet (see the ML plan).
- Bicep curls from the side count only the arm nearest the camera. Alternating
  curls need two sets, one facing each way.
- Single-leg squats (pistols) and other variations are not supported.
- The test page can switch pose model with `?model=lite|full|heavy` for
  comparisons; the default stays `lite` until a test shows a clear gain (see
  docs/cv/codebase-and-dataset-review.md).
- The model (`pose_landmarker_lite`, ~6 s first load) and WASM come from
  Google's and jsDelivr's CDNs. Self-host them (`detector.wasmBaseUrl`,
  `detector.modelAssetPath`) for offline use or production.
- Only one person is tracked. Someone walking behind the user can steal tracking.
