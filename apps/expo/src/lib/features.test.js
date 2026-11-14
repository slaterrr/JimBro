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
    [/cameraGuidance\(/,'specific camera guidance (never silent)'],
    [/speakGuide/, 'spoken, throttled camera corrections'],
    [/\bvoice\.cue\(|\bcue\(/, 'rep counts spoken through the voice module'],
    [/switchPlan\(/, 'switch-exercise suggestion card'],
    [/\.suggested\b/, 'reads the suggested exercise from the live session'],
    [/estimateEffort\(/, 'live effort estimate shown on the camera screen'],
    [/variant/, 'push-up rep type shown on the camera screen'],
  ],
  'lib/exercises.js': [
    [/id: 'lunge'/, 'lunge in the exercise catalog'],
    [/countsWithCamera/, 'camera flag from the analyzer registry'],
  ],
  'lib/analyzers.js': [
    [/push_up: \{\s*id: 'push_up', status: 'tested_sim'/, 'camera-counted push-ups'],
  ],
  'lib/guidance.js': [
    [/exercise_change/, 'exercise-change guidance'],
  ],
  'components/Sheets.js': [
    [/restFor\(\{[^}]*fitnessGoal/, 'rest personalized by fitness goal'],
    [/spokenReport\(/, 'Jim speaks the set report'],
    [/Hear report/, 'Hear report button'],
    [/Review form/, 'form review entry'],
    [/restFor\(/, 'per-exercise rest timer'],
    [/<PersonaPicker/, 'persona picker in settings'],
    [/openSetup|Beginner \/ comeback setup/, 'setup re-openable from the Activity sheet'],
    [/setReport\(/, 'set report built after a camera set'],
  ],
  'screens/HomeScreen.js': [
    [/askJim\(/, 'AI Jim chat with offline fallback'],
    [/Talk/, 'Talk mode'],
    [/HOME_OPTIONS|homeActions/, 'Start a Workout / Create a New Plan / Review My Progress'],
    [/healthSummary\(/, 'weekly health summary card'],
    [/go\?\.\('Progress'\)/, 'health summary opens Progress'],
  ],
  'components/ImportSheet.js': [
    [/getDocumentAsync\(/, 'pick a CSV / Excel workout sheet'],
    [/parseWorkoutFile\(/, 'sheet parsed with tolerant headers'],
    [/skipped/, 'skipped rows shown, not guessed'],
    [/importData\(toExport\(/, 'import only after Confirm, via the existing importer'],
    [/launchImageLibraryAsync\(/, 'pick a reference photo'],
    [/consent/, 'explicit consent before the photo is uploaded'],
    [/askPhysique\(/, 'photo -> AI emphasis -> plan (offline fallback)'],
    [/savePlan\(/, 'plan saved only after Confirm'],
  ],
  'screens/HomeScreen.js#import': [
    [/<ImportSheet\b/, 'import / photo plan entry on Create a New Plan'],
  ],
  'components/Onboarding.js': [
    [/onboardingResult\(/, 'beginner/comeback setup effects'],
    [/ONBOARDING_QUESTIONS/, 'three setup questions'],
    [/r\.safety|result\.safety/, 'pain answer shows the safety message'],
    [/Skip/, 'setup is skippable'],
    [/onboarded: true/, 'setup shown once'],
    [/r\.settings/, 'fitness goal, look and focus muscles saved to settings'],
    [/TextInput/, 'free-text "what do you want to look like"'],
    [/MUSCLE_GROUPS/, 'tap-select focus muscles'],
  ],
  '../App.jsx': [
    [/<Onboarding\b/, 'first-run setup mounted'],
    [/isOnboarded|settings\.onboarded/, 'setup only when not onboarded'],
  ],
  'lib/homeActions.js': [
    [/Your AI gym bro\. Tell me what you want to work on today\./, 'team subtitle'],
    [/Start a Workout/, 'Start a Workout'],
    [/Create a(\s|\\n)New Plan/, 'Create a New Plan'],
    [/Review My(\s|\\n)Progress/, 'Review My Progress'],
  ],
  'screens/ProgressScreen.js': [
    [/Goals/, 'Goals tab'],
    [/History/, 'History tab with comparisons'],
    [/Estimate my activity level/, 'activity level entry card'],
    [/<HealthConnect\b/, 'health history import sheet mounted'],
  ],
  'components/HealthConnect.js': [
    [/activityLevel\(/, 'activity level estimated from health history'],
    [/What JimBro reads/, 'consent screen explains what is read'],
    [/createHealthXmlParser\(/, 'Apple Health export.xml streamed, not loaded whole'],
    [/parseHealthCsv\(/, 'CSV import'],
    [/nativeHealth\(\)/, 'native HealthKit / Health Connect (dev build only)'],
    [/activityLevel: result\.level/, 'save estimate to settings'],
    [/activityLevel: null/, 'clear saved activity level'],
  ],
  'AppState.js': [
    [/migrateGoalSettings/, 'old saves get fitnessGoal general'],
    [/DEFAULT_GOAL_SETTINGS/, 'goal fields in DEFAULT_SETTINGS'],
    [/migrateSettings/, 'legacy tone → persona migration'],
    [/migrateVoiceSettings/, 'voice on by default (sound bug)'],
    [/enableAudio\(/, 'iOS silent-mode playback (sound bug)'],
    [/migrateGoals/, 'goals persisted'],
    [/updateSet/, 'Jim can correct sets'],
    [/onboarded: isOnboarded\(/, 'onboarded flag migrated (old saves with history skip setup)'],
  ],
  'lib/live.js': [
    [/torsoInFrame/, 'framing gate (gesture false reps)'],
    [/jointSpeed/, 'joint-speed gate (hallucinated joints)'],
    [/clips/, 'form clips per rep'],
    [/frontalKneeAngle/, 'front-facing squat counting'],
    [/missingHint/, 'which body part is out of view'],
    [/lowerBodyShape/, 'exercise-change detection (lunge in squat mode)'],
    [/armShape/, 'exercise-change detection (press in curl mode, curl in press mode)'],
    [/suggested = armOther\.suggested/, 'shoulder press suggested from curl mode'],
    [/pushupShape/, 'push-up body-orientation gate and rep-type (knee vs standard)'],
  ],
  'lib/sessionReport.js': [
    [/estimateEffort\(/, 'effort estimate in the set report'],
    [/variants/, 'push-up rep types in the set report'],
  ],
};

for (const [file, checks] of Object.entries(WIRING)) {
  for (const [re, feature] of checks) {
    test(`${file} still wires: ${feature}`, () => assert.match(src(file.split('#')[0]), re)); // 'file#tag' keys add checks to a file listed elsewhere
  }
}

test('screens never call expo-speech directly; AppState only adapts it for sound.js', () => {
  for (const f of ['screens/CoachScreen.js', 'screens/HomeScreen.js', 'components/Sheets.js', 'screens/ProgressScreen.js']) {
    assert.doesNotMatch(src(f), /Speech\.(speak|stop)\(/, `${f} must speak through sound.js`);
  }
  const app = src('AppState.js');
  assert.equal(app.match(/Speech\.speak\(/g)?.length, 1);
  assert.match(app, /createVoice\(\s*\{\s*speak: \(t, o\) => Speech\.speak\(t, o\)/);
});
