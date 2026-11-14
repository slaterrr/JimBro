# JimBro

JimBro is a hackathon exercise tracker: your **phone** watches you lift and counts reps,
a **Raspberry Pi** stores your workouts and shows live reps on a station display, and
**Jim**, the coach, suggests your next set in one of four tones. See the
[feature register](docs/FEATURES.md) for what is built vs. planned.

## What works
- **Live rep counting** for curl, squat and shoulder press: pose detection on the phone
  (MediaPipe), only joint angles are sent to the Pi, which counts reps with hysteresis and
  reports per-rep up / hold / down timing (estimated TUT).
- **Workout log** for six lifts (curl, squat, bench, deadlift, shoulder press, pull-up):
  camera, manual or voice entry; kg/lb and RPE explicit; offline-safe retries (idempotent set IDs).
- **Jim** (Direct / Friendly / Silly / Hard): code computes facts and a bounded (≤5%) next-set
  suggestion; Claude only phrases it when an API key is set; an offline coach always works;
  pain/injury mentions get a fixed safety reply in every tone.
- **Push-to-talk set logging** ("10 curls at 20 pounds RPE 7") with confirmation before saving.
- **Plans** constrained by goal, days/week, minutes and equipment.
- **Progress** trends per exercise (units never mixed), **opt-in weekly leaderboard** with
  labeled demo athletes, and a full-screen **Pi station** (`/station`) with optional GPIO button.
- **Evidence tooling**: export angle traces with ground-truth counts and replay them
  (`python -m jimbro.evaluate`). See [docs/EVIDENCE.md](docs/EVIDENCE.md).

## Architecture
```
 Phone (PWA, HTTPS)                         Raspberry Pi 4 (from the USB bundle)
 ┌───────────────────────────┐   angles    ┌──────────────────────────────────────┐
 │ camera → MediaPipe pose   │ ──────────▶ │ FastAPI  /v1/live/{movement} (WS)    │
 │ (video never leaves phone)│ ◀────────── │   RepCounter → rep events ─┐         │
 │ Train / Log / Progress /  │  rep events │ /v1/sets, /v1/sessions     │ EventBus│
 │ Jim tabs, offline queue   │ ──REST────▶ │ SQLite (WAL)               ▼         │
 └───────────────────────────┘             │ /v1/station (WS) → Chromium kiosk    │
                                           │ Jim: rules + optional Claude API     │
                                           └──────────────────────────────────────┘
```

## Put it on the Pi (USB stick)
Requirements: Raspberry Pi 4/5 with **64-bit Raspberry Pi OS (bookworm or newer)**, on the
same Wi-Fi as your phone. On your computer (Node 20+, Python 3.11+):

```bash
scripts/build_usb.sh                    # → build/jimbro-usb (~35 MB)
```

Copy `build/jimbro-usb` to a USB stick, plug it into the Pi, and on the Pi run:

```bash
sudo bash /media/$USER/<stick>/jimbro-usb/install.sh --hostname jimbro
```

The installer works offline, copies the app to `/opt/jimbro`, keeps data in
`/var/lib/jimbro`, creates a self-signed HTTPS certificate (phones only allow the camera
over HTTPS), and enables services that start on every boot. Then:

1. On your phone open **https://jimbro.local** (or the IP the installer prints), accept the
   certificate warning once, and use *Add to Home Screen*.
2. The Pi's monitor opens the station display automatically at the next desktop login.
3. Optional AI wording for Jim: add `ANTHROPIC_API_KEY=...` to `/etc/jimbro/jimbro.env`, then
   `sudo systemctl restart jimbro`.
4. Optional button: wire a push button between GPIO17 (pin 11) and GND (pin 9).

Update by rebuilding and re-running `install.sh` (data and settings are kept). Remove with
`sudo bash uninstall.sh` (`--purge` also deletes data). Logs: `journalctl -u jimbro -f`.
`scripts/smoke_pi_container.sh` verifies a bundle on emulated arm64 bookworm via Docker.

## Develop
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
python -m pip install -e ".[dev]"
uvicorn jimbro.api:app --app-dir backend --reload   # API on :8000
cd apps/mobile && npm ci && npm run dev             # PWA on :5173, proxies /v1 to :8000
```
Quality gates (also in CI): `ruff check backend`, `ruff format --check backend`,
`mypy backend/jimbro`, `pytest --cov=backend/jimbro --cov-fail-under=90`, and in
`apps/mobile`: `npx tsc -b`, `npm test`, `npx vite build`. Desktop browsers allow the
camera on `localhost`; for a phone in dev use the Pi or an HTTPS tunnel.

## Threat model and privacy
- Raw video never leaves the phone and is never stored. Only joint angles, confidence and
  workout records reach the Pi. Traces are exported only when you press *Export*.
- The API is meant for a trusted home LAN: `X-Athlete-Id` separates household members but is
  **not authentication**. Don't expose port 443 to the internet.
- TLS is self-signed: it encrypts traffic on the LAN, but phones can't verify the Pi's
  identity until you accept the certificate.
- The service runs as an unprivileged `jimbro` user with a read-only filesystem except its data
  dir; the API key lives in a root-owned, group-readable env file.
- Jim's model output never changes numbers or records; suggestions are computed in code and
  voice-parsed sets require confirmation.

## Limitations (honest)
- Camera counting covers curl, squat and shoulder press only; bench, deadlift and pull-up are
  logged manually. Accuracy depends on camera angle, framing and light. **No real-world
  accuracy numbers are published yet**: record traces and run the evaluator.
- TUT is estimated movement-phase timing from threshold crossings, not muscle tension or force.
- Not a medical device; Jim can't assess injuries.
- First phone load needs the Pi; after that the app shell is cached, and sets queue offline.
