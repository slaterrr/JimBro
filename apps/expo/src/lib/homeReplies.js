// Offline Home chat replies (plan intro, mission intro, confirm results, clarify questions).
// Same facts for every persona; only the wording changes. No persona = Coach Jim = the
// original wording, so callers that don't pass one keep working unchanged.
import { exerciseName } from './exercises.js';
import { personaFor } from './personas.js';
import { FOCUS_LABEL } from './mission.js';

const pick = (persona, table) => table[personaFor(persona).id];

/** Reply when the user taps "Create a New Plan". */
export function planIntro(persona) {
  return pick(persona, {
    coach: "Let's build your plan. Pick a goal and save it, or import past workouts and use a reference photo.",
    hype: "Plan time, let's go! Pick a goal and save it, or bring in past workouts and a reference photo!",
    drill: 'New plan. Pick a goal. Save it. Or import past workouts and add a reference photo.',
    zen: 'Let\'s shape a plan at your own pace. Choose a goal and save it, or import past workouts and a reference photo if you like.',
    analyst: 'Plan setup: select a goal and save it. Optional inputs: imported past workouts, a reference photo.',
  });
}

/** Intro for a Workout Mission. mission: {minutes, focus, estMinutes}. */
export function missionIntro(mission, { hasHistory = false, persona } = {}) {
  const { minutes, estMinutes } = mission;
  const area = (FOCUS_LABEL[mission.focus] ?? '').toLowerCase();
  const sess = `${minutes}-minute ${area} session`.replace('  ', ' ');
  const t = pick(persona, {
    coach: [`Here's a ${sess}, about ${estMinutes} minutes with rests.`, 'I picked it from your history.', 'No history yet, so we start light and I adjust after each set.', "Start when you're ready."],
    hype: [`Your ${sess} is ready, about ${estMinutes} minutes with rests!`, 'Built straight from your history!', 'Fresh start! We go light and I level it up after each set!', "Hit start and let's go!"],
    drill: [`${sess[0].toUpperCase()}${sess.slice(1)}. About ${estMinutes} minutes with rests.`, 'Picked from your history.', 'No history yet. We start light. I adjust after each set.', 'Start now.'],
    zen: [`A calm ${sess}, about ${estMinutes} minutes with rests.`, 'I chose it from your history.', 'No history yet, so we begin gently and I adjust after each set.', 'Begin whenever you feel ready.'],
    analyst: [`Plan: ${sess}, estimated ${estMinutes} minutes including rests.`, 'Selected from your logged history.', 'No history logged, so loads start light and update after each set.', 'Start when ready.'],
  });
  return `${t[0]} ${hasHistory ? t[1] : t[2]} ${t[3]}`;
}

/** Reply after the user confirms a log / correct / delete intent. */
export function confirmedText(intent, persona) {
  if (intent?.type === 'log') {
    const x = intent.sets[0];
    const n = intent.sets.length > 1 ? `${intent.sets.length} sets of ` : '';
    const what = `${n}${x.reps} × ${exerciseName(x.exercise)} at ${x.weight} ${x.unit}`;
    return pick(persona, {
      coach: `Logged ${what}.`,
      hype: `Boom! Logged ${what}!`,
      drill: `Logged ${what}. Next.`,
      zen: `Logged ${what}. Nicely done.`,
      analyst: `Recorded: ${what}.`,
    });
  }
  if (intent?.type === 'correct') {
    return pick(persona, {
      coach: 'Done, I fixed that set.',
      hype: 'Fixed it! That set is right now!',
      drill: 'Set corrected.',
      zen: 'All set, that one is corrected.',
      analyst: 'Set updated with the new values.',
    });
  }
  return pick(persona, {
    coach: 'Done, that set is gone.',
    hype: 'Gone! That set is outta here!',
    drill: 'Set deleted.',
    zen: 'That set has been removed.',
    analyst: 'Set removed from your log.',
  });
}

/** Shown when a confirm card's target set changed before the tap. */
export function staleText(persona) {
  return pick(persona, {
    coach: 'That set has changed or is no longer available. Ask Jim again before making this change.',
    hype: 'Whoa, that set changed or is gone! Ask me again and we\'ll sort it!',
    drill: 'That set changed or is gone. Ask again.',
    zen: 'That set has changed or is no longer there. Ask me again whenever you\'re ready.',
    analyst: 'Target set changed or no longer exists. Re-send the request to apply it.',
  });
}

/** Clarify questions used by intents.js. */
export const clarifyText = {
  noSets: (persona) => pick(persona, {
    coach: "You haven't logged any sets yet. Want to log one?",
    hype: 'No sets logged yet! Want to log your first one?',
    drill: 'No sets logged. Log one?',
    zen: 'Nothing logged yet, and that\'s fine. Would you like to log a set?',
    analyst: 'Your log has no sets yet. Log one?',
  }),
  noSetOf: (ex, persona) => pick(persona, {
    coach: `I can't find a ${ex} set to change. Which set do you mean?`,
    hype: `Hmm, no ${ex} set found! Which one did you mean?`,
    drill: `No ${ex} set found. Which set?`,
    zen: `I don't see a ${ex} set to change. Which one did you have in mind?`,
    analyst: `No matching ${ex} set in your log. Which set should change?`,
  }),
  repsOrWeight: (n, unit, persona) => pick(persona, {
    coach: `Did you mean ${n} reps or ${n} ${unit}?`,
    hype: `Quick check! ${n} reps or ${n} ${unit}?`,
    drill: `${n} reps or ${n} ${unit}? Pick one.`,
    zen: `Just to be sure, ${n} reps or ${n} ${unit}?`,
    analyst: `Ambiguous value: ${n} reps or ${n} ${unit}?`,
  }),
  tooManySets: (count, max, persona) => pick(persona, {
    coach: `${count} sets? Tell me up to ${max} at a time.`,
    hype: `${count} sets, love it! Give me up to ${max} at a time!`,
    drill: `${count} sets? Max ${max} at a time.`,
    zen: `${count} sets? Let's take up to ${max} at a time.`,
    analyst: `${count} sets exceeds the limit. Up to ${max} per message.`,
  }),
};
