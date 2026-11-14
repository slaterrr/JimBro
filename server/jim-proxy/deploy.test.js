// The proxy must be hostable so phones off the laptop's Wi-Fi (judges, teammates) get real AI Jim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

const blueprint = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');

it('render.yaml runs the proxy from server/jim-proxy with a health check', () => {
  assert.match(blueprint, /rootDir: server\/jim-proxy/);
  assert.match(blueprint, /startCommand: npm start/);
  assert.match(blueprint, /healthCheckPath: \/health/);
});

it('secrets are entered in the dashboard, never committed', () => {
  for (const k of ['ANTHROPIC_API_KEY', 'JIM_PROXY_KEY']) assert.match(blueprint, new RegExp(`key: ${k}\s+sync: false`));
  assert.doesNotMatch(blueprint, /sk-ant-/);
});
