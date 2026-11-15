# AGENTS.md — status board for coding agents

Read this before touching code. Update it in the same PR when a status changes.
Last updated: 2026-11-14 evening. All PRs are on `main` (#47 engines, #55 = #41 #42 #49 #51 #52 #53); see `docs/AUDIT.md`. **Agentic Jim work: follow `docs/AGENT_SPRINTS.md`.**

## Hackathon constraints (HackPrinceton Fall '26; source: team tracking doc + hacker packet)
- **Devpost deliverables due 8:00 AM Sunday Nov 15.** Hacking started 8 pm Nov 13. Public repo created Nov 13–15 (this repo: 2026-11-13 21:35 ET, public ✅).
- **In-person judging Sun 9:30 AM–2:30 PM**, ≥3 judges, **≤ 2-minute** pitch: problem + walkthrough. Optional ≤ 2-min video (upload before 8 AM). Add Discord usernames to the submission.
- Judging criteria: **Creativity, Utility, Charity, Avidity**.
- Tracks: exactly ONE main track → **Healthcare** ("fitness tracking apps", wellness; prize Apple Watch SE 3). Optional: **Best Rookie Hack**. Auto: Best Overall.
- Sponsor tracks that fit: **Amazon Best Practical AI** (agentic: reason, plan, act, adapt; 25% each creativity/usefulness/tech/UX; needs prototype, use case, docs, pitch) → AI Jim with tools. **Photon** (messaging agent; Best Voice Agent) → possible. LangChain deepagents, Peri (needs a consulted real business, e.g. a local gym trainer with evidence), Hardware (Pi) → only if time.
- Team positioning: "Jimbro is an adaptive AI training system that turns ordinary smartphone video into measurable exercise data, then uses that data to personalize future workloads." Pain point: anxiety about judgement from coaches/public.

## Team requests (tracking doc) → status
| Request | Status |
|---|---|
| Seafoam tint instead of purple | 🚧 agent (feat/team-ui-home) |
| Home subtitle "Your AI gym bro. Tell me what you want to work on today." | 🚧 agent (feat/team-ui-home) |
| Home options → Start a Workout / Create a New Plan / Review My Progress | 🚧 agent (feat/team-ui-home) |
| Bigger arm muscle areas on Muscles page | 🚧 agent (feat/team-ui-home) |
| Rest timer curated per exercise (not a setting) | 🚧 agent (feat/rest-and-compare) |
| Progress: scroll past workouts; workout/month/year strength + volume comparisons | 🚧 agent (feat/rest-and-compare) |
| Leaderboard | 📋 not started (privacy: on-device app; would need opt-in sharing) |
| Supplied Jim mascot on Home and body-blue app theme (#98CCEA) | 🧪 codex/jim-blue-theme; transparent asset, palette contrast checks; device visual check pending |
| Demo data (demo-workouts.json) | ✅ verified, fixture + tests (`apps/expo/src/lib/fixtures`) |

## Rules for agents
Home chat frontend: `codex/agentic-home` integrates existing PR #47 engines with an AppProvider-owned in-memory conversation, retained turns across tabs, serialized sends, stop/new-chat handling, explicit local/offline/AI status and revalidated confirmation cards. See `docs/engines/HOME_CHAT.md`. Live service remains unconfigured: `CLAUD_TOKEN` is a GitHub smoke-test secret, not a deployed proxy URL. No earlier on-device model integration is used.

- **Never push to `main` or merge PRs without human approval.** Work on a branch off `main`, open a draft PR. Full audit: `docs/AUDIT.md`; Devpost draft: `docs/DEVPOST.md`.
- Strict TDD: `test(...)` commit that fails for the expected reason → `feat/fix(...)` → refactor. Atomic commits.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- No fabricated benchmarks. Real-video results and simulated results are reported separately. Never edit labels or weaken tests to improve a score; never tune on `split: heldout` clips.
- Privacy: no video is stored or uploaded. Only landmarks stay on the phone; only text context goes to the AI proxy. **One exception:** a reference physique photo the user picks may go to the proxy's `/physique` route, only after an explicit consent tick, for that single request; it is never stored on the phone or server, never logged, never returned, and no workout data rides along. Photo replies must never judge weight, fat, looks or health. Never commit participant videos, photos or API keys.
- Wording: never accuse users of cheating; uncertain tracking is the camera's fault.
- Coordinate file ownership when running agents in parallel (see "Hot files").

## Opt-in AI plan personalization (branch feat/ai-opt-in-plan-personalization)
- Added `/plan`: a bounded Claude preference pass only on explicit user button press. It can reorder deterministic exercises but cannot change sets, reps, durations or equipment. Home displays the result for separate save confirmation.
- Local plan builder, normal chat/voice, camera analysis, and offline behavior remain unchanged. Backend/frontend tests specify rejection and local fallback.
- This is **not** the complete personal-trainer integration brief; production auth, automatic post-set opt-in, richer voice interaction and mobile validation remain pending.

## How to verify
| What | Command |
|---|---|
| App logic tests | `cd apps/expo && npm ci && npm test` (174 pass on integration-v3) |
| Bundles | `cd apps/expo && npx expo export --platform android` (and `ios`) |
| Vision lab tests (simulator + scoring) | `cd tools/vision-lab && npm ci && npm test` (15 pass) |
| Real-video replay | `cd tools/vision-lab && node run.mjs` (needs Chrome + ffmpeg; videos downloaded per `labels/*.json` `source`) |
| UI smoke (every screen at 320/390px: overlap, clipped, off-screen, covered, invisible labels, tap targets, dropdowns) | `cd apps/expo && npm run test:ui` (needs Chrome; CI job `ui-smoke`, screenshots artifact) |
| User journeys (Playwright: first-run setup, log a set, chat + confirm/cancel, safety, last-workout answer, mission → Coach, plan, Progress tabs/dropdowns, muscles, persona, persistence) | `cd apps/expo && npm run test:e2e` (needs Chrome; runs in CI job `ui-smoke`) |
| AI proxy tests (SDK mocked) | `cd server/jim-proxy && npm ci && npm test` (15 pass) |

## Feature status

Legend: ✅ done + automated tests · 🧪 done, needs device/real-data validation · 🚧 in progress · 📋 planned · ❌ not doing

| Feature | Status | Where | Tested how | Still needs |
|---|---|---|---|---|
| Four-screen UI (Home, Muscles, Coach, Progress) | ✅ main | `apps/expo/src/screens` | logic tests, web screenshots | — |
| Home header shows only Jim's name; persona remains available in settings | 🧪 codex/home-jim-header | `screens/HomeScreen.js` | JSX parse and existing persona/Home checks | device visual check |
| Sets require an active workout; Muscles opens per-exercise progress and instruction sits above body | 🧪 codex/workout-only-muscle-progress | AppState, Muscles/Progress, muscleProgress.js | logging guard and trend unit tests; UI checks | phone validation |
| Seafoam accent theme (`T.accent*`, legacy `T.purple*` aliases), AA contrast | ✅ feat/team-ui-home | `theme.js`, `lib/palette.js` | contrast tests (accent 8.2–9.6:1, accentText 13.4–15.7:1) | device check |
| Home options: Start a Workout (next plan day → Coach), Create a New Plan (goal picker), Review My Progress | 🧪 feat/team-ui-home | `HomeScreen.js`, `lib/homeActions.js` | 4 unit tests, web screenshot | device tap-through |
| Muscles: arm groups fill the arm, invisible tap areas | 🧪 feat/team-ui-home | `components/BodyMap.js` | web screenshot | device tap check |
| On-phone pose (MediaPipe Lite in WebView) | 🧪 main | `lib/poseHtml.js` | vision-lab uses same model/config | FPS on real phones |
| **Engines handoff**: versioned event contract (`events.js`/`.d.ts`), vision engine (live = recorded), coach engine (counts/cues by frequency, after-set fatigue + approved load, answers) | 🧪 feat/engines | `lib/visionEngine.js`, `coachEngine.js`, `events.js`, `docs/engines/` | engine tests incl. all 4 real clips through the API; harness (`npm run harness`) | teammates wire it into screens |
| Coaching principles (Ćurović & Grecic 2025) in the AI prompt and offline behaviour (recovery question, ask experienced users first) | 🧪 feat/engines | `lib/coachingPrinciples.js`, proxy prompt | unit tests | ✅ live call verified (run 43642717579) |
| Workout-context answers (today, sets left, why slower, swaps, progress, shorter, rest) | 🧪 feat/engines | `lib/coachQA.js`, Home chat, `get_workout_context` tool | 13 unit tests; browser check | device |
| 11 tap-to-log exercises + equipment-aware substitutions; push-ups now on the muscle map | 🧪 feat/engines | `exercises.js`, `muscles.js`, `substitute.js` | unit tests | — |
| Proxy hardening: `X-Jim-Key`, max_tokens 2048 + effort low (Sonnet 5.5 thinks by default), refusal/cut-off handling, fallbacks, `npm run smoke` | 🧪 feat/engines | `server/jim-proxy` | 33 tests (SDK mocked) | ✅ live PASS via `claude-smoke.yml` + `CLAUD_TOKEN`: plain reply, history lookup, confirm-first proposal; `/physique` not run live |
| Camera speed readout (fps, inference ms) measured on the device | 🧪 feat/engines | `poseHtml.js`, `cameraPerf.js`, Coach footer | unit tests | **measure on phones** |
| **Validation system**: `npm run validate` (engine-API scoring, landmark reliability, `--cross` wrong-mode runs, real/sim apart), `npm run record` (consented landmark recorder, Space = rep end), `npm run bench` | 🧪 feat/engines | `tools/vision-lab` | 51 tests; real: 3/3 reps, 0 FP, 24 wrong-mode runs 0 FP | **record real clips** |
| Lunge counting (experimental, side view, lead leg per rep) | 🧪 feat/engines | `live.js`, `reps.js` | sim 8/8 all settings; real squat in lunge mode 0 | real lunge clips |
| Angle-trace speed (peak/mean °/s) + metric trust classes; measured vs reported effort in recommendations; measured speed in Claude's context | 🧪 feat/engines | `live.js`, `performance.js`, `recommend.js`, `jimAI.js` | unit tests; real squat 103°/s vs 548°/s old formula; **live Claude cited real-clip measurements** | calibrate on real fatigued sets |
| Equipment tracking interface + plate calibration (no detector ships) | 🧪 feat/engines | `lib/equipment.js`, `docs/engines/EQUIPMENT_DETECTION.md` | synthetic-detection tests | label data; fine-tune EfficientDet-Lite |
| Analyzer registry: every exercise declares camera status (real-tested / sim-tested / experimental / manual + reason) | 🧪 feat/performance-engine | `lib/analyzers.js` | registry tests; existing 4 lifts unchanged | — |
| Pull-up (front) and deadlift (side) camera counting, **experimental** | 🧪 feat/performance-engine | `reps.js`, `live.js` gates | **sim only**: exact counts, 0 counts from presses/curls/squats/waving/half reps | real clips before calling them tested |
| Relative per-rep metrics + six-level fatigue check (no m/s, no RIR from video) | 🧪 feat/performance-engine | `lib/performance.js` | unit tests | real slow-vs-fatigued clips |
| Next-set recommendation with approval (Use it / Keep plan), stored with outcome | 🧪 feat/performance-engine | `lib/recommend.js`, Mission, Log a set | unit tests; browser run-through | device check; 5+ real outcomes before claiming anything |
| Performance voice/chat lines from recorded data | 🧪 feat/performance-engine | `lib/perfCoach.js`, Coach, Home | unit tests; browser chat | device audio |
| Camera counting in a laptop browser (Expo web): same pose page in an iframe, `postMessage` bridge; screens fit 320 px to desktop (centered 560 px column) | 🧪 feat/workout-mission | `components/PoseView.web.js`, `lib/poseBridge.js`, `lib/layout.js` | unit + wiring tests; user confirmed live camera works in Chrome; layout checked at 5 sizes | Safari/Firefox; notch/safe areas on devices |
| Rep counter (curl, squat, press) | ✅ | `lib/reps.js`, `lib/live.js` | unit + 20-rep simulated sets 20/20 all lifts; real video 3/3 TP, 0 FP | real 15–20-rep phone clips |
| Anti-false-rep guards: exercise-aware visibility, side lock, abort on tracking loss, curl arm-swing | ✅ PR #18 | `lib/live.js`, `lib/angles.js` | unit tests | 50° swing threshold on real video |
| Joint-speed gate (hallucinated joints) | ✅ PR #20 | `lib/live.js` `jointSpeed` | sim: 8 → 0 fake reps; fast 1.1 s reps still 20/20 | very explosive real reps |
| Torso-in-frame gate (gesturing counted as curls) | ✅ PR #20 | `lib/live.js` `torsoInFrame` | real video: dev 2 → 0, **held-out 5 → 0** | users standing very close |
| Vision lab: MP4 → MediaPipe → counter → report, failure PNGs | ✅ PR #19 | `tools/vision-lab` | deterministic (142/142 identical frames) | more labeled clips, held-out set growth |
| Landmark simulator (seeded) | ✅ PR #20 | `tools/vision-lab/lib/simulate.mjs` | tests | front-view geometry, middle-finger scenario |
| Set report (counted, not counted + reasons, rep times, tempo, RPE, tracking %, evidence-backed tips) | ✅ PR #20 | `lib/sessionReport.js`, `SetReportCard` | unit tests | device check |
| Jim speaks the report | 🧪 PR #21 | `lib/speech.js` | unit tests | device audio |
| "Caught it" badge + spoken "Not counted — reason" | 🧪 PR #21 | `live.js` `blocked`, CoachScreen | unit tests | device check; demo rehearsal |
| Talk to Jim to log / correct / delete sets (confirm first) | 🧪 PR #22 | `lib/intents.js`, HomeScreen | 16 unit tests | device check; "my 2nd set yesterday" not supported |
| Goals (strength, consistency, volume, camera-verified reps), plan adherence, weekly check-in | 🧪 PR #23 | `lib/goals.js`, ProgressScreen Goals tab | 15 unit tests | device check; date picker; tab width on small phones |
| Five personas with roles (Coach, Hype, Sergeant, Zen, Data) driving all wording + voice | 🧪 PR #24 + integration | `lib/personas.js`, `coach.js`, `cues.js`, `speech.js`, `PersonaPicker` | tests: same numbers, different wording, no shaming | device voice pitch/rate |
| Form review clips (skeleton replay vs ideal, why / fix / cue, "How to do it") | 🧪 PR #25 | `lib/form.js`, `FormReview.js` | sim fixtures; real squat/press reps → no false faults | **real bad-form clips** to validate thresholds |
| Real AI Jim (Claude via proxy, tools, proposals → confirm cards, offline fallback, Talk mode) | 🧪 PR #26 | `server/jim-proxy`, `lib/jimAI.js`, HomeScreen | 13 app + 15 proxy tests (SDK mocked) | **live API smoke test** (needs `ANTHROPIC_API_KEY`); proxy auth secret |
| Rest timer curated per exercise (lift, reps, RPE) with reason shown; rest setting removed | 🧪 feat/rest-and-compare | `lib/rest.js`, `Sheets.js` RestTimer | 6 unit tests | device check |
| Progress History tab: full list, workout-to-workout, month/year comparisons | 🧪 feat/rest-and-compare | `lib/compare.js`, ProgressScreen History tab | 8 unit tests on demo fixture (hand-computed) | device check; 6 tabs on small phones; bodyweight lifts have no volume/e1RM |
| First-run Beginner / Comeback setup (3 questions → Zen persona, starter plan, consistency goal; pain → safety text, no plan), re-open from bell | 🧪 feat/beginner-health | `lib/onboarding.js`, `components/Onboarding.js`, `App.jsx` | 7 unit tests + wiring checks, web screenshot | device tap-through |
| Home weekly health card (sessions · camera-verified reps · consistency x/y · next step) → Progress | 🧪 feat/beginner-health | `lib/healthSummary.js`, `HomeScreen.js` | 5 unit tests on demo fixture (hand-computed) | device check |
| Integration of #21–#26 | ✅ | `feat/integration-v2` | 148 + 15 + 15 tests, Android + iOS bundles, real replay unchanged | merge decision (human) |

| Login: email + password sign up / sign in, no email confirmation; on-device accounts (salted SHA-256, never the password), per-account data, sign out in settings | 🧪 feat/login | `lib/auth.js`, `components/Login.js`, `App.jsx` | 7 unit + 3 Playwright journeys | device check; accounts are per phone (no server sync) |

## Latest fixes and features (integration-v4)
| Feature | Status | Where | Tested how | Still needs |
|---|---|---|---|---|
| Sound: voice on by default, iOS silent mode, one sound module | 🧪 #30 | `lib/sound.js`, AppState | 7 unit + wiring checks | hear it on iPhone with ringer on silent |
| Front-facing squats counted | 🧪 #31 | `angles.js` `frontalKneeAngle` | sim sweep 479/480, 40/40 exact; real clips unchanged | a real front-squat clip |
| Never-silent camera guidance (names missing body part, spoken, 8 s throttle) | 🧪 #31 | `lib/guidance.js`, CoachScreen | unit tests | device |
| Lunge in squat mode detected, not counted | 🧪 #31 | `lowerBodyShape`, live.js latch | sweep: 0/640 lunges counted, 80/80 detected; real squat 2/2 | a real lunge clip |
| Curl ↔ press switch detected | 🧪 #34 | `armShape`, live.js | sweep: 0 other-lift reps, 20/20 detected per cell; wave stays arm_swing; real clips unchanged | real curl/press clips; front-on curls can't be counted |
| Switch suggestion card + lunge as manual exercise | 🧪 #32 | `lib/switchExercise.js`, CoachScreen, exercises.js | unit + wiring | card position on device |
| Beginner/comeback first-run setup (pain → safety, no plan) | 🧪 #33 | `lib/onboarding.js`, `Onboarding.js` | unit + wiring | device |
| Weekly health card on Home | 🧪 #33 | `lib/healthSummary.js` | unit (demo fixture, hand-computed) | device with data |
| Setup asks main fitness goal (strength/muscle/endurance/fat_loss/general) + "what do you want to look like" (optional text + focus muscles); saved to settings, old saves → 'general' | 🧪 feat/goal-rest | `lib/fitnessGoal.js`, `lib/onboarding.js`, `Onboarding.js`, `AppState.js` | unit (every goal, migration, onboarding results) + wiring | device tap-through; look/focus muscles not yet used by plans or AI Jim |
| Rest personalized by goal (strength 3:00 heavy, muscle 60–120 s, endurance 30–60 s, fat loss short, general = per-exercise rules) + RPE, beginner/sedentary +15 s, reason shown | 🧪 feat/goal-rest | `lib/rest.js`, `Sheets.js` | unit per goal | device check |
| Activity level estimate from health history (Tudor-Locke steps, WHO 150 min/wk; confidence; never shames) → `settings.activityLevel` | 🧪 feat/health-activity | `lib/activityLevel.js`, `components/HealthConnect.js`, Progress › Goals card | 20 unit tests (bands, gaps, outliers, <7 days) | device check; nothing reads the level yet |
| Health import: Apple Health `export.xml` (streamed, 1 MB chunks) + CSV in Expo Go; native HealthKit / Health Connect adapter | 🧪 feat/health-activity | `lib/healthData.js` | 5 unit tests on fake fixture | big real export on a phone; native path **needs a dev build** (`registerNativeHealth`), not in Expo Go; `.zip` must be unzipped first |
| Push-ups: camera-counted, per-rep type (standard / knee / incline) from body line; upright elbow bends not counted; push-up ↔ other-lift exercise_change + suggestion | 🧪 feat/pushup-variants | `angles.js` `pushupShape`, `live.js`, `reps.js` `PUSH_UP`, CoachScreen | **sim only**: 480/480 per variant, 0 mislabels (20 seeds × 2 noise); upright bends 0 FP / 80 sets; push-ups in curl/squat/press 0 counted, 40/40 suggested; real clips unchanged | a real knee + standard push-up clip; front-view push-ups not handled |
| Effort estimate (RPE / RIR) from velocity loss + ROM decay, labelled estimate, in set report + Coach screen | 🧪 feat/pushup-variants | `lib/effort.js`, `sessionReport.js` | 8 unit tests | uncalibrated bands; validate against user-entered RPE |
| Import past workouts from CSV / Excel (.xlsx): tolerant headers, catalog matching, skipped rows listed, preview → Confirm | 🧪 feat/import-plan | `lib/importWorkouts.js`, `components/ImportSheet.js` | 14 unit tests (messy CSV + generated xlsx fixtures) | device file picker (iOS Files / Android) |
| Plan toward a physique photo (consent → `/physique` → muscle emphasis → plan confirm card); offline rule plan from `fitnessGoal` + `focusMuscles` + history | 🧪 feat/import-plan | `server/jim-proxy/physique.js`, `lib/jimAI.js` `askPhysique`, `lib/planFromGoal.js` | 11 proxy (SDK mocked) + 16 app unit tests | **live API smoke test with a real photo**; device image picker |
| Shared live camera summary between Coach and Jim | 🧪 codex/shared-session-context | `AppState.js` live camera context, `CoachScreen.js` publisher, `HomeScreen.js` request context, `lib/jimAI.js` whitelist | 3 tests for active session, freshness, and privacy; 413 pass across 31 Expo test files; `importWorkouts.test.js` cannot load because `fflate` is not installed here | real-phone navigation and latency smoke test; verify deployment target before release |
| Real-clip landmark regressions in `npm test`; vision-lab + proxy suites in CI | ✅ #31 | `tools/vision-lab/fixtures`, ci.yml | 4 real clips | more clips |
| **Workout Mission**: "I have 20 minutes, help me finish chest day" → on-phone plan from history + goal (time-boxed, every choice explained) → confirm card → hands-free run on Coach (auto-start when tracked, auto-end set, quick RPE check that saves itself, rest with next-set adjustment, switch to a camera-counted lift, skip/end) → summary checked against the plan | 🧪 feat/workout-mission | `lib/mission.js`, `components/Mission.js`, HomeScreen chips + intercept, CoachScreen, AppState `mission` | 15 unit tests (parse, plan budget/progression/rested area, state machine, summary, weight pick, camera swap); iOS bundle; simulator tap-through of the tap-counted path (no camera in simulator) | camera-counted path on a real phone; spoken lines on device |

Test counts on integration-v4: app 256, vision-lab 35, proxy 15. On integration-v5 (#35–#38): app 377, vision-lab 44, proxy 26; Android + iOS bundles build; real clips unchanged. On feat/workout-mission: app 402. On feat/performance-engine: app 470, vision-lab 44. On feat/engines: app 544, vision-lab 51, proxy 33 (628); handoff docs in `docs/engines/`. Roadmap for equipment tracking, force/power and validation: `docs/PERFORMANCE_ROADMAP.md`. On main after #55: app 558, vision-lab 51, proxy 35.

## Waiting to be implemented (priority order)
1. 📋 **Device run-through** on a real phone in Expo Go: camera counting, caught-it badge, set report, form review, personas, confirm cards, Talk mode.
2. ✅ **Proxy shared secret** (`X-Jim-Key`, #47). Host it with `render.yaml` (Render blueprint), then set `EXPO_PUBLIC_JIM_PROXY_URL` / `EXPO_PUBLIC_JIM_PROXY_KEY` in the Expo `preview` environment.
3. ✅ **Live Claude smoke test**: `.github/workflows/claude-smoke.yml` (repo secret `CLAUD_TOKEN`).
4. ✅ Persona wording for Home chat replies (`lib/homeReplies.js`; confirm-card questions stay neutral).
5. 📋 Record + label team clips (consented): 15–20-rep sets per lift side-on; wave; middle finger; elbow-swing curls; shallow squats. Put half in `heldout`.
6. 📋 Validate form thresholds and the 50° swing on those clips; press lean-back direction.
7. 📋 2-minute demo script + backup screen recording.
8. ❌ BlenderProc 3D renders, MPJPE (no 3D ground truth): post-hackathon.

## Known limitations (be honest in demos)
- Labeled real data is small (3 real reps, 2 adversarial clips); 20-rep evidence is simulated.
- Expo Go has no speech-to-text; Talk mode uses keyboard dictation.
- Form rules are side-view heuristics on landmarks, not medical advice.
- Latency numbers are desktop CPU, not phone.

## Hot files (edit carefully; often touched in parallel)
`apps/expo/src/AppState.js`, `screens/HomeScreen.js`, `screens/CoachScreen.js`, `components/Sheets.js`, `lib/live.js`.

## PR map
#18 camera guards → #19 vision lab → #20 report + sim + 2 fixes → #21 speech + caught-it, #22 Jim edits, #23 goals → `feat/integration` → #24 personas, #25 form review, #26 AI Jim → `feat/integration-v2`.

## Shared preview delivery
EAS project `@slaterr/jimbro` is linked. Main CI publishes to `preview` after all quality jobs pass, once the repository `expo_access_token` secret exists. README has a persistent preview-page QR. First preview builds/signing and device acceptance remain required. Config: `apps/expo/eas.json`, `apps/expo/app.json`, `.github/workflows/ci.yml`.

## Progression date navigation
Workouts retain unique IDs and full ISO timestamps; AppState normalizes completed history oldest-first on hydration, import and finish. Future database storage should query by timestamp plus ID, never use display dates as keys. Comparison dropdowns show date-only labels with Session 1/2 for same-day workouts. Progression tabs are Overview/Strength/History/Goals; Volume and PR cards open existing detail views with a return action. Settings header now reserves space for its gear beside Talk.
