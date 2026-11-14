// Proxy logic with the Anthropic SDK mocked: no network, no key.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allowRequest, buildSystemPrompt, handleChat, MODEL, proposalFrom, runReadTool, TOOLS } from './jim.js';

const context = {
  unit: 'lb',
  recentSets: [
    { id: 's1', exercise: 'squat', reps: 5, weight: 225, unit: 'lb', date: '2026-11-10' },
    { id: 's2', exercise: 'curl', reps: 10, weight: 20, unit: 'lb', date: '2026-11-12' },
  ],
  prs: [{ exercise: 'squat', unit: 'lb', heaviest: { reps: 5, weight: 225 } }],
  goals: [{ label: 'Squat est. 1RM 300 lb', pct: 80 }],
  weeklyCheckIn: { wins: ['2 workouts'], misses: [], suggestion: 'Keep going.' },
  lastSetReport: { movement: 'curl', counted: 10, trackingPct: 92 },
};

/** Fake SDK client: returns the queued responses in order and records each request. */
function fakeClient(responses) {
  const calls = [];
  return { calls, messages: { create: async (req) => { calls.push(structuredClone(req)); return responses.shift(); } } };
}
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (name, input, id = 'tu1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

describe('system prompt', () => {
  it('uses the persona role, purpose, style and focus plus every ground rule', () => {
    const p = buildSystemPrompt('drill');
    assert.match(p, /Sergeant Jim/);
    assert.match(p, /Accountability drill sergeant/);
    assert.match(p, /Blunt, commanding/);
    assert.match(p, /plan adherence/);
    assert.match(p, /Never change workout data without the user confirming/);
  });
  it('maps legacy tones and unknown ids to a persona', () => {
    assert.match(buildSystemPrompt('silly'), /Hype Jim/);
    assert.match(buildSystemPrompt(undefined), /Coach Jim/);
  });
});

describe('tools', () => {
  it('defines the write and read tools', () => {
    const names = TOOLS.map((t) => t.name).sort();
    assert.deepEqual(names, ['correct_set', 'delete_set', 'get_goal_progress', 'get_last_set_report', 'get_recent_sets', 'get_weekly_checkin', 'log_sets'].sort());
    for (const t of TOOLS) assert.equal(t.input_schema.type, 'object');
  });
  it('answers read tools from the context snapshot only', () => {
    assert.deepEqual(runReadTool('get_recent_sets', { exercise: 'curl' }, context).sets.map((s) => s.id), ['s2']);
    assert.equal(runReadTool('get_recent_sets', {}, context).sets.length, 2);
    assert.deepEqual(runReadTool('get_goal_progress', {}, context).goals, context.goals);
    assert.deepEqual(runReadTool('get_weekly_checkin', {}, context), context.weeklyCheckIn);
    assert.deepEqual(runReadTool('get_last_set_report', {}, context), context.lastSetReport);
    assert.deepEqual(runReadTool('get_last_set_report', {}, {}), { none: 'No camera set report yet.' });
  });
});

describe('proposals', () => {
  it('turns log_sets into a log intent shaped like intents.js', () => {
    const p = proposalFrom('log_sets', { exercise: 'squat', reps: 5, weight: 225, count: 3 }, context);
    assert.deepEqual(p, {
      type: 'log',
      set: { exercise: 'squat', reps: 5, weight: 225, unit: 'lb' },
      sets: Array(3).fill({ exercise: 'squat', reps: 5, weight: 225, unit: 'lb' }),
      summary: 'Log 3 sets of 5 × squat at 225 lb?',
    });
  });
  it('includes rpe when given', () => {
    const p = proposalFrom('log_sets', { exercise: 'curl', reps: 10, weight: 20, unit: 'kg', rpe: 8 }, context);
    assert.equal(p.summary, 'Log 10 × bicep curl at 20 kg, RPE 8?');
    assert.equal(p.set.rpe, 8);
  });
  it('turns correct_set into a correct intent targeting a known set', () => {
    const p = proposalFrom('correct_set', { setId: 's1', changes: { weight: 235 } }, context);
    assert.deepEqual(p, { type: 'correct', target: { setId: 's1' }, changes: { weight: 235 }, summary: 'Change your squat (5 × 225 lb) to 5 × 235 lb?' });
  });
  it('turns delete_set into a delete intent', () => {
    assert.deepEqual(proposalFrom('delete_set', { setId: 's2' }, context), { type: 'delete', target: { setId: 's2' }, summary: 'Delete your bicep curl (10 × 20 lb)?' });
  });
  it('rejects unknown set ids, unknown exercises and bad numbers', () => {
    assert.equal(proposalFrom('delete_set', { setId: 'nope' }, context), null);
    assert.equal(proposalFrom('log_sets', { exercise: 'zercher_row', reps: 5, weight: 10 }, context), null);
    assert.equal(proposalFrom('log_sets', { exercise: 'curl', reps: -1, weight: 10 }, context), null);
    assert.equal(proposalFrom('log_sets', { exercise: 'curl', reps: 5, weight: 10, count: 50 }, context), null);
    assert.equal(proposalFrom('correct_set', { setId: 's1', changes: { weight: -5 } }, context), null);
  });
});

describe('handleChat', () => {
  const messages = [{ role: 'user', content: 'how is my squat going?' }];

  it('runs read tools server-side and returns the final reply', async () => {
    const client = fakeClient([toolUse('get_recent_sets', { exercise: 'squat' }), text('Squat is at 225 for 5.')]);
    const r = await handleChat({ messages, context, persona: 'analyst' }, client);
    assert.deepEqual(r, { reply: 'Squat is at 225 for 5.', proposals: [] });
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].model, MODEL);
    assert.ok(client.calls[0].max_tokens <= 400);
    assert.match(client.calls[0].system, /Data Jim/);
    const result = client.calls[1].messages.at(-1).content[0];
    assert.equal(result.type, 'tool_result');
    assert.match(result.content, /"s1"/);
  });

  it('returns write tools as proposals without applying anything', async () => {
    const client = fakeClient([toolUse('log_sets', { exercise: 'curl', reps: 10, weight: 20 }), text('Confirm and I log it.')]);
    const r = await handleChat({ messages: [{ role: 'user', content: '10 curls at 20' }], context, persona: 'coach' }, client);
    assert.equal(r.reply, 'Confirm and I log it.');
    assert.equal(r.proposals.length, 1);
    assert.equal(r.proposals[0].type, 'log');
  });

  it('short-circuits pain without calling the model', async () => {
    const client = fakeClient([]);
    const r = await handleChat({ messages: [{ role: 'user', content: 'my knee hurts' }], context }, client);
    assert.equal(client.calls.length, 0);
    assert.match(r.reply, /Stop the set now/);
    assert.equal(r.safety, true);
  });

  it('rejects malformed bodies', async () => {
    await assert.rejects(handleChat({ messages: [] }, fakeClient([])), /messages/);
    await assert.rejects(handleChat({ messages: [{ role: 'user', content: 'x'.repeat(5000) }] }, fakeClient([])), /too long/);
  });

  it('stops a runaway tool loop', async () => {
    const loops = Array.from({ length: 10 }, (_, i) => toolUse('get_recent_sets', {}, `t${i}`));
    const r = await handleChat({ messages, context }, fakeClient(loops));
    assert.equal(typeof r.reply, 'string');
  });
});

describe('rate limit', () => {
  it('allows a burst then blocks per ip until the window passes', () => {
    const buckets = new Map();
    for (let i = 0; i < 20; i += 1) assert.equal(allowRequest('1.1.1.1', 0, buckets), true);
    assert.equal(allowRequest('1.1.1.1', 1000, buckets), false);
    assert.equal(allowRequest('2.2.2.2', 1000, buckets), true);
    assert.equal(allowRequest('1.1.1.1', 61_000, buckets), true);
  });
});
