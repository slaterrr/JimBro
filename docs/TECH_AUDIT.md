# Technical audit: loading performance and nuances

2026-11-14 night, on `main` at `fca85e0`. Every number below was measured in this session (web export,
`curl` against the real CDNs, Playwright on Chrome). Nothing is estimated unless it says so.

## 1. What a user downloads

| Asset | Size on disk | Over the wire | When |
|---|---|---|---|
| **Pose WASM** `vision_wasm_internal.wasm` (jsDelivr) | 14.7 MB | **3.3 MB** (brotli) | every Coach screen open (see 2.1) |
| **Pose model** `pose_landmarker_lite.task` (Google Storage) | 5.8 MB | **5.8 MB** (not compressible) | every Coach screen open; HTTP cache only 1 hour |
| `vision_bundle.mjs` | 156 KB | not measured | every Coach open |
| Web JS bundle | 1.44 MB | 457 KB gzip | app start (web) |
| `MaterialCommunityIcons.ttf` | **1.31 MB** | ~1.3 MB (fonts barely compress) | app start (web); built into Expo Go |
| `assets/jim-mascot.png` | **844 KB**, 1513×1039 px | 844 KB | app start: Login, Home, comparison results |
| 18 other icon fonts | ~3.0 MB | 0 (exported, never requested) | never; only inflates the web export |

**Camera first open: about 9.1 MB over the network before the first rep can be counted.**

### Measured web start (Playwright, iPhone-sized, demo user)
| Network | UI usable | Network idle | First paint |
|---|---|---|---|
| Local, no throttle | 222 ms | 726 ms | 256 ms |
| Simulated 4G (9 Mbps, 60 ms) | **1.6 s** | **4.1 s** | 1.6 s |

The test server sends files uncompressed, so the 4G figure is pessimistic for the JS bundle (Expo
hosting and Render gzip it). The three biggest start-up requests are the JS bundle, the 1.3 MB icon
font and the 844 KB mascot. The font and the mascot account for about half the bytes.

## 2. What slows loading down (ranked by impact)

### 2.1 Coach: the pose engine is rebuilt on every visit (biggest)
- `App.jsx` renders only the active tab (`tab === 'Coach' ? <CoachScreen/> : …`), so leaving Coach
  **unmounts the WebView**. Coming back re-creates it: re-import of the vision bundle, WASM compile
  and model init on every visit. Even when the files are cached, WASM compile + GPU/CPU delegate init
  usually takes a few seconds on a phone (not measured on a device yet).
- The model URL has `Cache-Control: max-age=3600`: after an hour the 5.8 MB model downloads again.
- Loading is serial in `poseHtml.js main()`: `startCamera()` → then `import(vision_bundle)` → then
  WASM → then model. The downloads don't start until the camera permission/stream is up.
- GPU delegate is tried first, then CPU on failure. On Android WebViews GPU often fails, so the
  model is initialized twice in that case.

**Fixes:** keep `CoachScreen` mounted after its first visit (hide it with `display: none` instead of
unmounting); start `import()`/`forVisionTasks`/model fetch in parallel with `getUserMedia`; ship the
model with the app (bundled asset or app-hosted URL with a long `max-age`, e.g. on the Render proxy)
instead of the 1-hour Google Storage URL; remember which delegate worked (`localStorage` in the page).

### 2.2 The mascot image is 6× bigger than needed
1513×1039 PNG (844 KB) drawn at 140–260 px. On phones it also decodes to ~6 MB of bitmap memory
(1513×1039×4 bytes) each place it is used. **Fix:** export a 512 px-wide WebP/PNG (expect well under
100 KB) plus @2x/@3x if wanted.

### 2.3 Icon font: one 1.31 MB font for ~40 icons (web)
On web the whole MaterialCommunityIcons font loads before icons render (icons pop in late). Expo Go
has the font built in, so phones are not affected; an EAS dev/production build is. **Fix (web/EAS):**
a small SVG icon set for the icons actually used, or `createIconSetFromIcoMoon` with a subset font.
Also exclude the 18 unused fonts from the export.

