import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleChat, runReadTool, TOOLS } from './jim.js';
import { createJimServer } from './http.js';

const text = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ready in this chat.' }] };
const use = (name, input = {}, id = 't1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const fake = (responses) => ({ messages: { create: async () => responses.shift() } });
const body = { messages: [{ role: 'user', content: 'Help me train' }], context: { liveCamera: { exercise: 'squat', reps: 7 }, activeSession: { setCount: 1 } } };

test('live-session tool reads observed reps; missing evidence stays missing', () => {
  assert.equal(runReadTool('get_live_session', {}, body.context).camera.reps, 7);
  assert.equal(runReadTool('get_live_session', {}, {}).camera, null);
});
test('camera tool opens a supported local panel, never inventing counts', async () => {
  const r = await handleChat(body, fake([use('show_panel', { panel: 'camera', exercise: 'squat' }), text]));
  assert.deepEqual(r.actions, [{ type: 'show_panel', panel: 'camera', exercise: 'squat' }]);
  assert.deepEqual(r.toolCalls, [{ name: 'show_panel', status: 'completed' }]);
  assert.deepEqual(r.proposals, []);
});
test('invalid actions and unknown tools are rejected and recorded', async () => {
  const r = await handleChat(body, fake([use('show_panel', { panel: 'camera', exercise: 'bench_press' }), text]));
  assert.deepEqual(r.actions ?? [], []);
  assert.equal(r.toolCalls[0].status, 'rejected');
  const unknown = await handleChat(body, fake([use('run_code', { code: 'anything' }), text]));
  assert.deepEqual(unknown.proposals, []);
});
test('strict tool schemas disallow extra arguments', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.strict, true);
    assert.equal(tool.input_schema.additionalProperties, false);
  }
});
test('production HTTP routes enforce auth, JSON validation and errors with injectable SDK', async (t) => {
  const server = createJimServer({ client: fake([text]), key: 'test-key', origin: 'http://localhost:8081' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/chat`, { method: 'POST', body: JSON.stringify(body) })).status, 401);
  const headers = { 'X-Jim-Key': 'test-key', 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers, body: '{' })).status, 400);
  const response = await fetch(`${url}/chat`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal((await response.json()).reply, 'Ready in this chat.');
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
});
