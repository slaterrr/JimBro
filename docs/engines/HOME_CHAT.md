# Home conversation integration

Home uses the merged engine from PR #47 (`feat/engines`), not the earlier on-device
model experiment. The existing `askJim`, context builder, proposal validator,
mission planner and performance answers remain authoritative. No model or CV
algorithm was replaced.

## Experience

- The initial greeting and Start a Workout / Create a New Plan / Review My Progress
  actions remain. The bottom composer sends chat and keyboard-dictated text.
- Conversation state lives in AppProvider memory, so navigation does not discard
  messages or a pending reply. Restarting the app clears chat. It is not stored in
  workout exports or a future workout database.
- Follow-ups pass prior text turns through `historyFor` to `POST /chat`, alongside
  current workout context. One send runs at a time across screen changes.
- New chat and Stop reply invalidate pending responses. Stop reply stops displaying
  the result; the server request can continue until its existing timeout.
- Persistent changes still require the engine's confirmation cards. Targets are
  validated again at confirmation time; rapid repeated confirmation taps are ignored.
- Local performance/mission answers are identified as local; only successful AI
  responses display Connected to Jim AI. Missing/erroring proxy shows offline status.
- Talk uses the existing speech engine and keyboard dictation. It is not streaming
  speech recognition or a wake-word listener. Leaving Home stops spoken output.

## Connect the real service

The repository's `.github/workflows/claude-smoke.yml` maps the GitHub Actions secret
`CLAUD_TOKEN` to server environment variable `ANTHROPIC_API_KEY`. This is a test job,
not an always-running chat API. GitHub cannot return an existing secret's value.

1. Run/deploy the existing `server/jim-proxy` from this repository. It imports shared
   app modules, so retain the repo structure. Use Node 22, install with
   `npm ci --prefix server/jim-proxy`, and start with `npm start --prefix server/jim-proxy`.
2. Set `ANTHROPIC_API_KEY` in that server's private environment. A deployment job can
   use `secrets.CLAUD_TOKEN` if authorized to deploy to the chosen host. Never copy it
   into app config, EXPO_PUBLIC variables, logs, or a committed file.
3. Set server `JIM_PROXY_KEY`; configure the matching app `EXPO_PUBLIC_JIM_PROXY_KEY`
   and set `EXPO_PUBLIC_JIM_PROXY_URL=https://<your-service>` (no `/chat` suffix).
   The shared app key is a prototype access gate, not private user authentication.
4. Verify GET /health, then send a Home message. Test a follow-up and confirm/cancel
   a log proposal. The AI connection label appears only after a successful response.

For a laptop service, use `npm run start:env` with a private `server/jim-proxy/.env`;
phones must be able to reach the LAN address or HTTPS tunnel. For an EAS update,
configure the app URL/key in the publishing environment; deploying an update does
not start the proxy.

## Verification

Unit tests cover retained turns, serialized sends, ignored late results, failures,
and proposal cards. Desktop Chrome checks use a mocked proxy and verify follow-up
history, navigation retention, confirmation/cancel, and New chat. Native exports
are build checks. They do not establish live Claude or physical-device voice quality.
