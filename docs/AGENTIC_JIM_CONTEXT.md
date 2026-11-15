# JimBro — context pack for research: "Jim as a live, voice + vision agent"

Paste this whole file into a research assistant. It describes what exists today (2026-11-14) so the research builds on it instead of starting over.

## The research question
Turn JimBro into an agentic app you can "call": the user starts a live session, Jim **hears** them (voice commands, conversation), **sees** them (phone camera), and **acts** using the app's existing features. Example: *"Hey Jim, I want a new workout that uses our features in the app"* → Jim asks 1–2 questions, builds a plan from goals/history, starts the session, counts reps on camera, corrects form out loud, sets rest, logs everything, and gives a spoken report — hands-free.

Research wanted:
1. Architecture options for a real-time voice + vision agent on a phone (on-device vs. cloud speech-to-text / text-to-speech, realtime/streaming LLM APIs, wake word "Hey Jim", barge-in/interrupting, latency budgets).
2. How to keep the camera private: today **no video leaves the phone** — only pose landmarks (numbers). Compare sending landmarks/derived events vs. occasional frames vs. video to a model; privacy and cost trade-offs.
3. How the agent should call existing features as tools (list below), with confirmation for anything that changes data.
4. What it takes on Expo / React Native (Expo Go vs. dev build; native modules for mic streaming, STT, wake word, background audio).
5. Safety: no medical claims, no body shaming, never accuse the user of cheating, pain → stop and safety text.
6. A phased plan: hackathon-demo version (hours) → MVP (weeks) → full product.

## Product today
Hackathon: HackPrinceton Fall '26, Healthcare track. Positioning: "an adaptive AI training system that turns ordinary smartphone video into measurable exercise data, then uses that data to personalize future workloads." Pain point: anxiety about being judged by coaches or other lifters.

User-facing features (all on `main`, https://github.com/slaterrr/JimBro):
- **Camera rep counting on the phone** (curl, squat, shoulder press, push-up) with MediaPipe pose; explains every rep that didn't count ("caught it"), spoken camera guidance ("step back so your feet are in frame").
- **Exercise recognition:** detects switching exercise mid-set (lunge in squat mode, curl ↔ press, push-up in other modes) and suggests the right one; labels push-ups standard / knee / incline.
- **Effort estimate** (RPE / reps in reserve) from rep slowdown and range-of-motion loss — labelled an estimate.
- **Set report** (counted / not counted + reasons, tempo, tracking quality, tips), spoken aloud.
- **Form review:** skeleton replay of a bad rep vs. ideal, with why / fix / cue and a "how to do it" demo.
- **Personas** with roles: Coach, Hype, Sergeant (drill), Zen, Data (analyst); each changes wording and voice rate/pitch, never the numbers.
- **Setup:** fitness goal (strength / muscle / endurance / general), "what you want to look like" (text + focus muscles), experience, pain → safety message.
- **Personalized rest timer** by goal, exercise, effort, experience, activity level, with the reason shown.
- **Plans:** goal-based plans; import past workouts from CSV/Excel; optional reference photo → Claude suggests muscles to prioritise → weekly plan proposal (consent, photo never stored).
- **Health:** activity level from an Apple Health export / CSV; weekly health card; measurable goals; weekly check-in; progress history with workout / month / year comparisons.
- **Jim chat / Talk mode:** text or keyboard dictation to Claude; Jim can log, correct or delete sets, always via a confirm card.

## Architecture today
- **App:** Expo SDK 58 / React Native 0.88, run in **Expo Go** (no custom native modules yet). Data stored on the phone (AsyncStorage).
- **Pose:** MediaPipe Tasks Vision `pose_landmarker_lite` inside a WebView → 33 landmarks per frame → `LiveSession` (`apps/expo/src/lib/live.js`): hysteresis rep counter plus gates (tracking loss, framing, implausible joint speed, arm swing, exercise change). Each frame returns count, state, issue, hint, `blocked` (rep not counted + reason) and `suggested` (likely exercise).
- **Voice out:** `expo-speech` (text-to-speech) through one module, `lib/sound.js`; plays with the iPhone on silent. **No speech-to-text in Expo Go** — Talk mode relies on keyboard dictation.
- **AI:** `server/jim-proxy` (Node) → Anthropic Claude (`claude-sonnet-5-5`) with tools. The tools return *proposals*; the app shows confirm cards. Offline fallback to a rule-based Jim. Routes: `/chat`, `/physique` (image), `/health`. Rate-limited; **no auth secret yet**.
- Existing Claude tools: `log_sets`, `correct_set`, `delete_set`, `get_recent_sets`, `get_goal_progress`, `get_weekly_checkin`, `get_last_set_report`.
- App logic a voice agent could expose as tools: start/end workout, choose exercise (camera mode), `restFor` (rest), `planFromGoal` (plans), `importWorkouts`, `activityLevel`, `sessionReport` / `spokenReport`, `analyzeRep` (form), `switchPlan` (exercise switch), `cameraGuidance`, persona selection.
- **Testing:** TDD with Node's test runner. 380 app tests, 44 vision-lab tests (simulator + real-clip replays), 26 proxy tests; GitHub Actions CI.

## Hard constraints
- Privacy: video never stored or uploaded; only text (and an explicitly consented photo) goes to the AI. API keys only in server env.
- Honesty: no fabricated accuracy numbers; several detection results are simulated only (real labeled data is small).
- Tone: never shame, never accuse of cheating; uncertain tracking is the camera's fault; not medical advice.
- Data changes by the AI always need user confirmation (voice "yes" could count — research how to do that safely).

## Known gaps relevant to the research
- No speech-to-text, wake word or streaming mic in Expo Go → likely needs an Expo dev build.
- Jim can't currently see anything but landmarks/events; there is no continuous "AI watching" loop.
- Native Apple Health / Health Connect reading needs a dev build.
- The proxy needs auth before leaving the local network.
