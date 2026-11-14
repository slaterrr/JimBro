# Frontend guide: using the engines

You don't need MediaPipe knowledge. The camera page produces frames, the vision engine turns them
into events, and the coach engine turns those into things to show or say.

## 1. Camera view
Render `PoseView` (from `components/PoseView`, **no file extension**). Metro then picks the WebView
on phones and the iframe on web.

```jsx
import { PoseView } from '../components/PoseView';
import { poseHtml } from '../lib/poseHtml';

const html = useMemo(() => poseHtml({ facing: 'user' }), []);
<PoseView ref={web} html={html} onMessage={onMessage} />
```

`onMessage(e)` receives `e.nativeEvent.data`, a JSON string with one of these types:
- `ready`: the model loaded.
- `frame`: `{ t, pose }`, where pose is 33 landmarks or null.
- `perf`: `{ fps, inferenceMs, p95Ms, droppedPct }`, every 2 s.
- `error`: `{ kind: 'camera' | 'model', message }`.

Switch cameras with `web.current.postMessage(JSON.stringify({ type: 'facing', facing: 'environment' }))`.

## 2. Start a session for the selected exercise
```js
import { analyzerFor, cameraLabel, countsWithCamera } from '../lib/analyzers';
import { createVisionSession } from '../lib/visionEngine';
import { createCoach } from '../lib/coachEngine';

if (!countsWithCamera(exerciseId)) {
  // Manual exercise: show analyzerFor(exerciseId).reason and the tap-to-log UI.
}
const coach = createCoach({ sessionId, frequency: 'normal', onEvent: showOrSay }); // 'off' | 'minimal' | 'normal'
const vision = createVisionSession({ exerciseId, sessionId, onEvent: (e) => { coach.handle(e); render(e); } });

function onMessage(e) {
  const m = JSON.parse(e.nativeEvent.data);
  if (m.type === 'frame') vision.frame(m.t, m.pose); // returns a snapshot (count, tracking) for overlays
}
```

## 3. End a set
```js
vision.finishSet({ target: 8 });  // emits FormObservation*, SetCompleted, PerformanceMeasurement
const { rec } = coach.completeSet({ weight: 135, unit: 'lb', rir: 2, history, setNo: 1, sets: 3 });
// Show rec.reasons with "Use it" / "Keep plan". Apply rec.weight / rec.reps / rec.extraRestS
// only after "Use it".
```
Ask "How many more could you have done?" (0–4+) and pass the answer as `rir`. Never pre-fill it
from video.

## 4. Show uncertainty
| Signal | Show |
|---|---|
| `event.validation === 'experimental'` or `cameraLabel(id)` | An "Experimental" tag beside the count (pull-up, deadlift) |
| `TrackingStatus` ≠ ok | `data.guidance` (it names the body part to bring into frame) |
| `RepRejected` | A "Caught it" badge with `data.words`; never blame the user |
| `ExerciseMismatch` | `data.guidance` plus a switch suggestion for `data.observed` |
| `PerformanceMeasurement.calibrated === false` | Label numbers "relative" (degrees, ms), never m/s |
| `FatigueAssessment.level === 'uncertain'` | Ask the user how it felt instead of showing a verdict |

## 5. Questions in text or speech
```js
const r = coach.ask(text, { history, active, plan, settings, profile });
if (r) show(r.data.text); else askJim({ message: text, ... }); // the AI proxy, with offline fallback
```
`coach.ask` answers these from records:
- last set, should I go heavier, are your suggestions working;
- today's workout, sets left, why reps slowed;
- what to do instead of an exercise, how a lift has progressed;
- make it shorter, how long to rest.

Voice: speak `CoachResponse` events with `data.speak === true` through `lib/sound.js`
(`voice.say` / `voice.cue`). During a set, only counts and cues are spoken, each cue once per set.

## 6. Cleanup
Unmount `PoseView`; the web iframe receives `stop` and releases the camera. Drop the vision and
coach objects; they hold no timers.

## Offline recorded video
```js
import { analyzeRecording } from '../lib/visionEngine';

analyzeRecording(frames, { exerciseId });
```
`frames` is `[{ t, pose }]` from the vision lab's MP4 extraction. It returns the same events as live.
