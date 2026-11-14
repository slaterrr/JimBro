# JimBro

JimBro uses your phone camera to count reps, log workouts, and help plan your next session.

## Shared team preview

[![Shared preview QR](docs/testing/preview-qr.svg)](https://expo.dev/accounts/slaterr/projects/jimbro/branches/preview)

Scan with your phone camera to open the persistent Expo preview page, then select the latest update. This is a dashboard QR, not a temporary laptop tunnel or a direct installation QR. Sign in if prompted.

[Open latest preview](https://expo.dev/accounts/slaterr/projects/jimbro/branches/preview) · [Install a build](https://expo.dev/accounts/slaterr/projects/jimbro/builds) · [CI status](https://github.com/slaterrr/JimBro/actions/workflows/ci.yml)

Install a compatible preview build on each phone once. It receives the `preview` channel without a laptop server. After publishing, launch the app to download the update, then fully close and reopen it to apply it. Default behavior can require two launches. Each phone keeps its own workout records.

### One-time activation

The Expo project is linked. Add an Expo access token as the GitHub Actions repository secret `expo_access_token`. Never put tokens in source code or chat. Create and install the first preview build:

```bash
cd apps/expo
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
# For iPhones use --platform ios; Apple signing and registered devices are required.
```

Follow build prompts for application identifiers and signing. JavaScript updates cannot add native modules to an installed build. Rebuild after native dependency/configuration changes and increase the app version when changing the native runtime. Updates use the `appVersion` runtime policy.

## Team workflow

1. Branch from current main, develop locally, and open a pull request.
2. Pass CI and review, then merge into main.
3. The main CI run publishes to `preview` only after all quality jobs pass. PRs never publish to this shared channel.
4. Check Actions and the preview page, then reopen the installed app.

EAS Update publishes JavaScript and bundled assets. The optional AI proxy is deployed separately; updates do not synchronize workout data.

## Local development

Use Node.js 22 and compatible Expo Go:

```bash
git clone https://github.com/slaterrr/JimBro.git
cd JimBro/apps/expo
npm ci
npx expo start --tunnel
```

Scan the terminal QR in Expo Go. For this development path the host laptop must remain awake.

## Features

- Camera counting for curls, squats, shoulder presses and push-ups; manual logging for other supported lifts.
- Workout history, records, strength/volume comparisons, export and import.
- Goal-based plans, rest guidance, and offline coaching.
- Optional Claude conversation through [Jim's proxy](server/jim-proxy/README.md). Without a proxy URL, coaching stays offline.

Camera processing stays on the phone. Optional AI sends text context; optional physique-photo analysis requires explicit consent. Accuracy depends on framing, angle and lighting. Simulated results and real-video evidence are separate. TUT estimates movement timing; Jim cannot assess injuries.

## Repository and validation

- `apps/expo`: primary phone app. Run `npm test` and `npx expo export --platform android --platform ios` there.
- `tools/vision-lab`: vision regression tooling; `npm ci && npm test`.
- `server/jim-proxy`: optional AI service; `npm ci && npm test`.
- `frontend`: browser CV development and validation tools.
- `apps/mobile` and `backend`: earlier browser/API implementation, retained with CI checks.

See [app details](apps/expo/README.md), [audit](docs/AUDIT.md), and [evidence](docs/EVIDENCE.md). CI also checks backend lint/types/coverage and the earlier browser app's tests/build.
