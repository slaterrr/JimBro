// Feature-wiring regression guard. Logic is tested elsewhere; these checks fail when a merge or
// refactor silently drops a shipped feature from the screen that exposes it. Update AGENTS.md
// and this list together when a feature is intentionally removed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const WIRING = {
  'screens/CoachScreen.js': [
    [/liveCue\([^)]*persona/, 'live cues use the selected persona'],
    [/\.blocked\b/, '"caught it" badge for blocked reps'],
    [/\.quality\(\)/, 'set quality passed to the set report'],
    [/How to do it/, 'proper-form demo button'],
    [/\bvoice\.cue\(|\bcue\(/, 'rep counts spoken through the voice module'],
  ],
  'components/Sheets.js': [
    [/spokenReport\(/, 'Jim speaks the set report'],
    [/Hear report/, 'Hear report button'],
    [/Review form/, 'form review entry'],
    [/restFor\(/, 'per-exercise rest timer'],
    [/<PersonaPicker/, 'persona picker in settings'],
    [/setReport\(/, 'set report built after a camera set'],
  ],
  'screens/HomeScreen.js': [
    [/askJim\(/, 'AI Jim chat with offline fallback'],
    [/Talk/, 'Talk mode'],
    [/HOME_OPTIONS|homeActions/, 'Start a Workout / Create a New Plan / Review My Progress'],
  ],
  'lib/homeActions.js': [
    [/Your AI gym bro\. Tell me what you want to work on today\./, 'team subtitle'],
    [/Start a Workout/, 'Start a Workout'],
    [/Create a New Plan/, 'Create a New Plan'],
    [/Review My Progress/, 'Review My Progress'],
  ],
  'screens/ProgressScreen.js': [
    [/Goals/, 'Goals tab'],
    [/History/, 'History tab with comparisons'],
  ],
  'AppState.js': [
    [/migrateSettings/, 'legacy tone → persona migration'],
    [/migrateVoiceSettings/, 'voice on by default (sound bug)'],
    [/enableAudio\(/, 'iOS silent-mode playback (sound bug)'],
    [/migrateGoals/, 'goals persisted'],
    [/updateSet/, 'Jim can correct sets'],
  ],
  'lib/live.js': [
    [/torsoInFrame/, 'framing gate (gesture false reps)'],
    [/jointSpeed/, 'joint-speed gate (hallucinated joints)'],
    [/clips/, 'form clips per rep'],
  ],
};

for (const [file, checks] of Object.entries(WIRING)) {
  for (const [re, feature] of checks) {
    test(`${file} still wires: ${feature}`, () => assert.match(src(file), re));
  }
}

test('only the voice module calls expo-speech directly (one place for sound rules)', () => {
  for (const f of ['screens/CoachScreen.js', 'screens/HomeScreen.js', 'components/Sheets.js', 'AppState.js']) {
    assert.doesNotMatch(src(f), /Speech\.speak\(/, `${f} must speak through voice.js`);
  }
});
