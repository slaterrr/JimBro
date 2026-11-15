// Every Jim output goes through the persona: same facts, different wording and emphasis.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coachReply, SAFETY_TEXT } from './coach.js';
import { liveCue } from './cues.js';
import { PERSONA_IDS, personaFor } from './personas.js';
import { setReport } from './sessionReport.js';
import { spokenReport } from './speech.js';
import { loggedText, restText } from './voice.js';

const BANNED = /\b(lazy|weak|pathetic|fat|stupid|loser|useless|cheat\w*|shame\w*|disgrac\w*|excuses?)\b/i;
const nums = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).sort().join(',');
const set = (weight, reps, rpe, unit = 'kg', exercise = 'shoulder_press') => ({ exercise, weight, unit, reps, rpe });
const rep = (ms) => ({ concentric_ms: ms / 2, peak_pause_ms: 0, eccentric_ms: ms / 2 });

function samePersonaContract(make) {
  const outs = PERSONA_IDS.map((p) => make(p));
  assert.equal(new Set(outs.map(nums)).size, 1, `numbers differ: ${outs.join(' | ')}`);
  assert.equal(new Set(outs).size, PERSONA_IDS.length, `wording not distinct: ${outs.join(' | ')}`);
  for (const s of outs) assert.doesNotMatch(s, BANNED, s);
  return outs;
}

describe('persona voice', () => {
  const history = [set(20, 10, 6)];
  it('coach replies keep the numbers for every persona and seed', () => {
    for (const seed of [0, 1, 2, 3]) {
      const outs = samePersonaContract((p) => coachReply('what next?', p, history, seed).text);
      for (const s of outs) assert.match(s, /21/);
    }
  });
  it('varies wording across seeds', () => {
    for (const p of PERSONA_IDS) {
      const v = new Set([0, 1, 2].map((seed) => coachReply('what next?', p, history, seed).text));
      assert.ok(v.size >= 2, p);
    }
  });
  it('empty-history replies differ but all ask for a set', () => {
    const outs = samePersonaContract((p) => coachReply('hi', p, []).text);
    for (const s of outs) assert.match(s, /log/i);
  });
  it('safety is the identical fixed message for all personas', () => {
    for (const p of PERSONA_IDS) assert.equal(coachReply('my back hurts', p, history).text, SAFETY_TEXT);
  });
  it('emphasizes each persona focus', () => {
    const t = (p) => coachReply('what next?', p, history, 0).text;
    assert.match(t('drill'), /target|plan/i);
    assert.match(t('zen'), /rest|slow|control|breathe/i);
    assert.match(t('analyst'), /^\D*\d/); // leads with a number
    assert.match(t('hype'), /!/);
    assert.match(t('coach'), /elbow|form|cue/i);
  });
  it('legacy tone ids still resolve and still work', () => {
    assert.equal(personaFor('friendly').id, 'coach');
    assert.equal(personaFor('hard').id, 'drill');
    assert.equal(coachReply('what next?', 'silly', history, 0).text, coachReply('what next?', 'hype', history, 0).text);
    assert.equal(coachReply('what next?', 'nonsense', history, 0).persona, 'coach');
  });
  it('live cues share facts across personas', () => {
    const r = (c, e) => ({ concentric_ms: c, eccentric_ms: e });
    for (const [count, lastRep] of [[8, r(900, 1500)], [3, r(300, 1500)], [3, r(900, 400)], [12, r(900, 1500)], [0, null]]) {
      samePersonaContract((persona) => liveCue({ movement: 'shoulder_press', count, target: 12, lastRep, tracking: 'ok', persona }));
    }
    const lost = new Set(PERSONA_IDS.map((persona) => liveCue({ movement: 'shoulder_press', count: 0, target: 12, lastRep: null, tracking: 'lost', persona })));
    assert.equal(lost.size, 1);
  });
  it('spoken reports share facts across personas and stay short', () => {
    const reps = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1200, 1200, 1200].map(rep);
    const report = setReport({ movement: 'shoulder_press', reps, target: 12, quality: { frames: 100, okFrames: 95, issues: { arm_swing: 2 }, partials: 0 } });
    const outs = samePersonaContract((p) => spokenReport(report, p));
    for (const s of outs) assert.ok(s.split(/\s+/).length < 30, s);
    samePersonaContract((p) => spokenReport(setReport({ movement: 'squat', reps: [rep(2000), rep(2000)] }), p));
  });
  it('set-logged and rest lines go through the persona', () => {
    for (const isPR of [false, true]) {
      samePersonaContract((p) => loggedText(p, { exercise: 'shoulder_press', reps: 10, weight: 20, unit: 'kg', isPR }, 1));
    }
    samePersonaContract((p) => restText(p, 90, 2));
  });
});

describe('persona settings', () => {
  it('migrates a legacy tone to a persona and keeps other settings', async () => {
    const { migrateSettings } = await import('./personas.js');
    assert.deepEqual(migrateSettings({ tone: 'hard', unit: 'kg' }), { persona: 'drill', unit: 'kg' });
    assert.deepEqual(migrateSettings({ tone: 'friendly', persona: 'zen' }), { persona: 'zen' });
    assert.deepEqual(migrateSettings({ persona: 'bogus' }), { persona: 'coach' });
    assert.deepEqual(migrateSettings(undefined), { persona: 'coach' });
  });
  it('gives speech options from the persona voice', async () => {
    const { speechOptions } = await import('./personas.js');
    assert.deepEqual(speechOptions('hype'), { rate: 1.1, pitch: 1.2 });
    assert.deepEqual(speechOptions('silly'), { rate: 1.1, pitch: 1.2 });
    assert.deepEqual(speechOptions(undefined), { rate: 1.0, pitch: 1.0 });
  });
});
