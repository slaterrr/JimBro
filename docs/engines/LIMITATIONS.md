# Known limitations

| Area | Limitation | What would lift it |
|---|---|---|
| Exercise coverage | Camera counts 6 of 19 library exercises. Bench, lunge and the 11 newer exercises are tap-to-log. Pull-up and deadlift are experimental. No isometric holds or cardio yet | An analyzer per exercise, each validated on its own clips (registry entry → sim tests → real clips) |
| Identity | Each lift reads one joint angle, plus shape gates for known confusions (lunge vs squat, curl vs press, push-up, press vs pull-up, squat vs deadlift). It is not general exercise recognition | A small classifier over landmark sequences, trained on licensed, labeled data |
| Bending vs deadlift | An unloaded bend-over looks like a deadlift; pose alone can't tell | Bar or plate detection |
| Views | Curl, press, deadlift, push-up: side view. Pull-up: facing. Squat: side or front (front is sim-tested). Front-on curls are not counted | Per-view analyzers with real clips |
| Multi-person | MediaPipe returns one pose; a second person crossing can take over tracking. The joint-speed and side-lock gates abort the rep, but there is no person ID | Multi-pose with identity tracking |
| Measurements | Relative only (degrees, ms, degrees/s). Phase times depend on threshold crossings (see VALIDATION_REPORT). No m/s, displacement, acceleration, force or power | Calibration object (plate diameter) plus bar tracking; compare against a linear position transducer |
| Fatigue | Uncalibrated thresholds; slowing is one signal, never "failure". No reps-left number from video | Labeled near-failure sets with reported reps left |
| Load advice | Rule-based (≤5% up, ~7.5% down, plate steps). Equipment increments are fixed (2.5 lb / 0.5 kg). No learned personal model | Real accepted-outcome history; per-user increments |
| Performance | No phone measurements yet; MediaPipe runs at 20 fps in a WebView or iframe | Measure with the built-in readout; tune fps, model and delegate per device |
| Voice | Expo Go has no speech-to-text: Talk mode uses keyboard dictation. No barge-in (interrupting Jim mid-sentence) | A dev build with native speech recognition |
| AI | Live-verified: plain reply, history lookup, confirm-first proposals (Actions runs 43642717579, 43646764489); `/physique` not yet run live. The proxy key is a shared secret, not user auth | Put the proxy behind backend user auth |
| Research basis | Coaching principles come from one qualitative study (12 male trainers, Serbia). It guides behaviour; it is not evidence that AI coaching works | User studies |
| Data | 4 real clips. No dataset licences checked yet (see PERFORMANCE_ROADMAP) | Consented recordings; licence review before any dataset is used |
