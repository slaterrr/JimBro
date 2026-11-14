# Demo script — JimBro (≤ 2 minutes)

Criteria: Creativity, Utility, Charity, Avidity. Main track Healthcare; also Amazon Best Practical AI (agentic). Only use numbers from `docs/DEVPOST.md`.

## Pre-demo checklist (10 min before)
- [ ] **Wake the proxy:** open `<proxy-url>/health` → `{ "ok": true }`. Repeat right before your slot (hosted proxies sleep). The app needs `EXPO_PUBLIC_JIM_PROXY_URL` (and `EXPO_PUBLIC_JIM_PROXY_KEY` if `JIM_PROXY_KEY` is set).
- [ ] **AI badge:** send Jim one message on Home; the badge should say **AI** ("Connected to Jim AI"), not "offline". If offline, use the fallback below.
- [ ] Phone charged (> 60%), brightness up, Do Not Disturb on, volume up (Jim speaks, also with the ringer on silent).
- [ ] Demo data loaded (🔔 sheet) so Progress and the mission have history.
- [ ] Persona: Coach.
- [ ] Spot: whole body in frame, side-on, good light; a teammate holds or props the phone.
- [ ] Backup screen recording on a second device; laptop with Expo web in Chrome as a second camera.

## The 2-minute script
| Time | Say / do |
|---|---|
| 0:00–0:15 | **Problem.** "Lots of people skip the gym because they're anxious about being judged, and fitness apps just trust what you type. JimBro is a private coach in your pocket: the phone camera measures what you actually did, and an AI coach plans your next step. Video never leaves the phone." |
| 0:15–0:35 | **Home → mission chip.** Tap "I have 20 minutes, help me finish chest day". "Jim plans a session that fits my time from my goal, history and rested muscles, and explains each pick. Nothing starts until I confirm." Tap Start. |
| 0:35–1:00 | **Camera counting.** 3 clean reps side-on; the counter goes up. Then a half rep or an arm wave: **"Caught it"** + spoken reason. "It doesn't count that, and it says why. It blames the camera, never the user." |
| 1:00–1:20 | **Set report.** Stop; the set ends itself. Counted vs not counted with reasons, tempo, tracking quality, effort estimate. Next-set suggestion: tap Use it. |
| 1:20–1:45 | **Jim chat + confirm card.** Ask "why was my last set slower?" or type "log 3x10 curls at 25". "Jim is Claude with tools: he reads my history and the measured set, and any change comes back as a confirm card." Tap Confirm. |
| 1:45–2:00 | **Progress + close.** Scroll history / comparisons. "Real reps in, a personal plan out, privately. On our real test clips, including one we never tuned on: zero fake reps." |

## 30-second fallback
- **AI down (badge says offline):** keep going. "Without the AI service, a built-in offline coach answers from the same data; the badge shows which one is on." Confirm cards still work.
- **Camera won't track:** "This light is tough for the camera, which is exactly why Jim tells you what he can't see." Play the backup clip of counting + caught it (15 s), then show set report and Progress live with demo data (15 s).
- **App won't open:** play the full backup recording and narrate the script.

## Likely judge Q&A (honest answers)
- **How accurate is it?** On 4 labeled real clips: 3/3 real reps counted, 0 fake reps on 2 talking/gesturing clips (one held out), 24 wrong-mode replays with 0 false reps. That's too little data for an accuracy number. 20-rep, push-up and lunge results are simulated. Next step: record consented clips.
- **Is video uploaded?** No. Pose runs on the phone; only landmarks reach the app logic. The AI gets a text summary. The one exception is an optional physique photo, sent once after a consent tick, never stored.
- **What makes it agentic?** Jim reasons over your history and measured sets, plans a time-boxed session, acts through tools, and adapts the next set. Every write is a proposal you confirm. Live Claude smoke runs (history lookup, proposals, citing real-clip measurements) passed in CI.
- **What if someone fakes reps?** We don't call it cheating. Reps the camera can't verify aren't counted, and Jim says what to fix (framing, range, swing).
- **Medical advice?** No. Form and effort are heuristics. Pain or dizziness gets a fixed safety reply and no plan.
- **Which exercises?** Camera: curl, squat, shoulder press, push-ups (side-on). Lunge, pull-up, deadlift are experimental. The rest are tap-to-log.
- **Phone performance?** Uses the Lite pose model. We haven't measured FPS on phones yet; our latency numbers are from a laptop.
- **Limitations?** Small real dataset, best side-on, no front-on curls or front-view push-ups, uncalibrated effort, no speech-to-text in Expo Go (keyboard dictation instead), not yet checked end to end on a real phone.
- **Tests?** App 559, vision lab 51, proxy 35, plus a UI smoke test of every screen, in CI.
