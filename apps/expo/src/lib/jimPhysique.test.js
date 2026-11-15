// askPhysique: photo -> proxy -> emphasis -> plan proposal, with offline fallback. fetch is faked.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { askPhysique, MAX_PHOTO_BASE64 } from './jimAI.js';

const state = {
  settings: { fitnessGoal: 'muscle', physiqueGoal: 'Bigger shoulders', focusMuscles: ['biceps'], unit: 'lb' },
  history: [{ id: 'w1', startedAt: '2026-11-01T12:00:00.000Z', sets: [{ id: 's1', exercise: 'shoulder_press', reps: 10, weight: 30, unit: 'lb' }] }],
};
const image = { base64: 'aGVsbG8=', mediaType: 'image/jpeg' };

function fakeFetch(reply, status = 200) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: status < 400, status, json: async () => reply }; };
  f.calls = calls;
  return f;
}

describe('askPhysique', () => {
  it('never uploads without explicit consent', async () => {
    const f = fakeFetch({ ok: true, emphasis: [] });
    const r = await askPhysique({ image, consent: false, state, url: 'http://p', fetchImpl: f });
    assert.equal(f.calls.length, 0);
    assert.equal(r.source, 'offline');
    assert.equal(r.proposal.type, 'plan');
    assert.deepEqual(r.proposal.plan.focus, ['biceps']);
  });
  it('sends only the photo, consent and goal text: no history, no set data', async () => {
    const f = fakeFetch({ ok: true, emphasis: [{ muscle: 'shoulders', reason: 'Round delts stand out.' }] });
    await askPhysique({ image, consent: true, state, url: 'http://p', fetchImpl: f });
    assert.equal(f.calls[0].url, 'http://p/physique');
    assert.deepEqual(f.calls[0].body, { consent: true, image: { media_type: 'image/jpeg', data: 'aGVsbG8=' }, fitnessGoal: 'muscle', physiqueGoal: 'Bigger shoulders', focusMuscles: ['biceps'] });
  });
  it('builds a photo-led plan proposal from the validated emphasis plus local history', async () => {
    const f = fakeFetch({ ok: true, emphasis: [{ muscle: 'shoulders', reason: 'Round delts stand out.' }, { muscle: 'wings', reason: 'x' }] });
    const r = await askPhysique({ image, consent: true, state, url: 'http://p', fetchImpl: f });
    assert.equal(r.source, 'ai');
    assert.deepEqual(r.emphasis, [{ muscle: 'shoulders', reason: 'Round delts stand out.' }]);
    assert.equal(r.proposal.plan.source, 'photo');
    assert.deepEqual(r.proposal.plan.focus, ['shoulders', 'biceps']);
    const curl = r.proposal.plan.days.flatMap((d) => d.items).find((i) => i.exercise === 'shoulder_press');
    assert.deepEqual(curl.start, { weight: 30, unit: 'lb' });
  });
  it('falls back to the rule plan when the photo is not a physique, the proxy fails or is missing', async () => {
    const notPhysique = await askPhysique({ image, consent: true, state, url: 'http://p', fetchImpl: fakeFetch({ ok: false, reason: 'not_physique' }) });
    assert.equal(notPhysique.source, 'offline');
    assert.equal(notPhysique.reason, 'not_physique');
    assert.match(notPhysique.message, /physique/);
    const down = await askPhysique({ image, consent: true, state, url: 'http://p', fetchImpl: fakeFetch({}, 502) });
    assert.equal(down.source, 'offline');
    assert.equal((await askPhysique({ image, consent: true, state, url: null })).source, 'offline');
    assert.equal((await askPhysique({ image: null, consent: true, state, url: 'http://p', fetchImpl: fakeFetch({}) })).reason, 'no photo');
  });
  it('does not upload oversized photos', async () => {
    const f = fakeFetch({});
    const r = await askPhysique({ image: { base64: 'A'.repeat(MAX_PHOTO_BASE64 + 4), mediaType: 'image/jpeg' }, consent: true, state, url: 'http://p', fetchImpl: f });
    assert.equal(f.calls.length, 0);
    assert.equal(r.reason, 'photo too large');
  });
  it('defaults safely when the new settings are absent', async () => {
    const r = await askPhysique({ image: null, consent: false, state: { settings: {}, history: [] }, url: null });
    assert.equal(r.proposal.plan.goal, 'general');
    assert.deepEqual(r.proposal.plan.focus, []);
  });
});
