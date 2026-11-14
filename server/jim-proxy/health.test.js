// /health: GET and HEAD both answer 200 (HEAD without a body); nothing secret in the reply.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { healthReply } from './health.js';

describe('health', () => {
  it('answers GET with ok', () => {
    assert.deepEqual(healthReply('GET', '/health'), { status: 200, body: { ok: true }, head: false });
  });
  it('answers HEAD with no body', () => {
    assert.deepEqual(healthReply('HEAD', '/health'), { status: 200, body: { ok: true }, head: true });
  });
  it('ignores other routes and methods', () => {
    assert.equal(healthReply('POST', '/health'), null);
    assert.equal(healthReply('GET', '/chat'), null);
  });
  it('leaks no secrets or env', () => {
    const saved = { k: process.env.JIM_PROXY_KEY, a: process.env.ANTHROPIC_API_KEY };
    process.env.JIM_PROXY_KEY = 'sekrit-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-sekrit';
    try {
      const reply = healthReply('GET', '/health');
      assert.ok(!JSON.stringify(reply).includes('sekrit'));
      assert.deepEqual(Object.keys(reply.body), ['ok']);
    } finally {
      for (const [name, v] of [['JIM_PROXY_KEY', saved.k], ['ANTHROPIC_API_KEY', saved.a]]) {
        if (v === undefined) delete process.env[name]; else process.env[name] = v;
      }
    }
  });
});
