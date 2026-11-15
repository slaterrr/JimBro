import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeStartup, clientAddress } from './httpSecurity.js';

describe('network boundary', () => {
  it('never trusts a spoofable Cloudflare header by default', () => {
    assert.equal(clientAddress({ 'cf-connecting-ip': '1.2.3.4' }, '10.0.0.5'), '10.0.0.5');
  });
  it('only uses Cloudflare forwarding when explicitly configured', () => {
    assert.equal(clientAddress({ 'cf-connecting-ip': '1.2.3.4' }, '10.0.0.5', { trustCloudflare: true }), '1.2.3.4');
    assert.equal(clientAddress({ 'cf-connecting-ip': 'attacker, 1.2.3.4' }, '10.0.0.5', { trustCloudflare: true }), '10.0.0.5');
  });
  it('fails closed for production without the shared key', () => {
    assert.throws(() => assertSafeStartup({ NODE_ENV: 'production' }), /JIM_PROXY_KEY/);
    assert.doesNotThrow(() => assertSafeStartup({ NODE_ENV: 'development' }));
    assert.doesNotThrow(() => assertSafeStartup({ NODE_ENV: 'production', JIM_PROXY_KEY: 'set' }));
  });
});
