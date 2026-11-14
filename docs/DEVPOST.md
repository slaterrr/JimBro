# Devpost draft — JimBro

Due **8:00 AM Sun Nov 15**. Main track: **Healthcare**. Also opt in: Best Rookie Hack (if eligible), Amazon Best Practical AI. Add every teammate's Discord username. Optional ≤ 2-min video must be uploaded before 8 AM.

## Tagline
Your AI gym bro: a phone camera coach that counts real reps, explains every call, and builds your plan from your own data.

## Inspiration
Lots of people avoid the gym or quit early because of anxiety about being judged by coaches or other lifters, and because they don't know if their form or progress is any good. Fitness apps trust whatever number you type in. We wanted a private coach in your pocket that measures what you actually did and turns it into the next step.

## What it does
- **Counts reps with the phone camera, privately.** Pose tracking runs on the phone; no video is stored or uploaded.
- **Knows what you're doing.** Detects when you switch exercise (lunges in squat mode, presses in curl mode) and labels push-ups as standard, knee or incline.
- **Explains every call.** A "caught it" badge and spoken reason when a rep doesn't count; it never accuses you, it tells you how to fix the camera or the rep.
- **Set report + effort estimate.** Counted reps, tempo, tracking quality, estimated effort (RPE), and evidence-backed tips. Jim reads it out.
- **Form review.** Replays the rep as a skeleton next to the ideal and gives a why / fix / cue.
- **Personal plan.** Setup asks your goal and the look you want; import past workouts from Excel/CSV, optionally add a reference photo, and Jim proposes a weekly plan you confirm. Rest times adapt to your goal and effort.
- **Health tracking.** Activity level from your Apple Health export, weekly health card, measurable goals and check-ins.
- **Jim is a real AI.** Talk or text with Jim (Claude); he can log or correct your data, but always asks you to confirm. Five personas with real roles (Coach, Hype, Sergeant, Zen, Data).

## How we built it
Expo / React Native app; MediaPipe pose landmarker running on-device in a WebView; a hysteresis rep counter with gates for tracking loss, framing, implausible joint speed and exercise changes. A Node proxy calls Claude with tools that return *proposals* the app shows as confirm cards, with an offline rule-based fallback. We built a "vision lab" that replays real videos through the exact production model and scores counting against labels, plus a seeded landmark simulator for 20-rep sets and adversarial cases. Test-driven throughout: 380 app tests, 44 vision tests, 26 proxy tests in CI.

## Challenges
- Gesturing while talking was counted as curls — fixed with a torso-in-frame gate (held-out clip: 5 fake reps → 0).
- Front-facing squats were invisible to a 2D knee angle — added a foreshortening-based estimator.
- Knee push-ups and lunges looked like the "right" exercise to a single joint angle — we classify body shape, not just one joint.

## Accomplishments
- Zero fake reps on our real adversarial clips, including a held-out one we never tuned on.
- Every number in the report has evidence behind it, and the app says when it isn't sure.

## What we learned
Trust is the product: a coach that is honest about uncertainty beats one that is confidently wrong.

## What's next
More real, consented training clips (we're honest that several results are simulated so far), native Apple Health / Health Connect, front-view push-ups, and calibrating effort to each user.

## Built with
expo, react-native, mediapipe, javascript, node.js, claude, anthropic-api, github-actions

## Checklist before submitting
- [ ] Public GitHub link: https://github.com/slaterrr/JimBro
- [ ] Screenshots (Home, Coach with caught-it badge, set report, Progress)
- [ ] ≤ 2-min video (problem → live rep count → caught it → report → plan)
- [ ] Discord usernames for all teammates
- [ ] Track: Healthcare; opt-ins: Rookie (if eligible), Amazon Practical AI
