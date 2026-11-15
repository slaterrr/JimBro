import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSystemPrompt, handleChat } from './jim.js';

const fakeClient = () => { const calls = []; return { calls, messages: { create: async (a) => { calls.push(a); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; } } }; };

describe('AI tasks', () => {
  it('adds reasoning instructions for each routed task', () => {
    for (const t of ['goal_change', 'conflict', 'complex_question', 'workout_review', 'weekly_review'])
      assert.notEqual(buildSystemPrompt('coach', t), buildSystemPrompt('coach'), t);
    assert.match(buildSystemPrompt('coach', 'goal_change'), /build_program|exercise/i);
    assert.match(buildSystemPrompt('coach', 'weekly_review'), /get_weekly_checkin/);
  });
  it('ignores unknown tasks', () => {
    assert.equal(buildSystemPrompt('coach', 'hack'), buildSystemPrompt('coach'));
  });
  it('handleChat passes the task into the system prompt', async () => {
    const client = fakeClient();
    await handleChat({ messages: [{ role: 'user', content: 'weekly review' }], context: {}, persona: 'coach', task: 'weekly_review' }, client);
    assert.match(JSON.stringify(client.calls[0].system), /get_weekly_checkin/);
  });
});
