// Build a test-only bundle pointed at the SDK fixture, then run production-HTTP E2E checks.
// No production key, proxy endpoint, mock workout seed or camera recording enters app code.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', CI: '1', EXPO_PUBLIC_JIM_PROXY_URL: 'http://127.0.0.1:8787', EXPO_PUBLIC_JIM_PROXY_KEY: 'e2e-jim-key' };
for (const args of [
  ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', 'dist-chat'],
  ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/chat-mvp.config.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
