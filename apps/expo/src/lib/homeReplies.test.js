// Home chat replies built on the phone: same facts for every persona, only wording changes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { exerciseName } from './exercises.js';
import { confirmedText, missionIntro, planIntro, staleText } from './homeReplies.js';
import { parseIntent } from './intents.js';
import { PERSONA_IDS } from './personas.js';

const BANNED = /\b(lazy|weak|pathetic|fat|stupid|loser|useless|cheat\w*|shame\w*|disgrac\w*|excuses?)\b/i;
const nums = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).sort().join(',');

function contract(make) {
  const outs = PERSONA_IDS.map((p) => make(p));
  assert.equal(new Set(outs.map(nums)).size, 1, `numbers differ: ${outs.join(' | ')}`);
  assert.equal(new Set(outs).size, PERSONA_IDS.length, `wording not distinct: ${outs.join(' | ')}`);
  for (const s of outs) assert.doesNotMatch(s, BANNED, s);
  return outs;
}

const mission = { minutes: 20, focus: 'legs', estMinutes: 18 };
const logOne = { type: 'log', sets: [{ exercise: 'curl', reps: 10, weight: 25, unit: 'lb' }] };
const logThree = { type: 'log', sets: [1, 2, 3].map(() => ({ exercise: 'squat', reps: 5, weight: 100, unit: 'kg' })) };
const history = [{ id: 'w1', sets: [{ id: 's1', exercise: 'curl', reps: 8, weight: 20, unit: 'kg' }] }];

describe('home replies by persona', () => {
  it('default wording is unchanged when no persona is passed', () => {
    assert.equal(planIntro(), "Let's build your plan. Pick a goal and save it, or import past workouts and use a reference photo.");
    assert.equal(missionIntro(mission, { hasHistory: true }), "Here's a 20-minute legs session, about 18 minutes with rests. I picked it from your history. Start when you're ready.");
    assert.equal(missionIntro({ ...mission, focus: 'full' }, { hasHistory: false }), "Here's a 20-minute full body session, about 18 minutes with rests. No history yet, so we start light and I adjust after each set. Start when you're ready.");
    assert.equal(confirmedText(logOne), `Logged 10 × ${exerciseName('curl')} at 25 lb.`);
    assert.equal(confirmedText(logThree), `Logged 3 sets of 5 × ${exerciseName('squat')} at 100 kg.`);
    assert.equal(confirmedText({ type: 'correct' }), 'Done, I fixed that set.');
    assert.equal(confirmedText({ type: 'delete' }), 'Done, that set is gone.');
    assert.equal(staleText(), 'That set has changed or is no longer available. Ask Jim again before making this change.');
  });

  it('coach persona equals the default wording', () => {
    assert.equal(planIntro('coach'), planIntro());
    assert.equal(missionIntro(mission, { hasHistory: true, persona: 'coach' }), missionIntro(mission, { hasHistory: true }));
    assert.equal(confirmedText(logThree, 'coach'), confirmedText(logThree));
    assert.equal(staleText('coach'), staleText());
  });

  it('plan intro', () => { contract((p) => planIntro(p)); });

  it('mission intro keeps minutes, estimate and focus', () => {
    for (const hasHistory of [true, false]) {
      for (const s of contract((p) => missionIntro(mission, { hasHistory, persona: p }))) {
        assert.match(s, /20-minute/);
        assert.match(s, /\b18\b/);
        assert.match(s, /legs/i);
      }
    }
  });

  it('confirmed log / correct / delete', () => {
    for (const s of contract((p) => confirmedText(logOne, p))) assert.match(s, /10 × .* 25 lb/);
    for (const s of contract((p) => confirmedText(logThree, p))) assert.match(s, /3 sets of 5 × .* 100 kg/);
    contract((p) => confirmedText({ type: 'correct' }, p));
    contract((p) => confirmedText({ type: 'delete' }, p));
  });

  it('stale-set notice', () => { contract((p) => staleText(p)); });

  it('intent clarify questions follow ctx.persona, default unchanged', () => {
    const q = (text, ctx) => parseIntent(text, ctx).question;
    assert.equal(q('delete my last set', {}), "You haven't logged any sets yet. Want to log one?");
    assert.equal(q('12 sets of curls 10 reps 20 lb', { history }), '12 sets? Tell me up to 10 at a time.');
    contract((p) => q('delete my last set', { persona: p }));
    contract((p) => q('fix my last squat to 100 lb', { history, persona: p }));
    contract((p) => q('12 sets of curls 10 reps 20 lb', { history, persona: p }));
    contract((p) => q('actually 7', { history, persona: p }));
  });
});
