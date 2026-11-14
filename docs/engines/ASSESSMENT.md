# Vision and coaching engines: technical assessment

This assessment covers the computer vision engine (System A) and the coaching engine (System B)
on `feat/engines`. That branch is stacked on #44 (performance engine), which is stacked on #43
(Workout Mission).

Every claim below comes from reading the code and running its tests. **Real** means checked on
labeled real video; **sim** means simulated landmarks only.

## System A: computer vision
| Area | State | Where | Evidence |
|---|---|---|---|
| Pose estimation | MediaPipe Pose Lite (tasks-vision 1.2.3) in a WebView (phone) or iframe (web); GPU with CPU fallback; 20 fps cap | `lib/poseHtml.js`, `components/PoseView*.js` | Live in Chrome confirmed by the user; **no phone FPS measured** |
| Same logic for live and recorded video | Yes: `LiveSession` is fed by the camera or by `tools/vision-lab` (MP4 → MediaPipe → frames) | `lib/live.js`, `tools/vision-lab` | Real replay is deterministic (142/142 identical frames) |
| Rep counting | Hysteresis state machine on one joint angle per exercise, smoothed, with min rep time and cooldown | `lib/reps.js` | Real: 3/3 reps on 2 clips. Sim: 20/20 per lift |
| Analyzer registry | 8 exercises, each with status, joints, anchor, views, lifting phase and limits | `lib/analyzers.js` | Unit tests |
| Fake-rep guards | Tracking loss, framing (torso in frame), joint speed, arm swing, side lock | `lib/live.js` | Real held-out talking clip: 5 → 0 fake reps |
| Wrong-exercise checks | Lunge in squat mode; curl and press swapped; push-up shape both ways; press or curl in pull-up mode; squat in deadlift mode | `angles.js` shapes + `live.js` latches | Sim: 0/640 lunges counted; 0 other-lift reps |
| Front-view squat | Knee angle from vertical foreshortening, calibrated | `angles.js` | Sim 479/480; **no real front-view clip** |
| Per-rep measurements | Lift/lower/pause ms, ROM (°), speed (°/s), velocity loss, ROM loss, consistency; all relative | `lib/performance.js` | Unit tests |
| Fatigue | Six levels; failed attempt only when observed; no RIR from video | `lib/performance.js` | Unit tests; **not checked on real fatigued sets** |
| Form review | Side-view rules for curl, squat, press with why / fix / cue | `lib/form.js` | Real squat/press clips show no false faults; **no real bad-form clips** |

**Works reliably (real evidence):** curl, squat and shoulder press counting; the fake-rep guards on
talking and gesturing clips; deterministic replay of real video.

**Implemented but not validated:**
- push-up (sim);
- pull-up and deadlift (sim, experimental);
- front-view squat;
- form thresholds;
- the 50° swing threshold;
- fatigue thresholds;
- the effort (RPE) estimate.

**Missing:**
- **Not counted by the camera:** bench, lunge, and the extended library (front squat, row, dips,
  holds, cardio).
- **No equipment detection:** no model in the stack.
- **No calibrated measures:** m/s, displacement, acceleration, force or power.
- **No on-device performance numbers:** FPS, latency, thermals.
- **No multi-person handling** beyond MediaPipe's single-pose output.

**Known bugs and limits found:**
- *Walking in squat mode:* knees bend a little; covered by depth thresholds, but there was no test.
- *Bending over in deadlift mode:* indistinguishable from an unloaded hinge by pose alone. That
  is a limitation, not a bug.
- *Single joint angle per lift:* identity checks are added as separate shape gates, not
  exercise recognition.

## System B: coaching (Jim)
| Area | State | Where | Evidence |
|---|---|---|---|
| Claude proxy | `POST /chat` and `/physique`; model `claude-sonnet-5-5`; tool loop (4 rounds); read tools from an app snapshot; write tools become **proposals** the user confirms; validation; 20 req/min per IP; 30 s timeout, 1 retry; never logs bodies | `server/jim-proxy` | 26 tests, **SDK mocked**. **No live call yet** |
| App to proxy | Privacy-minimal snapshot; re-validates proposals; 12 s timeout; offline fallback to rules | `lib/jimAI.js` | Unit tests |
| Offline coach | Next-set suggestion, five personas, safety short-circuit, set logging by text | `coach.js`, `intents.js`, `personas.js` | Unit tests |
| Plans | Weekly plan by goal, days, minutes and equipment; plan from goal or photo; Workout Mission (time-boxed, explained) | `plans.js`, `planFromGoal.js`, `mission.js` | Unit tests |
| Load recommendation | Six actions, conservative, needs approval, outcome tracked | `recommend.js` | Unit tests |
| Voice | One sound module; persona voices; throttled cues; Talk mode via keyboard dictation | `sound.js`, `speech.js` | **Not heard on a device** |

**Missing:**
- proxy authentication (anyone on the LAN can use it);
- a live smoke test;
- workout-context questions ("what am I training today", "sets left", "make it shorter", "how long
  should I rest", "how has my deadlift progressed", "instead of lat pulldown");
- exercise substitution;
- a profile with equipment and limitations;
- a shared event contract between vision and coach;
- coaching behaviour grounded in the cited trainer research.

## Required from outside
| Need | From whom |
|---|---|
| `ANTHROPIC_API_KEY` for a live Claude check | You (run `npm run smoke` locally; never paste the key in chat) |
| `JIM_PROXY_KEY` shared secret, and its storage in the app | Backend developer |
| Labeled real clips: pull-up, deadlift, push-up, front squat, bad form, fatigued sets, walking or bending negatives | Team (consented participants) |
| Phone FPS and latency runs | Anyone with a phone, using the built-in performance readout |
| Reference device for velocity | Post-hackathon |

## Improvements in this branch (dependency order)
1. Coaching principles from Ćurović and Grecic (2025), used by the proxy prompt and the offline coach.
2. Versioned event contract (`lib/events.js` + `events.d.ts`); a vision adapter that emits events;
   a coach engine that consumes them.
3. Negative-movement tests (walking in squat mode) and fixes where they fail.
4. Camera performance readout: inference ms, effective FPS, dropped frames.
5. Exercise library metadata (muscles, pattern, equipment) and an equipment-aware substitution service.
6. Workout-context answers from real records.
7. Proxy auth (`X-Jim-Key`), principles in the prompt, and `npm run smoke` for a live Claude call.
8. Handoff guides, validation report, limitations, examples, test harness.
