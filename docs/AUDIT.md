# JimBro feature audit

As of 2026-11-14 night. `main` = everything (consolidated in #39). CI on main: backend-quality, mobile-quality, expo-quality all green.
Tests on main: app 380, vision lab 44, AI proxy 26. Android + iOS bundles build.

Legend: ✅ done + automated tests · 🧪 built + tested in code, **not yet checked on a real phone** · 🟡 partly done · 📋 not started · ❌ not doing for the hackathon

## 1. Done (works, automated tests)
| Feature | Evidence |
|---|---|
| Four screens: Home, Muscles, Coach, Progress; seafoam theme; team Home options | logic + contrast tests, web screenshots |
| Camera rep counting (curl, squat, shoulder press) on the phone, no video stored | real video 3/3 reps, 0 fake reps on 2 talking clips (incl. held-out) |
| False-rep guards: tracking loss, framing, joint-speed, arm swing | real held-out clip 5 → 0 fake reps |
| Vision lab: replays real MP4s through the production model and scores them; real-clip landmarks in CI | 4 real clips in `npm test` |
| Set report: counted / not counted + reasons, tempo, tracking % | unit tests |
| Demo data (team's 14 fictional workouts) | fixture + tests |

## 2. Built, needs a phone run-through (🧪)
| Feature | What to check on the phone |
|---|---|
| Sound: voice on by default, plays with iPhone on silent | hear Jim with the ringer off |
| Jim speaks the report; "caught it" badge for blocked reps | tap Hear report; do a half rep |
| Front-facing squats counted; camera guidance names the body part out of view | squat facing the phone; step too close |
| Lunge / curl↔press / push-up exercise-change detection + "Switch?" card | switch exercise mid-set |
| **Push-ups with rep type (standard / knee / incline)** | knee push-ups side-on → "knee push-ups" in report |
| **Effort estimate (RPE / reps in reserve)**, labelled estimate | finish a 8+ rep set |
| Personas (Coach, Hype, Sergeant, Zen, Data) change wording + voice | switch persona, log a set |
| Form review clips with fix + "How to do it" | squat with a fault, open Review form |
| Talk to Jim to log / correct / delete sets (confirm card) | "log 3x10 curls at 25" |
| Goals tab, weekly check-in, Home health card | load demo data |
| First-run setup: beginner/comeback, **fitness goal, "what you want to look like"**, pain → safety text | fresh install |
| **Rest timer personalized by goal**, exercise, effort, experience, activity level, with reason | log a set with each goal |
| **Activity level from Apple Health export / CSV** | import a real `export.xml` (unzip first) |
| **Import workouts from CSV / Excel** with preview → confirm | file picker on iOS + Android |
| Progress History tab + month/year comparisons | scroll with demo data |

## 3. Almost done (🟡) — blocked on one thing
| Feature | Missing piece | Owner |
|---|---|---|
| Real AI Jim (Claude via `server/jim-proxy`, tools → confirm cards, offline fallback) | live smoke test with a real `ANTHROPIC_API_KEY` (env only, never in repo) | human |
| **Plan from a physique photo** (`/physique`, consent, photo never stored) | same live test with a real photo; proxy shared secret (`X-Jim-Key`) before exposing beyond LAN | human + agent |
| Native Apple Health / Health Connect reading | needs an Expo dev build (doesn't run in Expo Go); adapter interface is in place | post-hackathon |
| Accuracy beyond simulation (front squat, lunge, push-up variants, curl↔press, effort) | real labeled clips; all those numbers are simulated only | team records clips (consented) |
| Form thresholds, 50° arm-swing limit | real bad-form clips | team |

## 4. Not started / not doing
| Item | Status |
|---|---|
| 2-minute demo script + backup screen recording | 📋 **needed before 8 AM** |
| Devpost submission | 📋 **needed before 8 AM** — draft in `docs/DEVPOST.md` |
| Persona wording for the remaining Home replies | 📋 small |
| Leaderboard | ❌ on-device privacy model; would need opt-in sharing |
| Mascot art | ❌ needs a designer |
| 3D renders / MPJPE | ❌ post-hackathon |

## 5. Repo hygiene (done 2026-11-14)
- All feature PRs (#15, #18–#38) closed as included in `main` via #39; 0 open PRs.
- All remote branches except `main` deleted. 17 branches with commits not on main are kept as tags `archive/<branch>` (e.g. older sprint branches, `fix/mutation-gate`, `feat/progress-analytics`). Restore with `git push origin archive/<b>:refs/heads/<b>`.
- Worth a look later: `archive/fix/mutation-gate` (mutation-test CI fixes) and `archive/feat/progress-analytics` (1 commit) were never merged.

## 6. Honest limitations (say these in the demo if asked)
- Real labeled data is small (3 real reps, 2 adversarial clips). 20-rep, push-up, lunge and front-squat results are **simulated**.
- Effort estimate uses barbell velocity research; uncalibrated for body-weight moves.
- Push-ups must be filmed side-on.
- Expo Go has no speech-to-text; Talk mode uses keyboard dictation.
- Form rules and rest times are guidance, not medical advice.
