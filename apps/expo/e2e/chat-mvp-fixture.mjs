// Deterministic SDK fixture behind the production HTTP server. No paid API calls,
// browser request interception, camera video, or fabricated production workout data.
import { createJimServer } from '../../../server/jim-proxy/http.js';

const text = value => ({ type: 'text', text: value });
const tools = (...calls) => ({ stop_reason: 'tool_use', content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `fixture-${i}`, name, input })) });
const reply = value => ({ stop_reason: 'end_turn', content: [text(value)] });

export async function startChatFixture({ port = 8787, key = 'e2e-jim-key' } = {}) {
  const calls = [];
  const client = { messages: { async create(request) {
    calls.push(structuredClone(request));
    const last = request.messages.at(-1);
    if (Array.isArray(last.content)) {
      const results = last.content.map(x => {
        try { return JSON.parse(x.content); } catch { return x.content; }
      });
      const sets = results.find(x => Array.isArray(x?.sets))?.sets;
      const observed = results.find(x => x?.camera)?.camera;
      if (observed) return reply(`The camera has observed ${observed.reps} reps of ${observed.exercise}.`);
      const userText = request.messages.filter(x => x.role === 'user' && typeof x.content === 'string').at(-1)?.content || '';
      if (sets?.length && /correct|delete/i.test(userText)) return tools(/correct/i.test(userText)
        ? ['correct_set', { setId: sets.at(-1).id, changes: { reps: 9 } }]
        : ['delete_set', { setId: sets.at(-1).id }]);
      if (sets) return reply(sets.length ? `Your log contains ${sets.length} set${sets.length === 1 ? '' : 's'}; the last one has ${sets.at(-1).reps} reps.` : 'There are no logged sets yet.');
      return reply(last.content.some(x => x.is_error) ? 'The tool request was rejected. Your workout was not changed.' : 'Check the result in the conversation. Any log changes still need your confirmation.');
    }
    const message = String(last.content);
    if (/slow upstream/i.test(message)) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return tools(['log_sets', { exercise: 'squat', reps: 8, weight: 20, unit: 'kg', count: 1 }]);
    }
    if (/offline/i.test(message)) throw Object.assign(new Error('fixture upstream unavailable'), { status: 503 });
    if (/malformed/i.test(message)) return tools(['log_sets', { exercise: 'squat', reps: -2, weight: 20, unit: 'kg' }]);
    if (/unknown tool/i.test(message)) return tools(['execute_shell', { command: 'not executed' }]);
    if (/logged sets/i.test(message)) return tools(['get_recent_sets', {}]);
    if (/observed rep count/i.test(message)) return tools(['get_live_session', {}]);
    if (/correct|delete/i.test(message)) return tools(['get_recent_sets', {}]);
    if (/squats|squat set/i.test(message) && /log|save/i.test(message)) return tools(['log_sets', { exercise: 'squat', reps: 8, weight: 20, unit: 'kg', count: 1 }]);
    if (/prepare/i.test(message)) return tools(['show_panel', { panel: 'camera', exercise: 'squat' }]);
    if (/review my training/i.test(message)) return tools(['show_panel', { panel: 'progress' }]);
    if (/ask before/i.test(message)) {
      const previous = request.messages.filter(x => x.role === 'user' && typeof x.content === 'string').at(-2)?.content;
      return reply(previous ? `Your previous question was: ${previous}` : 'There is no earlier question in this chat.');
    }
    return reply('I can help you plan a workout, count camera reps, and review the sets you have logged.');
  } } };
  const server = createJimServer({ client, key, origin: '*', limitRequests: () => true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    server, calls, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
