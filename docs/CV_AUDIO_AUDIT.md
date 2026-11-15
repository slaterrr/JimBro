# CV coach audio audit

## Scope and evidence

Audited Expo main at `649adf1`, including CoachScreen, AppState, sound.js,
the installed expo-speech iOS implementation and expo-audio session configuration.
The Expo camera path runs MediaPipe in a WebView and sends landmarks to JavaScript;
the legacy Python backend does not play the phone's coach audio.

## Confirmed code defects

1. **A form instruction could cancel itself in the same camera callback.**
   CoachScreen calls `jim.say(cameraGuidance(...), { force: true })`, then
   `jim.cue('Not counted...', { force: true })` for a blocked rep. Both interrupt
   native speech. A subsequent rep count could also interrupt a long instruction.
   The new shared CV narrator protects instructions until completion, cancellation
   or failure. Rep cues are dropped while an instruction is in progress.
2. **Silent chat could stop CV speech.** Disabled `createVoice` still forwarded
   `stop()` to the process-wide Expo Speech synthesizer. Chat typing, sending and
   navigation invoked that method. Disabled voices now have a no-op stop.
3. **Playback preparation was asynchronous and unobserved.** Audio configuration
   ran at provider mount; speech did not wait for it, native stop was not awaited,
   and setup failures were swallowed and cached. CV playback now awaits audio setup
   and native stop, checks cancellation before speaking, reports failure, and allows
   setup retry. The CV camera refreshes the audio configuration after camera ready.
4. **The new coach voice never received the device voice list.** Only the disabled
   general voice received it. The coach now receives the list too, enabling normal
   validation/fallback for saved voice choices.

## Observability and behavior

Camera readiness now triggers a short exercise instruction, rather than requiring
a tracking fault or completed rep before the first sound. Native speech errors and
audio setup failures surface a user-visible notice. General chat remains silent,
and native keyboard dictation remains available. The chat camera shortcut removal
is preserved.

## Validation and limits

722 app tests pass, including regressions for instruction interruption, disabled
chat cancellation, async audio readiness and retry after audio failure. iOS export
is checked separately. No physical iPhone speaker output has been measured here.
These defects explain cancellation and silent failures, but cannot prove which one
caused the reported device symptom without a device reproduction.

Device acceptance: reload Expo Go, open a camera workout and listen for the ready
instruction; trigger a tracking/form correction and let it finish; complete a rep;
leave the CV screen and confirm speech stops. Check media volume, Bluetooth output
and silent mode if there is still no sound. Record any visible audio error.

References: https://docs.expo.dev/versions/v58.0.0/sdk/speech/
and https://docs.expo.dev/versions/latest/sdk/audio/.
