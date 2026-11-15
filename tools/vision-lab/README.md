# Vision lab (dev only)

Replays real workout videos through the **production** pose pipeline and scores the rep counter
against human labels. Never shipped in the app.

```
MP4/WebM → ffmpeg (constant 20 fps) → MediaPipe PoseLandmarker in headless Chrome
        → 2D + 3D world landmarks (cached) → LiveSession/RepCounter (imported from apps/expo)
        → precision / recall / missed / false reps / tracking → HTML report + failure PNGs
```

- **Same model as the app:** `MEDIAPIPE_CDN` and `POSE_MODEL_URL` are imported from
  `apps/expo/src/lib/poseHtml.js` (tasks-vision 1.2.3, pose_landmarker_lite, VIDEO mode, 1 pose).
  The app's `{x, y, visibility}` rounding is applied before replay. `--model full` swaps in Full
  for comparison.
- **Deterministic:** synthetic timestamps (frame i → i·50 ms), CPU delegate, a fresh graph per clip.
  Two cold runs of the same clip give byte-identical landmarks.
- **Fast iteration:** landmarks are cached in `runs/cache`, so changing counter logic replays in
  milliseconds without re-running vision.

## Use
```
npm install                 # puppeteer-core; uses your installed Chrome/Edge (or CHROME_PATH)
node run.mjs                # all labeled clips
node run.mjs --split heldout
node run.mjs --video my.mp4 --movement curl   # unlabeled: predictions + report only
npm test
```
Open `runs/<stamp>/<clip>/report.html`: the video with the predicted skeleton overlaid (purple =
visible, red = low visibility), a live HUD (count, state, tracking, rejection reason, angle) and a
timeline of labeled vs. predicted reps you can click to seek. False reps, missed reps and tracking
loss are saved as annotated PNGs in `failures/`.

## Labels (`labels/<id>.json`)
`video`, `movement` (`curl` | `squat` | `shoulder_press`), `split` (`dev` | `heldout`),
`adversarial` (true when no real rep should count), `reps: [{end_ms}]`, plus `labeling`,
`conditions`, `source`, `license`. A rep's `end_ms` is when the body returns to the rep's start
position, which is the moment the app counts it. Matching is one-to-one within ±600 ms.

Rules: label before looking at predictions; never edit labels to improve a score; keep `heldout`
clips out of tuning. **Videos are never committed** (`videos/` is git-ignored). Record only people
who consented, and download public clips yourself from the `source` URL.

## Limits
Synthetic 3D renders (BlenderProc etc.) are not here yet. Labels are 2D rep timing only, so no
MPJPE: valid 3D error needs mocap-grade ground truth. Inference latency is desktop CPU, not phone.

## Public lunge and push-up clips

Fetch the original videos locally from Wikimedia Commons. Both are CC BY-SA 4.0. The repository tracks the labels and attribution. The videos stay in the ignored `videos/` directory.

```powershell
# From tools/vision-lab
New-Item -ItemType Directory -Force videos | Out-Null
curl.exe -fL https://upload.wikimedia.org/wikipedia/commons/0/02/Forward_lunge_training.webm -o videos/commons_forward_lunge.webm
curl.exe -fL https://upload.wikimedia.org/wikipedia/commons/9/98/Interval_Push-ups.webm -o videos/commons_interval_push_up.webm
node run.mjs --clip commons_forward_lunge
node run.mjs --clip commons_interval_push_up
```

| Clip | Credit | Labeled | Counted | Missed | False |
| --- | --- | ---: | ---: | ---: | ---: |
| [Forward lunge](https://commons.wikimedia.org/wiki/File:Forward_lunge_training.webm) | Skhulile Mthiyane | 6 | 0 | 6 | 0 |
| [Interval push-ups](https://commons.wikimedia.org/wiki/File:Interval_Push-ups.webm) | Taco Fleur | 6 | 6 | 0 | 0 |

Production MediaPipe Lite replay at 20 fps. Both clips are development examples with one AI-assisted labeling pass before replay. The lunge clip includes camera cuts and partial framing. A continuous side-view lunge clip is needed to assess clean capture separately. No analyzer thresholds were changed.
