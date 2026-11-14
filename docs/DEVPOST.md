# Devpost draft — JimBro

Due **8:00 AM Sun Nov 15**. Main track: **Healthcare**. Opt in: Amazon Best Practical AI, Best Rookie Hack (if eligible). Add every teammate's Discord username. Optional ≤ 2-min video must be uploaded before 8 AM. Demo script: `docs/DEMO.md`.

## Tagline
Your AI gym bro: a private phone-camera coach that counts only real reps, explains every call, and plans your next workout from what you actually did.

## Inspiration
Many people skip the gym, or quit early, because they're anxious about being judged by coaches or other lifters, and because they can't tell whether their form or progress is any good. Most fitness apps trust whatever number you type. We wanted a private coach in your pocket that measures what you did and turns it into the next step, without video ever leaving the phone.

## What it does
- **Workout Mission.** Tap "I have 20 minutes, help me finish chest day". Jim plans a session that fits the time, from your goal, history and which muscles are rested, explains each pick, and waits for you to confirm. Then he runs it hands-free: the set starts when the camera sees you, ends when you stop, asks a quick effort check, counts down rest, and suggests the next set's load (Use it / Keep plan).
- **Camera rep counting on the phone** (or a laptop browser) for curl, squat, shoulder press and push-ups (standard / knee / incline). Lunge, pull-up and deadlift counting is marked **experimental**. Video is never stored or uploaded.
- **"Caught it."** Arm swing, joints that jump, leaving the frame and gesturing are not counted, and Jim says why. It is framed as a tracking issue, never as cheating. He notices when you switch lifts and offers to switch the set.
- **Set report:** counted and not-counted reps with reasons, rep times, tempo, tracking quality, joint speed, and an effort estimate (labelled as an estimate). Form review replays your skeleton next to the ideal with a fix and a cue.
- **Jim is an agent (Claude).** He reads your workout context and history through tools, answers "why was I slower?", "what's left today?", "swap this lift", and *proposes* log changes or plans as confirm cards. Nothing changes until you tap Confirm. Without the AI proxy, an offline rule-based coach answers from the same data; a badge shows which one is active. Five personas (Coach, Hype, Sergeant, Zen, Data) change wording and voice, never the numbers.
- **Plans, goals and progress.** First-run setup (beginner / comeback, goal, what you want to look like; pain → safety text, no plan). Rest per exercise and goal with the reason shown. Goals and weekly check-in, estimated 1RM, volume, PRs, workout/month/year comparisons, muscle map.
- **Bring your data.** Import workouts from CSV/Excel; estimate activity level from an Apple Health export; optionally plan toward a reference physique photo (sent once, only after a consent tick, never stored, never judged).

## How we built it
- **App:** Expo / React Native (phone + web). MediaPipe Pose Landmarker (Lite) runs on-device in a WebView (an iframe on web).
- **Vision engine:** joint angles → hysteresis rep counter with gates for tracking loss, framing, torso-in-frame, implausible joint speed and exercise change; per-rep angular speed; whole-body shape checks for push-up type, lunges and curl↔press switches. A versioned event contract feeds a coach engine.
- **AI:** a small Node proxy holds the Claude API key (the app never does), receives only a text summary (no video, names or ids), uses tools that return proposals, supports an `X-Jim-Key` shared secret, and falls back cleanly. Pain or dizziness gets a fixed safety reply before any network call.
- **Vision lab:** replays real MP4s through the exact production model and scores the counter against labels; a seeded landmark simulator for long and adversarial sets; a consented landmark recorder.
- **Test-driven:** app 559, vision lab 51, proxy 35 tests, plus a headless-Chrome UI smoke test of every screen at 320/390 px, all in CI.

## Evidence (real and simulated kept apart)
- **Real video (4 labeled clips):** 3/3 real reps counted; 0 fake reps on 2 clips of someone talking and gesturing, one held out (never tuned on) that went from 5 fake reps to 0 after the torso-in-frame gate. Each real clip replayed in every other camera mode: 24 wrong-mode runs, 0 false reps. This is far too little data to claim accuracy; these are regression guards.
- **Simulated (seeded landmarks, logic only):** 20/20 reps on 20-rep sets for each lift; push-up type 480/480 per variant; 0/640 lunges counted in squat mode.
- **Live Claude (GitHub Actions smoke runs):** plain reply, history lookup and confirm-first proposals PASS; a real squat clip went through the vision engine and Claude cited its measurements. `/physique` was only run live with a synthetic non-person image.

## Challenges
- Talking with your hands was counted as curls. A torso-in-frame gate fixed it (held-out real clip: 5 → 0 fake reps).
- Front-facing squats were invisible to a 2D knee angle; we added a foreshortening-based estimate (simulated only so far).
- Knee push-ups and lunges look "right" to a single joint angle, so we check whole-body shape.
- Letting an AI edit your training log safely: every write is a proposal you confirm.
- Very little labeled real video in 36 hours, so we built tooling that keeps real and simulated results separate and honest.

## Accomplishments
- Zero fake reps on our real adversarial clips, including a held-out one.
- Video never leaves the phone; the AI sees text only.
- An agent that reasons over your real data, plans, acts only with consent, and adapts the next set.
- Every number in the report has evidence behind it, and the app says when it isn't sure.

## What we learned
Trust is the product. A coach that is honest about uncertainty, and blames the camera instead of the user, beats one that is confidently wrong.

## What's next
Record and label more consented real clips (half held out) to validate the push-up, lunge, front-squat, form and effort results that are simulated today; measure camera FPS on real phones; native Apple Health / Health Connect (needs a dev build); calibrate effort per user; opt-in sharing before any leaderboard.

## Limitations (say them if asked)
Small real dataset; works best side-on; front-on curls and front-view push-ups not handled; effort and form are uncalibrated heuristics, not medical advice; 1RM is an Epley estimate; latency measured on a laptop, not a phone; Expo Go has no speech-to-text (Talk mode uses keyboard dictation).

## Built with
expo, react-native, javascript, mediapipe, node.js, claude, anthropic-api, eas-update, github-actions

## Checklist before submitting
- [ ] Public GitHub link: https://github.com/slaterrr/JimBro
- [ ] Screenshots (Home with mission chip, Coach with caught-it badge, set report, confirm card, Progress)
- [ ] ≤ 2-min video following `docs/DEMO.md`
- [ ] Discord usernames for all teammates
- [ ] Track: Healthcare; opt-ins: Amazon Practical AI, Rookie (if eligible)
