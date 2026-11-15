// CLI startup. Production HTTP code is shared with integration tests.
import Anthropic from '@anthropic-ai/sdk';
import { createJimServer } from './http.js';
import { assertSafeStartup } from './httpSecurity.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}
assertSafeStartup();
const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
const port = Number(process.env.PORT ?? 8787);
createJimServer({ client }).listen(port, () => console.log(`jim-proxy listening on :${port}`));
