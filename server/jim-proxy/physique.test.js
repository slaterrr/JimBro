// Physique photo -> training emphasis, with the Anthropic SDK mocked: no network, no key.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MODEL } from './jim.js';
import { bodyLimitFor, EMPHASIS_TOOL, handlePhysique, MAX_IMAGE_BYTES, PHYSIQUE_SYSTEM } from './physique.js';

const PNG = Buffer.alloc(2000, 7).toString('base64');
const body = (over = {}) => ({ consent: true, image: { media_type: 'image/png', data: PNG }, fitnessGoal: 'muscle', physiqueGoal: 'Bigger arms and shoulders', focusMuscles: ['biceps'], ...over });

function fakeClient(response) {
  const calls = [];
  return { calls, messages: { create: async (req) => { calls.push(req); return response; } } };
}
const toolUse = (input) => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Looks great!' }, { type: 'tool_use', id: 't1', name: 'propose_training_emphasis', input }] });
const good = { is_physique_photo: true, priorities: [{ muscle: 'shoulders', reason: 'Capped, rounded delts are the most visible feature.' }, { muscle: 'biceps', reason: 'Full upper arms in the reference.' }] };

describe('physique request shape', () => {
  it('sends the image as a base64 image block before the text, with the emphasis tool', async () => {
    const c = fakeClient(toolUse(good));
    await handlePhysique(body(), c);
    const req = c.calls[0];
    assert.equal(req.model, MODEL);
    assert.equal(req.system, PHYSIQUE_SYSTEM);
    assert.deepEqual(req.tools, [EMPHASIS_TOOL]);
    assert.deepEqual(req.tool_choice, { type: 'auto' });
    const [img, txt] = req.messages[0].content;
    assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
    assert.equal(txt.type, 'text');
    assert.match(txt.text, /Bigger arms and shoulders/);
    assert.match(txt.text, /muscle/);
  });
  it('the system prompt forbids weight, attractiveness and health judgments', () => {
    assert.match(PHYSIQUE_SYSTEM, /never comment on body weight/i);
    assert.match(PHYSIQUE_SYSTEM, /attractive/i);
    assert.match(PHYSIQUE_SYSTEM, /health/i);
    assert.equal(EMPHASIS_TOOL.strict, true);
  });
});

describe('physique output validation', () => {
  it('returns only validated emphasis, never the model text', async () => {
    const r = await handlePhysique(body(), fakeClient(toolUse(good)));
    assert.deepEqual(r, { ok: true, emphasis: good.priorities });
    assert.ok(!JSON.stringify(r).includes('Looks great'));
  });
  it('drops judgmental reasons and unknown muscles; none left -> not ok', async () => {
    const r = await handlePhysique(body(), fakeClient(toolUse({ is_physique_photo: true, priorities: [{ muscle: 'abs', reason: 'Lose some body fat first' }, { muscle: 'wings', reason: 'x' }] })));
    assert.deepEqual(r, { ok: false, reason: 'no_valid_emphasis' });
  });
  it('not a physique photo -> graceful not ok', async () => {
    assert.deepEqual(await handlePhysique(body(), fakeClient(toolUse({ is_physique_photo: false, priorities: [] }))), { ok: false, reason: 'not_physique' });
  });
  it('model refusal or no tool call -> graceful not ok', async () => {
    assert.deepEqual(await handlePhysique(body(), fakeClient({ stop_reason: 'refusal', content: [] })), { ok: false, reason: 'declined' });
    assert.deepEqual(await handlePhysique(body(), fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }] })), { ok: false, reason: 'no_proposal' });
  });
});

describe('physique request checks', () => {
  const rejects = (b, re) => assert.rejects(handlePhysique(b, fakeClient(toolUse(good))), re);
  it('requires explicit consent', async () => {
    await rejects(body({ consent: undefined }), /consent/);
    await rejects(body({ consent: 'yes' }), /consent/);
  });
  it('accepts only jpeg/png/webp base64 images', async () => {
    await rejects(body({ image: { media_type: 'image/svg+xml', data: PNG } }), /image type/);
    await rejects(body({ image: { media_type: 'image/png', data: 'not base64!!' } }), /base64/);
    await rejects(body({ image: null }), /image/);
  });
  it('rejects images over the size limit with a TooLarge error', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 3, 1).toString('base64');
    await assert.rejects(handlePhysique(body({ image: { media_type: 'image/jpeg', data: big } }), fakeClient(toolUse(good))), (e) => e.name === 'TooLarge');
  });
  it('caps the physique goal text', async () => {
    await rejects(body({ physiqueGoal: 'x'.repeat(301) }), /physiqueGoal/);
  });
  it('allows a bigger body only on the photo route', () => {
    assert.equal(bodyLimitFor('/chat'), 64 * 1024);
    assert.ok(bodyLimitFor('/physique') > MAX_IMAGE_BYTES * 4 / 3);
    assert.ok(bodyLimitFor('/physique') < 8 * 1024 * 1024);
  });
});
