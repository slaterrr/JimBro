# AGENTS.md — status board for coding agents

Read this before touching code. Update it in the same PR when a status changes.
Last updated: 2026-11-14 (integration branch `feat/integration-v2`).

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
| Mascot art (blue, round, cartoon "Jim") | 📋 needs a human/design tool; agents can't generate images here |
| Demo data (demo-workouts.json) | ✅ verified, fixture + tests (`apps/expo/src/lib/fixtures`) |

## Rules for agents
- **Never push to `main` or merge PRs without human approval.** Work on a branch off `feat/integration-v2`, open a draft PR.
- Strict TDD: `test(...)` commit that fails for the expected reason → `feat/fix(...)` → refactor. Atomic commits.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- No fabricated benchmarks. Real-video results and simulated results are reported separately. Never edit labels or weaken tests to improve a score; never tune on `split: heldout` clips.
- Privacy: no video is stored or uploaded. Only landmarks stay on the phone; only text context goes to the AI proxy. Never commit participant videos or API keys.
- Wording: never accuse users of cheating; uncertain tracking is the camera's fault.
- Coordinate file ownership when running agents in parallel (see "Hot files").

## How to verify
| What | Command |
|---|---|
| App logic tests | `cd apps/expo && npm ci && npm test` (148 pass on integration-v2) |
| Bundles | `cd apps/expo && npx expo export --platform android` (and `ios`) |
| Vision lab tests (simulator + scoring) | `cd tools/vision-lab && npm ci && npm test` (15 pass) |
| Real-video replay | `cd tools/vision-lab && node run.mjs` (needs Chrome + ffmpeg; videos downloaded per `labels/*.json` `source`) |
| AI proxy tests (SDK mocked) | `cd server/jim-proxy && npm ci && npm test` (15 pass) |

## Feature status

Legend: ✅ done + automated tests · 🧪 done, needs device/real-data validation · 🚧 in progress · 📋 planned · ❌ not doing

| Feature | Status | Where | Tested how | Still needs |
|---|---|---|---|---|
| Four-screen UI (Home, Muscles, Coach, Progress) | ✅ main | `apps/expo/src/screens` | logic tests, web screenshots | — |
| On-phone pose (MediaPipe Lite in WebView) | 🧪 main | `lib/poseHtml.js` | vision-lab uses same model/config | FPS on real phones |
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
| Integration of #21–#26 | ✅ | `feat/integration-v2` | 148 + 15 + 15 tests, Android + iOS bundles, real replay unchanged | merge decision (human) |

## Waiting to be implemented (priority order)
1. 📋 **Device run-through** on a real phone in Expo Go: camera counting, caught-it badge, set report, form review, personas, confirm cards, Talk mode.
2. 📋 **Proxy shared secret** (`X-Jim-Key` header) before exposing the AI proxy beyond LAN.
3. 📋 **Live Claude smoke test** with a real key (not in chat or repo).
4. 📋 Persona wording for remaining Home chat replies (goal intro, confirm/clarify text).
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
