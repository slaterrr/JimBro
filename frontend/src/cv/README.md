# Jim Bro CV module: squat tracking

In-browser squat tracking with MediaPipe Pose Landmarker. Video never leaves the
device. Squats only for now. Other exercises wait until squat tracking is proven
reliable on real users.

## Quick start (frontend)

```tsx
import { useRef } from "react";
import { useSquatTracker } from "./cv";

function LiveWorkout() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useSquatTracker(videoRef, canvasRef);

  return (
    <>
      <div className="relative aspect-video">
        {/* Mirror both or neither */}
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain -scale-x-100" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain -scale-x-100" />
      </div>
      <p>{t.repCount} reps · {t.phase}</p>
      {t.error && <p>{t.error.message}</p>}
      <button onClick={t.start}>Start</button>
      <button onClick={t.pause}>Pause</button>
      <button onClick={() => saveSession(t.stop())}>End</button>
    </>
  );
}
```

Outside React, use `new SquatTracker(video, canvas, options)` directly: same API.

Test bench: `npm run dev` in `frontend/`, then open http://localhost:5173/cv-demo.html.

## Interface

| Member | What it is |
|---|---|
| `status` | `idle` → `starting-camera` → `loading-model` → `tracking` ⇄ `paused` → `stopped`, or `error` |
| `error` | `{ code, message }`. Codes: `PERMISSION_DENIED`, `NO_CAMERA`, `CAMERA_IN_USE`, `INSECURE_CONTEXT`, `NOT_SUPPORTED`, `STREAM_ENDED`, `MODEL_LOAD_FAILED`, `UNKNOWN`. `message` is user-ready. |
| `phase` | `standing` / `descending` / `bottom` / `ascending` |
| `armed` | `false` until the user stands up straight in frame. Show "Stand up straight to start". |
| `repCount`, `lastRep` | Counted reps only. `lastRep` is a shared `RepEvent`. |
| `lastRejection` | `FormFlag` explaining why the last attempt didn't count (shallow, too fast, too slow, tracking lost) |
| `liveAngles` | `{ knee, hip }` smoothed degrees, or `null` when not visible |
| `landmarksVisible`, `activeSide` | Whether the counting leg is visible, and which leg is used |
| `cameraView`, `viewWarning` | Side-on check (estimated) and a `CAMERA_NOT_SIDE_ON` flag when the user faces the camera |
| `start()`, `pause()`, `resume()` | Pausing keeps the camera on and discards a half-finished rep |
| `stop()` | Ends the session, stops the camera, returns a shared `WorkoutSession` ready to POST |
| `onRep(cb)`, `onRejected(cb)` | Immediate events (use in `useEffect`, return value unsubscribes) |

State updates are throttled to 10 Hz (`uiUpdateHz`). The skeleton is drawn on the
canvas directly, so it never triggers a React render.

## Voice coaching

`VoiceCoach` speaks cues using the browser's built-in speech (Web Speech API).
It works offline and needs no API key.

```ts
const coach = new VoiceCoach(tracker);   // or { enabled, rate, lang, setupInstructions }
startButton.onclick = () => { coach.attach(); tracker.start(); }; // must start from a click
coach.setEnabled(false);                  // mute toggle
coach.announceSession(tracker.stop());    // "Nice work. 8 reps."
```

| When | It says |
|---|---|
| Tracking starts | Setup: side-on, 2–3 m back, whole body in view, stand up tall |
| Legs out of view > 2.5 s | "Step back so I can see your hips, knees and ankles." |
| Visible but not standing yet | "Stand up tall to begin.", then "Ready. Start squatting." |
| Rep counted | The rep number (interrupts any other speech) |
| Fast descent (measured) | "Slow down on the way down." |
| Rep not counted | "Not counted. Go a little lower." / "Too quick." / etc. |
| Facing the camera (estimated) | "Turn side on to the camera." |
| Camera error | The error message |
| Pause / resume / end | "Paused." / "Resuming." / summary |

Each cue has an 8 s cooldown so it doesn't nag. Consistency flags
(`UNEVEN_TEMPO`, `DEPTH_VARIES`) are shown on screen but not spoken mid-set.
If the browser has no speech support, `coach.supported` is `false` and every
call does nothing.

## How counting works

1. **Landmarks → angles.** The leg with higher landmark visibility is used, with
   a margin so the choice doesn't flicker. Knee = hip–knee–ankle, hip =
   shoulder–hip–knee, corrected for the video's aspect ratio. Joints below
   `minVisibility` (default 0.6) give `null`, never a guess.
