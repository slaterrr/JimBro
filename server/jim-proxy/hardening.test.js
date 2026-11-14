// Proxy hardening: coaching principles in the prompt, chat-sized requests, refusal / truncation
// handling, optional server-side fallbacks, a shared-secret check, and a workout-context tool.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { principleRules } from '../../apps/expo/src/lib/coachingPrinciples.js';
import { authorized, buildSystemPrompt, handleChat, runReadTool, TOOLS } from './jim.js';

const text = (t, stop = 'end_turn') => ({ stop_reason: stop, content: t ? [{ type: 'text', text: t }] : [] });
const fake = (responses, { beta = false } = {}) => {
  const calls = [];
  const create = async (req) => { calls.push(structuredClone(req)); return responses.shift(); };
  return { calls, messages: { create }, ...(beta ? { beta: { messages: { create } } } : {}) };
};
const ask = (content) => ({ messages: [{ role: 'user', content }] });

describe('prompt', () => {
  it('includes every coaching principle', () => {
    const p = buildSystemPrompt('coach');
    for (const rule of principleRules()) assert.ok(p.includes(rule), rule);
  });
});

describe('request shape', () => {
  it('leaves room for thinking, keeps chat effort low, never forces a tool', async () => {
    const c = fake([text('Hi.')]);
    await handleChat(ask('hello'), c);
    const req = c.calls[0];
    assert.ok(req.max_tokens >= 1024, `max_tokens ${req.max_tokens}`);
    assert.equal(req.output_config?.effort, 'low');
    assert.equal(req.tool_choice, undefined);
  });

  it('uses server-side fallbacks when the client supports the beta, unless turned off', async () => {
    const c = fake([text('Hi.')], { beta: true });
    await handleChat(ask('hello'), c);
    assert.deepEqual(c.calls[0].betas, ['server-side-fallback-2026-07-01']);
    assert.equal(c.calls[0].fallbacks, 'default');
    const off = fake([text('Hi.')], { beta: true });
    await handleChat(ask('hello'), off, { fallbacks: false });
    assert.equal(off.calls[0].fallbacks, undefined);
  });
});

describe('stop reasons', () => {
  it('a refusal gets a plain reply and no proposals', async () => {
    const r = await handleChat(ask('something'), fake([text('', 'refusal')]));
    assert.equal(r.refused, true);
    assert.deepEqual(r.proposals, []);
    assert.ok(r.reply.length > 10);
  });

  it('a cut-off answer is not shown as complete', async () => {
    const r = await handleChat(ask('long question'), fake([text('Partial answer that', 'max_tokens')]));
    assert.match(r.reply, /cut off/i);
  });
});

describe('shared secret', () => {
  it('requires X-Jim-Key when a key is configured; timing-safe compare', () => {
    assert.equal(authorized({}, ''), true); // no key configured: LAN development
    assert.equal(authorized({}, 'secret-123'), false);
    assert.equal(authorized({ 'x-jim-key': 'nope' }, 'secret-123'), false);
    assert.equal(authorized({ 'x-jim-key': 'secret-123' }, 'secret-123'), true);
  });
});

describe('workout context tool', () => {
  it('exposes today, sets left and the profile from the app snapshot', () => {
    assert.ok(TOOLS.some((t) => t.name === 'get_workout_context'));
    const ctx = { workout: { today: 'Today is Plan day 2: deadlift 3 sets of 5.', setsLeft: '2 sets left: 2 deadlift.' } };
    assert.deepEqual(runReadTool('get_workout_context', {}, ctx), ctx.workout);
    assert.ok(runReadTool('get_workout_context', {}, {}).none);
  });
});
