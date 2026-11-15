import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatAction, validateAction, toolReceipts } from './chatActions.js';

test('chat opens existing features without leaving the conversation', () => {
  assert.deepEqual(chatAction('Start a workout'), { type: 'show_panel', panel: 'camera' });
  assert.deepEqual(chatAction('Track my squats with the camera'), { type: 'show_panel', panel: 'camera', exercise: 'squat' });
  assert.equal(chatAction('Review my progress').panel, 'progress');
  assert.equal(chatAction('Show my muscles').panel, 'muscles');
  assert.equal(chatAction('Create a new plan').panel, 'plan');
  assert.equal(chatAction('Import my workouts').panel, 'import');
  assert.equal(chatAction('How was my last set?'), null);
  assert.equal(chatAction('my knee hurts, start the camera'), null);
});

test('model actions cannot open arbitrary screens, URLs or unsupported camera modes', () => {
  assert.equal(validateAction({ type: 'fetch', url: 'https://example.com' }), null);
  assert.equal(validateAction({ type: 'show_panel', panel: 'shell' }), null);
  assert.equal(validateAction({ type: 'show_panel', panel: 'camera', exercise: 'bench_press' }), null);
  assert.equal(validateAction({ type: 'show_panel', panel: 'progress', execute: 'oops' }), null);
  assert.deepEqual(validateAction({ type: 'show_panel', panel: 'camera', exercise: 'squat' }), { type: 'show_panel', panel: 'camera', exercise: 'squat' });
});

test('tool receipts allow only known tool names, outcomes and a bounded count', () => {
  const receipts = toolReceipts([{ name: 'get_live_session', status: 'completed', secret: 'never forward' }, { name: 'eval', status: 'completed' }, { name: 'log_sets', status: 'proposed' }]);
  assert.deepEqual(receipts, [{ name: 'get_live_session', status: 'completed' }, { name: 'log_sets', status: 'proposed' }]);
  assert.deepEqual(toolReceipts(null), []);
});
