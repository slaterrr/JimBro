import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConversation } from './conversation.js';

test('conversation retains prior turns and blocks concurrent sends', async () => {
  const c = createConversation(); let finish;
  const pending = c.send('Hello', () => new Promise(r => { finish = r; }));
  assert.equal(c.getSnapshot().busy, true);
  assert.equal(await c.send('Duplicate', () => { throw Error('must not run'); }), null);
  finish({ reply: 'Hi', proposals: [], source: 'ai' }); await pending;
  await c.send('My squat?', async prior => {
    assert.deepEqual(prior.map(m => m.text), ['Hello', 'Hi']);
    return { reply: 'Tell me more', proposals: [], source: 'ai' };
  });
  assert.equal(c.getSnapshot().messages.length, 4);
  assert.equal(c.getSnapshot().source, 'ai');
});
test('cancelled and replaced requests cannot append late replies or proposals', async () => {
  const c = createConversation(); let finish;
  const pending = c.send('Log it', () => new Promise(r => { finish = r; }));
  c.clear();
  finish({ reply: 'Confirm', proposals: [{ type: 'log' }], source: 'ai' });
  await pending;
  assert.equal(c.getSnapshot().messages.length, 0);
  assert.equal(c.getSnapshot().busy, false);
});
test('errors release pending state and proposals remain cards, never executed', async () => {
  const c = createConversation();
  await c.send('Hello', async () => { throw Error('network'); });
  assert.equal(c.getSnapshot().busy, false);
  assert.ok(c.getSnapshot().error);
  await c.send('Log', async () => ({ reply: 'Review', source: 'ai', proposals: [{ summary: 'Log?' }] }));
  assert.equal(c.getSnapshot().messages.at(-1).kind, 'confirm');
  assert.equal(c.getSnapshot().error, null);
});

test('only the newest unexpired confirmation can be consumed, exactly once', async () => {
  let now = 1000;
  const c = createConversation({ now: () => now });
  await c.send('Log', async () => ({ source: 'offline', proposals: [{ summary: 'First?' }] }));
  await c.send('Actually', async () => ({ source: 'offline', proposals: [{ summary: 'Second?' }] }));
  assert.equal(c.claimConfirmation(1, () => true), null);
  const index = c.getSnapshot().messages.findIndex(m => m.kind === 'confirm');
  assert.equal(c.claimConfirmation(index, () => true).summary, 'Second?');
  assert.equal(c.claimConfirmation(index, () => true), null);
  await c.send('Third', async () => ({ source: 'offline', proposals: [{ summary: 'Third?' }] }));
  now += 6 * 60_000;
  assert.equal(c.claimConfirmation(c.getSnapshot().messages.length - 1, () => true), null);
});

test('chat retains safe tool receipts and local panels without polluting text history', async () => {
  const c = createConversation();
  await c.send('Show', async () => ({ source: 'ai', reply: 'Here', toolCalls: [{ name: 'get_live_session', status: 'completed' }], actions: [{ type: 'show_panel', panel: 'camera', exercise: 'squat' }] }));
  assert.equal(c.getSnapshot().messages.find(m => m.kind === 'tools').calls[0].name, 'get_live_session');
  assert.equal(c.getSnapshot().messages.at(-1).panel, 'camera');
});
test('program save cards are one-shot, last 30 minutes, and only replace older program cards', () => {
  let t = 0;
  const c = createConversation({ now: () => t });
  c.update([{ kind: 'program', program: { id: 'a' } }]);
  c.update(cur => [...cur, { kind: 'confirm', intent: { type: 'log' } }]);
  assert.equal(c.getSnapshot().messages[0].kind, 'program'); // a log card does not cancel it
  t = 10 * 60_000;
  assert.equal(c.claimConfirmation(0)?.program.id, 'a');
  assert.equal(c.claimConfirmation(0), null); // used once
  c.update(cur => [...cur, { kind: 'program', program: { id: 'b' } }, { kind: 'program', program: { id: 'c' } }]);
  const kinds = c.getSnapshot().messages.map(m => m.kind);
  assert.equal(kinds.filter(k => k === 'program').length, 1);
  t += 31 * 60_000;
  assert.equal(c.claimConfirmation(c.getSnapshot().messages.findIndex(m => m.kind === 'program')), null); // expired
});
