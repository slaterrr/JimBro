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