### 2.4 Start-up waits on two sequential storage reads, with a blank screen
`App.jsx` reads the session, then `AppProvider` reads the account's data; the app renders `null` until
both finish. There is no splash or icon in `app.json` (Expo defaults). Fast on phones, but the
first frame is empty. **Fix:** configure `expo-splash-screen` and hide it after `ready`.

### 2.5 Smaller costs
- `HomeScreen` recomputes `healthSummary(...)` on every render, including every keystroke in the
  chat box (no `useMemo`; the screen has zero memoization). Cheap today, grows with history.
- `AppState` re-serializes the whole history to AsyncStorage on every change. Per set this is small
  (camera sets store ~10 numbers per rep, no landmarks), so this is fine for months of use. Android's
  AsyncStorage still has a ~2 MB per-value read limit; one key per account holds everything.

## 3. Nuances and risks (not speed)

| # | Finding | Why it matters | Suggested fix |
|---|---|---|---|
| N1 | **App gives up on a chat after 12 s; the proxy allows 30 s per Claude call, retries once, and can call Claude several times in a tool loop.** | Slow answers fall back to the offline coach on the phone while the server keeps spending tokens and then throws the answer away. | Pass a deadline to the proxy (e.g. 11 s total) or raise the app timeout to ~25 s with a "Jim is thinking…" state. |
| N2 | **Rate limit is per IP, 20 requests/min.** Behind Render's proxy `remoteAddress` is Render's address unless a trusted forwarded header is used (`TRUST_CLOUDFLARE_IP` only covers Cloudflare). | During judging every phone may share one bucket: the 21st message in a minute from the whole room gets "slow down". | Trust `x-forwarded-for` (first hop) when an env flag says the proxy is behind Render; or key the bucket on `X-Jim-Key` + IP. |
| N3 | `EXPO_PUBLIC_JIM_PROXY_KEY` is compiled into the app. | Anyone with the app can pull the key and use the proxy. Fine for a hackathon. | Keep a spend limit on the Anthropic key; per-account tokens after the hackathon. |
| N4 | Login moved data to `jimbro.data.v2:<email>`. The old `jimbro.data.v2` key is never migrated. | Anyone who used the app before #65 sees an empty account after signing up. | One-time: when the first account is created and the legacy key exists, offer to move it in. |
| N5 | Passwords use one round of salted SHA-256, accounts live on one phone. | Fine against casual access; weak against someone who copies the phone's storage. Accounts don't sync between phones. | PBKDF2/scrypt with many rounds (fine in JS for one login), or server accounts later (the Python `backend/jimbro/v2` store already has users/tokens tables). |
| N6 | Free Render instances sleep after ~15 min idle. | The first chat after a break can take 30–60 s. Home now pings `/health` on open, but a chat sent within the first seconds can still hit N1's 12 s cutoff. | Open `/health` a minute before the demo (in `docs/DEMO.md`), or a paid instance during judging. |
| N7 | Camera page and model come from third-party CDNs at runtime. | No internet (gym basements) = no camera counting, even on a second visit after the 1-hour cache expires. | Same as 2.1: ship the model and WASM with the app or host them with long caching. |
| N8 | 18 unused icon fonts are part of the web export (~3 MB). | Bigger deploys and EAS update uploads; not downloaded by users. | Use only `MaterialCommunityIcons` via a direct import path or subset. |

## 4. What is in good shape
- Coach screen updates React state only when the count, tracking state or hint changes, not on
  every frame (`setView` guard), so 20 fps landmark messages don't re-render the screen 20×/s.
- Stored set data is compact (no landmarks or video persisted), so storage growth is slow.
- WASM is served `immutable` with a 1-year cache by jsDelivr (only the model has the 1-hour cache).
- Tests: app 603, proxy 46, vision-lab 51, 16 Playwright journeys, UI smoke on 320/390 px; all on CI.

## 5. Recommended order (before judging)
1. **2.1 keep Coach mounted** + parallel model download: largest user-visible win, ~20 lines.
2. **2.2 shrink the mascot** to ≤100 KB.
3. **N1 align timeouts** so real Claude answers aren't thrown away.
4. **N2 rate-limit key** if the proxy is on Render for judging.
5. 2.4 splash screen; 2.3/N8 icon fonts (web only) after the hackathon.
