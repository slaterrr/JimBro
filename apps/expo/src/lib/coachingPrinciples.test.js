// Coaching principles drawn from Ćurović & Grecic (2025), a qualitative interview study of 12
// experienced personal trainers in Serbia (doi:10.3389/fspor.2025.1549979). The paper informs
// Jim's behaviour; it is not evidence that AI coaching works.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PRINCIPLES, SOURCE, coachingStyle, principleRules, recoveryQuestion } from './coachingPrinciples.js';

describe('principles', () => {
  it('cite the paper and cover its practice themes', () => {
    assert.match(SOURCE.doi, /10\.3389\/fspor\.2025\.1549979/);
    assert.match(SOURCE.caveat, /not evidence/i);
    const ids = PRINCIPLES.map((p) => p.id);
    for (const id of ['individualize', 'know_the_person', 'explain_why', 'autonomy', 'holistic', 'realistic_goals', 'adherence']) assert.ok(ids.includes(id), id);
    for (const p of PRINCIPLES) {
      assert.ok(p.theme.length > 5 && p.rule.length > 20, p.id);
    }
  });

  it('become short prompt rules for the AI', () => {
    const rules = principleRules();
    assert.equal(rules.length, PRINCIPLES.length);
    assert.ok(rules.every((r) => r.length < 220));
  });
});

describe('building independence (autonomy)', () => {
  it('new users get Jim\'s suggestion; experienced users are asked first', () => {
    assert.equal(coachingStyle({ sessions: 2 }).askUserFirst, false);
    assert.equal(coachingStyle({ sessions: 12 }).askUserFirst, true);
    assert.match(coachingStyle({ sessions: 12 }).prompt, /what would you pick/i);
  });
});

describe('knowing the person (recovery before load)', () => {
  it('asks about sleep and stress when reps drop versus last time, not after a normal set', () => {
    const drop = recoveryQuestion({ fatigue: { level: 'increasing_difficulty', signals: ['3 fewer reps than last time at 135 lb.'] } });
    assert.match(drop, /sleep|stress/i);
    assert.equal(recoveryQuestion({ fatigue: { level: 'normal', signals: [] } }), null);
    assert.equal(recoveryQuestion({ fatigue: { level: 'possible_fatigue', signals: ['Your last reps were 35% slower than your first.'] } }), null); // within-set slowing is normal
  });
});
