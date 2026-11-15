# jim-proxy

Tiny stateless Node server that lets Jim talk through Claude while the app keeps control of data.
It holds `ANTHROPIC_API_KEY` (the app never sees it) and stores nothing: no database, no logs of
message bodies.

## Run

```sh
cd server/jim-proxy
npm ci
ANTHROPIC_API_KEY=sk-ant-... node server.js        # listens on :8787 (PORT to change)
```

Point the app at it (phone and laptop on the same Wi-Fi, use the laptop's LAN IP):

```sh
cd apps/expo
EXPO_PUBLIC_JIM_PROXY_URL=http://192.168.1.20:8787 npx expo start
```

or set `expo.extra.jimProxyUrl` in `apps/expo/app.json`. With no URL, or if the proxy fails or
times out, the app falls back to its rule-based Jim, so the demo never breaks.

Optional env: `PORT` (8787), `ALLOW_ORIGIN` (CORS, default `*`), `TRUST_CLOUDFLARE_IP=1` only if all traffic is forced through verified Cloudflare ingress. In production (`NODE_ENV=production`), startup refuses to run without `JIM_PROXY_KEY`.

## API

**Opt-in plan personalization**: `POST /plan` with `{ request: { goal, days_per_week, minutes_per_session, equipment }, recentSets? }` returns `{ ok, plan, explanation }`. The model may only reorder exercises already in the deterministic plan; set counts, loads, reps, equipment and durations are local and immutable. A user explicitly presses **Personalize with Jim AI** on Home; ordinary plan editing uses no Claude tokens. Confirm **Save as my plan** before persistence. Auth and deployment restrictions match `/chat`. This endpoint is not a replacement for production user authentication or backend-owned history.


`POST /chat` with `{ messages: [{role, content}], context, persona }` returns
`{ reply, proposals: [intent], safety? }`. `GET /health` returns `{ ok: true }`.

- Model `claude-sonnet-5-5`, `max_tokens` 400, 30 s timeout, one retry.
- Read tools (`get_recent_sets`, `get_goal_progress`, `get_weekly_checkin`, `get_last_set_report`)
  are answered server-side from the `context` snapshot the app sends with each request.
- Write tools (`log_sets`, `correct_set`, `delete_set`) are never applied. They become proposals
  shaped exactly like `apps/expo/src/lib/intents.js` output; the app re-validates them and shows its
  confirm card.
- Pain, dizziness and similar messages get the app's fixed safety reply without calling the model
  (the app also checks this before any network call).
- Per-IP limit: 20 requests per minute (in memory). Bodies over 64 KB, more than 20 messages or
  messages over 2000 characters are rejected.

`POST /physique` with `{ consent: true, image: { media_type, data }, fitnessGoal, physiqueGoal, focusMuscles }`
returns `{ ok: true, emphasis: [{ muscle, reason }] }` or `{ ok: false, reason }`
(`not_physique`, `declined`, `no_proposal`, `no_valid_emphasis`).

- The image is a user-chosen reference photo (jpeg/png/webp, base64, at most 3.75 MB decoded;
  bodies up to ~5 MB on this route only, 413 otherwise). Requests without `consent: true` are rejected.
- It is held in memory for that one Claude request: never written to disk, never logged (errors log
  only the route and status), never returned.
- Claude must answer through the strict `propose_training_emphasis` tool; its free text is dropped.
  Muscles must be known ids and reasons that mention weight, fat, looks or health are removed. The
  app builds the weekly plan itself (`lib/planFromGoal.js`) and shows a confirm card.

The persona prompt, safety regex and exercise list are imported from `apps/expo/src/lib`, so the
server must run from this repo checkout (Node 20.19+ or 22+).

## Test

```sh
npm test
```

The tests mock the Anthropic SDK client; they make no network calls and need no key.

## Limits

- The rate limit is per process memory; behind several instances or a proxy that hides client IPs
  it is weaker. Incoming `cf-connecting-ip` is **not trusted by default** because a direct client can spoof it. Only set `TRUST_CLOUDFLARE_IP=1` behind restricted, verified Cloudflare ingress.
- Local development with no `JIM_PROXY_KEY` permits unauthenticated use. Production (`NODE_ENV=production`) now requires a shared secret. **This does not provide real user authentication**: `EXPO_PUBLIC_JIM_PROXY_KEY` is extractable from the bundle, and a caller can supply arbitrary context. Before public release, place this service behind an identity-aware backend that verifies per-user tokens, constructs authorized workout context from server-side storage, applies per-account quotas and distributed rate limits, and enforces a spend cap. Restrict direct access to the proxy.
- `handleChat` in `jim.js` only needs an object with `messages.create`, so a Cloudflare Worker
  wrapper is straightforward, but one is not included.

## Security, model and live check
- `JIM_PROXY_KEY`: set a shared secret; requests then need the `X-Jim-Key` header (the app sends
  `EXPO_PUBLIC_JIM_PROXY_KEY`). It keeps strangers on the network out; it is not user auth.
- `JIM_MODEL` (default `claude-sonnet-5-5`); `JIM_FALLBACKS=0` turns off server-side refusal fallbacks.
- **Live check:** `npm ci && npm run smoke` makes three real calls (plain reply, read tool, confirm-first
  proposal) and prints PASS/FAIL. It needs `ANTHROPIC_API_KEY` or an `ant auth login` profile, and costs a few cents.
- Full contract: `docs/engines/BACKEND_GUIDE.md`.

## Host it (so every phone gets AI Jim)
1. Render: **New > Blueprint**, pick this repo; it reads `render.yaml`. Enter `ANTHROPIC_API_KEY`
   and a long random `JIM_PROXY_KEY` when prompted (dashboard only, never git). Set a spend limit on the key.
2. Check `https://<service>.onrender.com/health` returns `{"ok":true}`.
3. In expo.dev > project > Environment variables > `preview`: set `EXPO_PUBLIC_JIM_PROXY_URL` to the
   service URL and `EXPO_PUBLIC_JIM_PROXY_KEY` to the same key. The next `main` push publishes it.
4. On a phone, the Home badge reads **AI** instead of **offline**. Free instances sleep after ~15 min idle;
   open `/health` a minute before demoing.

## Deployment security checklist

- [ ] Keep `ANTHROPIC_API_KEY` only in the hosting secret store, never Expo env or GitHub.
- [ ] Require verified user identity at a trusted API gateway or application backend before granting public access. A bundled shared key is not authentication.
- [ ] Build workout context from the authenticated user's records on the backend; do not trust user identifiers or activity supplied in a request body.
- [ ] Enforce per-user and global AI spend, token, and request quotas at the gateway; the current IP limiter is a single-instance local backstop.
- [ ] Use HTTPS; restrict the proxy ingress so unauthorized clients cannot bypass the gateway. A CORS allowlist alone is not access control.
- [ ] Verify the on-device AI response and confirmation flow with live sessions before launch.
