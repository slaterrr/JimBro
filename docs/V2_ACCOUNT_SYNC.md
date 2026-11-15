# v2 account/snapshot sync — integration status

This is an **incremental backend foundation**, not a completed mobile sync or production deployment.

## What is implemented

The existing Pi API remains unchanged. Under `/v2`, a separate API offers:

- `POST /v2/auth/register` with JSON `{ "email": "...", "password": "..." }`. Passwords are salted PBKDF2-HMAC-SHA256 digests in SQLite, not plaintext.
- `POST /v2/auth/login` returns a random short-lived bearer token; only its SHA-256 hash is stored on the server.
- `POST /v2/auth/logout` revokes the supplied token.
- `GET /v2/sync` returns `{ "revision": 0, "data": {} }` initially, authenticated by `Authorization: Bearer <token>`.
- `PUT /v2/sync` accepts `{ "revision": N, "data": {...} }` and requires an `Idempotency-Key` header. Retrying identical bytes and revision with the same key returns the previous result. A stale revision or same key with different payload returns HTTP 409. Limit is 1 MB of serialized snapshot JSON.
- Snapshots are private to the authenticated user ID derived from the bearer token, **never a user ID supplied in the request body**.

The server keeps its prior legacy Pi routes for backwards compatibility. The new SQLite table is append-only migration v2 and does not remove legacy records.

## Example

```bash
# Use HTTPS for an internet-facing deployment, never plain internet HTTP.
curl -X POST https://your-host/v2/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"choose-a-long-unique-password"}'
# Login, keep access_token in secure OS keychain or encrypted storage.
curl -X POST https://your-host/v2/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"choose-a-long-unique-password"}'
# With a real token, GET /v2/sync then PUT the new snapshot using its revision and a unique key.
```

## Before production launch

1. **DO NOT expose the legacy `/v1` Pi routes on the public internet.** They still accept a client-supplied athlete header and were designed for a local Pi.
2. Put `/v2` behind TLS and a gateway that enforces request size, distributed per-IP/account rate limits, abuse detection, email verification, recovery flows, token rotation/refresh and centralized spend controls.
3. The current Expo signup (`apps/expo/src/lib/auth.js`) is still **device-local** and is **not connected to this server API**.
4. Build an Expo sync adapter that stores tokens securely, persists a durable offline queue, uploads only after local saves, retries the same idempotency key, and merges 409 conflicts without losing either device's workouts.
5. For a live deployment, move from full-account snapshots to per-record sync and tombstones, with item-level ownership authorization. Full-snapshot revisions currently prevent silent lost updates but require a client conflict-reconciliation strategy.
6. No workouts, plans, or settings are synchronized between phones until the Expo adapter and actual host are configured and tested.
7. The schema migration does not migrate historical per-device data automatically: users will need an explicit, reviewed first-sync path that prevents destructive overwrites.
8. Confirm `JIMBRO_DB` points to persistent encrypted/appropriately backed-up storage. Keep secrets out of repository and logs.

## Tests

`pytest backend/tests/test_v2_accounts.py backend/tests/test_v2_routes.py backend/tests/test_v2_store.py`

These cover account isolation, login/logout, invalid credentials, revision conflict and idempotent retries. Check the GitHub backend-quality CI job for the actual current result.
