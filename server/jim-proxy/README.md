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

Optional env: `PORT` (8787), `ALLOW_ORIGIN` (CORS, default `*`).

## API

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

The persona prompt, safety regex and exercise list are imported from `apps/expo/src/lib`, so the
server must run from this repo checkout (Node 20.19+ or 22+).

## Test

```sh
npm test
```

The tests mock the Anthropic SDK client; they make no network calls and need no key.

## Limits

- The rate limit is per process memory; behind several instances or a proxy that hides client IPs
  it is weaker. `cf-connecting-ip` is honoured if present.
- No auth: anyone who has the URL can use your key up to the rate limit. Keep it on a LAN or add a
  shared secret before exposing it publicly.
- `handleChat` in `jim.js` only needs an object with `messages.create`, so a Cloudflare Worker
  wrapper is straightforward, but one is not included.
