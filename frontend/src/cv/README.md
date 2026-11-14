# Jim Bro CV module: exercise tracking

In-browser rep counting with MediaPipe Pose Landmarker. Video never leaves the
device. Supported exercises: **squat, push-up, bicep curl, shoulder press**.

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

Test bench: `npm run dev` in `frontend/`, then open http://localhost:5173/cv-demo.html.

## Interface

| Member | What it is |
|---|---|
| `status` | `idle` → `starting-camera` → `loading-model` → `tracking` ⇄ `paused` → `stopped`, or `error` |
| `error` | `{ code, message }`. Codes: `PERMISSION_DENIED`, `NO_CAMERA`, `CAMERA_IN_USE`, `INSECURE_CONTEXT`, `NOT_SUPPORTED`, `STREAM_ENDED`, `MODEL_LOAD_FAILED`, `UNKNOWN`. `message` is user-ready. |
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

| | Squat | Push-up | Bicep curl | Shoulder press |
|---|---|---|---|---|
| Camera | Side-on, 2–3 m, whole body | Side-on, at floor level, ~2 m, whole body | Side-on, curling arm nearest the camera | Facing the camera, ~2 m, head to hips |
| Counting angle | Knee (hip–knee–ankle), better-seen leg | Elbow (shoulder–elbow–wrist), better-seen arm | Elbow, arm nearest the camera | Elbow, **both** arms (the lagging arm decides) |
| Start position | Knee ≥ 160° (standing) | Elbow ≥ 150° (top of plank) | Elbow ≥ 145° (arm hanging) | Elbow ≤ 100° (weights at shoulders) |
| Full range | Knee ≤ 85° | Elbow ≤ 90° | Elbow ≤ 65° | Elbow ≥ 155° |
| Progress check | Hips drop ≥ 40% of leg length | Shoulders drop ≥ 30% of arm length | none | Hands ≥ 70% of arm length above shoulders |
| Position gate | none | Body within 40° of horizontal | none | Both arms visible |
| Form flags (measured) | Fast descent | Hips sagging / piked (shoulder–hip–ankle < 160°), fast lowering | Elbow drifting forward (> 35°), body swing (torso lean changes > 15°), fast lowering | Uneven arms (> 25° apart), fast lowering |

Rough angle guides (side-on): half squat ≈ 100–110°, parallel ≈ 60–75°; half
push-up ≈ 110–120°; half curl ≈ 90–100°; press lockout ≈ 160–175°.

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
2. **Smoothing.** EMA (`smoothingAlpha` 0.5), reset when tracking drops.
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
| Exercise form flags in the table above, fast lowering | **measured** | From observed angles and timings |
| Tempo consistency (CV of rep time, %) | **estimated** | Depends on tracking quality. Confidence scales with rep count and fraction of frames tracked |
| Range consistency (SD of peak angle, °) | **estimated** | Same |
| `UNEVEN_TEMPO`, `RANGE_VARIES` flags | **estimated** | Comparisons against the session median, after 3 reps |
| Camera view (side / front) | **estimated** | Heuristic from shoulder spread vs torso length; only when upright |

**Not claimed (never reported):** knee valgus, back rounding or spinal position,
weight distribution, bar path, load, grip, wrist angle, shoulder-blade movement.

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
didn't count; at most one measured form tip per rep; the position hint or "I
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
| `form_analyzer.ts` | Generic rep flags, session summary, camera-view check |
| `pose_detection.ts` | Camera, model loading (GPU → CPU fallback), detection loop, side picking, overlay drawing |
| `angle_calculator.ts` | `calculateAngle`, `calculateAngle3D`, `AngleSmoother` |
| `voice_coach.ts` | `VoiceCoach` |
| `index.ts` | Public exports. Import from here only. |

## Known limitations

- Squat thresholds were tuned on a real camera; push-up, curl and press
  thresholds come from geometry and synthetic tests and need checking on real
  users. The test bench sliders make that quick.
- Bicep curls from the side count only the arm nearest the camera. Alternating
  curls need two sets, one facing each way.
- Single-leg squats (pistols) and other variations are not supported.
- The model (`pose_landmarker_lite`, ~6 s first load) and WASM come from
  Google's and jsDelivr's CDNs. Self-host them (`detector.wasmBaseUrl`,
  `detector.modelAssetPath`) for offline use or production.
- Only one person is tracked. Someone walking behind the user can steal tracking.
