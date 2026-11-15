# Spoken welcome and multi-week programs (review prototype)

Branch `feat/chat-mvp-review`. This extends the chat review prototype. Nothing is merged,
deployed or published to the shared Expo preview.

## Try it

```sh
cd apps/expo
npm ci
npm run preview:review          # Expo web on :8081
```

Sign up for a local review account, complete or skip setup, then:

1. **Welcome.** Jim says "Hi, I'm Jim, your personal gym assistant. What are we training
   today?" once per launch, after your saved preferences load. Browsers often block speech
   until you click something; then an **Enable Jim's voice** button appears instead. Use the
   speaker button (**Mute Jim / Unmute Jim**, saved) and **Replay greeting** in the header.
   Typing, sending, muting or a new reply stops Jim mid-sentence.
2. **Talk.** The headphones button turns on Talk mode. You dictate with your keyboard's
   microphone and Jim reads replies aloud. JimBro never opens the microphone or records audio.
3. **Build a program.** Tap **Build my program** or type, e.g., "Build me a 10-week 4-day
   powerbuilding program". Jim asks only what it doesn't know yet:
   - goal, experience, days per week and session length;
   - equipment and anything to work around;
   - block length.

   Answer with the chips or type ("4 days", "full gym", "my knees get sore"). Invalid answers
   ("9 days") are explained and asked again; "cancel" stops.
4. **Review, then save.** The program card opens week 1. Tap any week or day for warm-ups,
   sets × reps @ RPE, rest, load guidance and swap options, and open **Progression, hold,
   reduce and deload** for the rules. **Save program** (or **Replace my plan**, which keeps the
   old plan in plan history) is the only thing that saves it.
5. **Use it.** Ask:
   - "What's today's workout?" (then **Start this session**);
   - "Why this exercise?" or "Why deadlifts?";
   - "Swap this movement", which shows options; a changed program is reviewed as a new version
     before saving;
   - "Make this session shorter", which changes today only.

## How programs are built (`apps/expo/src/lib/program.js`)

| Part | What it does |
|---|---|
| Model | `jimbro.program.v1`: program → weeks (build / deload) → sessions (name, focus, warm-up, order, estimated minutes) → items (catalog exercise id, role, sets, rep range, RPE range, rest, load guidance, reason, substitutions). Progression, hold, reduce and stop rules, plus deload guidance, apply to the whole block. |
| Splits | 2–3 days: full body A/B/C. 4 days: upper strength, lower strength, upper hypertrophy, lower hypertrophy plus deadlift (the powerbuilding option). 5 days: the 4-day split plus arms and shoulders. |
| Prescriptions | Set and rep schemes per goal and role: main compound, secondary compound or accessory. Effort rises across each 3-week build wave. Every 4th week and the final week is a deload with about 60% of the sets at RPE 5–6. |
| Beginners | At most 3 sets on compounds and 2 on accessories, at least 5 reps, RPE no higher than 7.5, and no level-3 skill lifts (for example, Romanian deadlift instead of deadlift, chin-up or pulldown instead of pull-up). |
| Exercise choice | Each slot picks the first library exercise that fits the equipment, limitations and experience. Thin sessions are topped up with safe basics. Sessions are trimmed to fit the time limit while keeping at least one pull. |
| Loads | From your logged sets only. Example: "Last logged: 5 × 225 lb at RPE 7. Start there…". The plan links the set id it used. Without history the plan says to pick a weight by effort: no weights, no one-rep maxes, no max testing. |
| Validation | `validateProgram` checks: <br>• catalog ids, equipment, limitations and level; <br>• sets 1–6, reps 1–30, RPE 5–10, rest 30–300 s; <br>• session time and at most 20 weekly sets per muscle; <br>• pulling balance, and deloads lighter than the week before; <br>• that every starting load is backed by a real logged set. <br>Saving re-validates. An automated test builds every intake combination (8,640) and requires zero problems. |
| Versions | Saving or replacing keeps the previous plan in `planVersions` (last 10). Swaps produce `version + 1` with a change log. |
| Compatibility | The saved plan still has `days` (week 1), so existing screens keep working. "Start a workout" follows the program's week and day. |

**Reference material.** The spec referred to `Powerbuilding_4x_per_week.pdf`, but that file was
not attached to this session. Programs follow only the principles the spec listed (compound
strength plus hypertrophy accessories, balance, warm-ups, rest, effort, progression,
substitutions, deloads, and full-body or upper/lower options). No external tables were copied
and no PDF is bundled.

## Honest limits

- Rule-based programming, not a coach's judgement or medical advice. The set and rep schemes
  and the 20-set weekly volume cap are general guidelines, not validated on JimBro users.
- The exercise library has 19 lifts, so lower-body days are short on variety (no leg press,
  calf or core work).
- Program generation and chat answers are on-device and need no AI. Claude does not yet
  generate or edit programs, and no live-Claude program run was made.
- Speech tests check that the speech API was called with the right text and stopped when
  expected. Nobody has listened to the audio on a phone yet.
- The mascot body is blue. This branch keeps the teammate's blue palette rather than the
  coral/red the brief mentions.
