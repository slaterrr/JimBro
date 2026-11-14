# JimBro on a Raspberry Pi (paused)

The first version of JimBro was a browser app (`apps/mobile`) that sent joint angles to a
Raspberry Pi server (`backend/`), which counted reps and drove a station display. The team paused
this direction: the phone app in `apps/expo` now does everything on the phone. The Pi code is
kept and tested; these are its instructions, unchanged.

API contract: [API.md](API.md) · Feature register for that version: [FEATURES.md](FEATURES.md) · Evidence tooling: [EVIDENCE.md](EVIDENCE.md).

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

## Headless Pi (no monitor, keyboard or SSH)
Works on **Raspberry Pi OS Lite**; nothing on the Pi needs internet.

**Zero-touch first boot.** In Raspberry Pi Imager pick 64-bit Raspberry Pi OS (Lite), open
*Edit settings* and set username, Wi-Fi and SSH, then write the card. Leave it in your
computer and run:
```bash
scripts/build_usb.sh
python scripts/prepare_sd.py E:\ --hostname jimbro      # the card's "bootfs" drive
```
Put the card in the Pi and power on. A few minutes later open **https://jimbro.local**
(first-boot log: `/var/log/jimbro-firstboot.log`).

**The USB stick is the remote control.** Plug in a stick at any time and the Pi will:
- install a newer `jimbro-usb/` bundle if the stick has one (data and settings kept),
- back up the workout database to `jimbro-backups/` (keeps 30),
- write `jimbro-status.txt`: the phone address, version and health; read it on any laptop,
- join Wi-Fi from `jimbro-wifi.txt` (`SSID=...` / `PASSWORD=...`), then delete that file.

The stick unmounts itself when done (watch the `jimbro-status.txt` timestamp). Also on the Pi:
nightly backups to `/var/lib/jimbro/backups` (keeps 14), mDNS advertising, and
`https://jimbro.local/v1/status` for a health check from your phone. The station display
works from any browser at `/station`. Disable stick auto-updates with
`JIMBRO_USB_AUTOUPDATE=0` in `/etc/jimbro/jimbro.env`. Anyone with physical access can update
the Pi this way, the same as swapping its SD card.

Restore a backup over SSH:
`sudo -u jimbro PYTHONPATH=/opt/jimbro/app/backend /opt/jimbro/venv/bin/python -m jimbro.backup restore <snapshot.db> /var/lib/jimbro/jimbro.db`,
then `sudo systemctl restart jimbro`.

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
- `GET /v1/export` and `DELETE /v1/athletes/me?confirm=true` let each athlete take or erase
  their data.
- The API is meant for a trusted home LAN: `X-Athlete-Id` separates household members but is
  **not authentication**. Don't expose port 443 to the internet.
- TLS is self-signed: it encrypts traffic on the LAN, but phones can't verify the Pi's
  identity until you accept the certificate.
- The service runs as an unprivileged `jimbro` user with a read-only filesystem except its data
  dir; the API key lives in a root-owned, group-readable env file.
- Jim's model output never changes numbers or records; suggestions are computed in code and
  voice-parsed sets require confirmation.

## Pi limitations
- Camera counting in the Pi version covers curl, squat and shoulder press; bench, deadlift and
  pull-up are logged manually.
- First phone load needs the Pi; after that the app shell is cached, and sets queue offline.
- The Pi version's opt-in weekly leaderboard (`backend/`, `apps/mobile`) is not in the phone app.