2. **Smoothing.** EMA (`smoothingAlpha` 0.5) removes jitter. It resets when
   tracking drops, so stale values are never blended in.
3. **State machine** (`rep_counter.ts`), default thresholds:

   | | |
   |---|---|
   | standing | knee ≥ 160° |
   | descent starts | knee < 150° (10° dead band prevents flicker) |
   | depth reached | knee ≤ 100° |
   | ascent starts | knee > 108° (8° hysteresis) |
   | rep complete | back to ≥ 160° after reaching depth |

   **Hip drop:** depth also requires the hips to drop at least 30% of standing
   leg length (`minHipDrop`). The baseline (standing hip height and hip→ankle
   length) is learned while the user stands straight. This stops a bent knee
   on its own from counting, for example the raised leg when standing on one
   foot, or a knee angle misread on a small dip (`NO_HIP_DROP`). If hip height
   can't be measured, counting falls back to the knee angle alone.

   **Not counted:** descents that never reach depth (reported as `SHALLOW_DEPTH`
   if they went below 135°), reps under 0.6 s (`TOO_FAST`) or over 12 s
   (`TOO_SLOW`), and reps where the legs were out of view for more than 0.7 s
   (`TRACKING_LOST`). Nothing counts until the user has been seen standing, so
   starting mid-squat can't create a phantom rep.

4. **Timing.** Rep duration runs from crossing 150° on the way down to 160° on
   the way up, so the near-straight top of the movement isn't included. Phases
   (descent, bottom, ascent) come from the same threshold crossings.

All thresholds are options (`counter: { depthAngle: 95, ... }`).

## Measured vs estimated

| Metric | Label | Why |
|---|---|---|
| Hip drop (% of standing leg length) | **measured** | Vertical hip movement against the standing baseline, side-on |
| Rep count, rep and phase durations | **measured** | Threshold crossings of the observed knee angle, timestamped |
| Knee / hip angle, bottom knee angle | **measured** | Read from the image. Accurate only when side-on, which is why the view check exists |
| `FAST_DESCENT` flag (< 400 ms) | **measured** | From the timed descent |
| Tempo consistency (CV of rep time, %) | **estimated** | Depends on tracking quality and threshold placement. Confidence scales with rep count and fraction of frames tracked |
| Depth consistency (SD of bottom angle, °) | **estimated** | Same |
| `UNEVEN_TEMPO`, `DEPTH_VARIES` flags | **estimated** | Comparisons against the session median, after 3 reps |
| Camera view (side / front) | **estimated** | Heuristic from shoulder spread vs torso length |

**Not claimed (never reported):** knee valgus / knees caving in, back rounding or
spinal position, weight distribution, bar path, load. A single camera can't see
these reliably, and a side view can't see valgus at all.

"Depth reached" means the projected knee angle crossed the threshold. It is not
an anatomical "hip crease below knee" judgement.

## Camera setup to tell users

- Side-on to the camera, 2–3 m away, phone at about hip height
- Whole body in frame, hips, knees and ankles in particular
- Decent lighting, nothing between the user and the camera

## Files

| File | Responsibility |
|---|---|
| `pose_detection.ts` | Camera, model loading (GPU → CPU fallback), detection loop, landmark extraction, overlay drawing |
| `angle_calculator.ts` | `calculateAngle`, `calculateAngle3D`, `AngleSmoother` |
| `rep_counter.ts` | `SquatRepCounter` state machine |
| `form_analyzer.ts` | Rep flags, session summary, camera-view check |
| `squat_tracker.ts` | `SquatTracker`, which wires it all together (the public interface) |
| `useSquatTracker.ts` | React hook |
| `voice_coach.ts` | `VoiceCoach`: spoken instructions, rep counts and cues |
| `index.ts` | Public exports. Import from here only. |

## Known limitations

- Thresholds are tuned on synthetic data and need checking against real
  recorded squats from several people and camera heights.
- The model (`pose_landmarker_lite`, ~6 s first load) and WASM are fetched from
  Google's and jsDelivr's CDNs. Self-host them (`detector.wasmBaseUrl`,
  `detector.modelAssetPath`) for offline use or production.
- Only one person is tracked. Someone walking behind the user can steal tracking.
- Very deep or very shallow lifters may need `depthAngle` adjusted.
- Single-leg squats (pistols) are not supported; they may be rejected as `NO_HIP_DROP` or counted unreliably.
