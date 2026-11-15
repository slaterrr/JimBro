import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyStatusLine } from './aiStatus.js';

test('no proxy configured: says the AI is not connected, never that it failed to answer', () => {
  assert.equal(proxyStatusLine({ configured: false, state: 'off' }, 'offline'), 'Offline coach · AI service not connected');
});
test('a configured proxy that failed the last chat says so', () => {
  assert.equal(proxyStatusLine({ configured: true, state: 'ok' }, 'offline'), 'Offline coach · Jim AI did not answer the last message');
});
test('connecting, connected, timeout, unreachable', () => {
  assert.match(proxyStatusLine({ configured: true, state: 'checking' }, 'ai'), /Connecting/);
  assert.equal(proxyStatusLine({ configured: true, state: 'ok' }, 'ai'), 'Connected to Jim AI');
  assert.match(proxyStatusLine({ configured: true, state: 'off', reason: 'timeout' }, 'ai'), /too long/);
  assert.match(proxyStatusLine({ configured: true, state: 'off', reason: 'unreachable' }, 'ai'), /unreachable/);
});
