#!/usr/bin/env bash
# Smoke-test the USB bundle on emulated Raspberry Pi OS (Debian bookworm, arm64).
#
#   scripts/build_usb.sh && scripts/smoke_pi_container.sh [BUNDLE_DIR]
#
# Runs the real install.sh. Containers have no systemd, so a stand-in `systemctl`
# launches jimbro.service's ExecStart line; then HTTPS, the PWA, the API and the live
# websocket are exercised. Needs Docker with arm64 emulation (Docker Desktop has it).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="${1:-$ROOT/build/jimbro-usb}"
[ -f "$BUNDLE/install.sh" ] || { echo "no bundle at $BUNDLE (run scripts/build_usb.sh)" >&2; exit 1; }
# Git Bash on Windows: stop MSYS rewriting /usb into a Windows path.
export MSYS_NO_PATHCONV=1

docker run --rm --platform linux/arm64 -v "$(cd "$BUNDLE" && pwd -W 2>/dev/null || pwd):/usb:ro" \
  debian:bookworm bash -euc '
apt-get update -qq >/dev/null
# Mirror Raspberry Pi OS Lite: no python3-venv / ensurepip, no desktop.
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 openssl curl ca-certificates avahi-daemon >/dev/null
cat > /usr/local/bin/systemctl <<"EOF"
#!/bin/sh
# Stand-in for systemd inside the container: start jimbro.service on enable/restart.
case "$*" in
  *jimbro-button*) exit 0 ;;
  *restart*jimbro.service*|*enable*jimbro.service*)
    pkill -f "uvicorn jimbro.api" 2>/dev/null || true
    set -a; . /etc/jimbro/jimbro.env; set +a
    # Join ExecStart plus any backslash-continued lines (single- or multi-line units).
    cmd=$(awk "/^ExecStart=/{f=1} f{sub(/^ExecStart=/,\"\"); c=sub(/\\\\\$/,\"\"); printf \"%s \", \$0; if(!c) exit}" /etc/systemd/system/jimbro.service)
    cmd=$(eval echo "$cmd")
    cd /opt/jimbro/app && su -s /bin/sh jimbro -c "$cmd > /tmp/jimbro.log 2>&1 &"
    ;;
esac
exit 0
EOF
chmod +x /usr/local/bin/systemctl
printf "#!/bin/sh\nexit 0\n" > /usr/local/bin/hostnamectl; chmod +x /usr/local/bin/hostnamectl
cp -R /usb /tmp/bundle
bash /tmp/bundle/install.sh --headless --no-button > /tmp/install.log 2>&1 || { cat /tmp/install.log; exit 1; }
grep -v "^\s*$" /tmp/install.log | tail -8
if grep -q "trying the internet" /tmp/install.log; then echo "FAIL: offline install fell back to the internet"; exit 1; fi
test ! -e /home/*/.config/autostart/jimbro-station.desktop && echo "headless: no kiosk installed"
echo "--- checks"
B=https://127.0.0.1
curl -fsk $B/health; echo
curl -fsk $B/ | grep -q "<div id=\"root\">" && echo "PWA served"
curl -fsk $B/station | grep -q "<div id=\"root\">" && echo "station route served"
curl -fskI $B/mediapipe/pose_landmarker_lite.task | grep -qi "200" && echo "pose model served offline"
sid=$(curl -fsk -XPOST $B/v1/sessions -H "content-type: application/json" -d "{}" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"id\"])")
curl -fsk -XPOST $B/v1/sets/smoke1/complete -H "content-type: application/json" \
  -d "{\"session_id\":\"$sid\",\"exercise\":\"curl\",\"weight\":10,\"unit\":\"kg\",\"reps\":8,\"rpe\":7,\"source\":\"manual\",\"reps_detail\":[]}" >/dev/null && echo "set logged"
curl -fsk $B/v1/sessions/$sid/summary | python3 -c "import sys,json;d=json.load(sys.stdin);assert d[\"total_reps\"]==8;print(\"summary ok\")"
curl -fsk -XPOST $B/v1/coach -H "content-type: application/json" -d "{\"message\":\"next?\",\"tone\":\"hard\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(\"coach:\",d[\"source\"],\"-\",d[\"text\"][:60])"
/opt/jimbro/venv/bin/python - <<"PY"
import asyncio, json, ssl, websockets
async def main():
    ctx = ssl._create_unverified_context()
    async with websockets.connect("wss://127.0.0.1/v1/live/curl", ssl=ctx) as ws:
        print("websocket:", json.loads(await ws.recv())["type"])
asyncio.run(main())
PY
test -s /var/lib/jimbro/jimbro.db && echo "db persisted at /var/lib/jimbro/jimbro.db"
curl -fs http://127.0.0.1:8080/v1/exercises | grep -q curl && echo "plain-HTTP API for Expo Go on :8080"
/opt/jimbro/venv/bin/python - <<"PY"
import asyncio, json, ssl, urllib.request, websockets
async def main():
    # Expo Go listens over HTTP while the PWA posts over HTTPS: one process, one event bus.
    async with websockets.connect("ws://127.0.0.1:8080/v1/station") as st:
        await st.recv()
        ctx = ssl._create_unverified_context()
        urllib.request.urlopen(urllib.request.Request("https://127.0.0.1/v1/station/button", method="POST", data=b""), context=ctx)
        print("cross-listener event:", json.loads(await asyncio.wait_for(st.recv(), 5))["type"])
asyncio.run(main())
PY
echo "--- nightly backup + mdns"
set -a; . /etc/jimbro/jimbro.env; set +a
cmd=$(sed -n "s/^ExecStart=//p" /etc/systemd/system/jimbro-backup.service)
su -s /bin/sh jimbro -c "PYTHONPATH=/opt/jimbro/app/backend JIMBRO_DB=$JIMBRO_DB $cmd" >/dev/null
ls /var/lib/jimbro/backups/jimbro-*.db >/dev/null && echo "nightly backup command works"
grep -q "<port>443</port>" /etc/avahi/services/jimbro.service && echo "mdns service advertised"
echo "--- usb stick hook"
mkdir -p /tmp/stick && cp -R /usb /tmp/stick/jimbro-usb
bash /opt/jimbro/app/usb-hook.sh --mounted /tmp/stick > /tmp/hook1.log 2>&1
ls /tmp/stick/jimbro-backups/jimbro-*.db >/dev/null && echo "stick: backup written"
grep -q "\"ok\":true" /tmp/stick/jimbro-status.txt && echo "stick: status file says healthy"
grep -q "updating" /tmp/hook1.log && { echo "FAIL: same version must not reinstall"; exit 1; }
echo smoke-newer > /tmp/stick/jimbro-usb/VERSION; echo smoke-newer > /tmp/stick/jimbro-usb/app/VERSION
bash /opt/jimbro/app/usb-hook.sh --mounted /tmp/stick > /tmp/hook2.log 2>&1
grep -q "update ok" /tmp/hook2.log && [ "$(cat /opt/jimbro/app/VERSION)" = smoke-newer ] && echo "stick: newer bundle auto-installed"
curl -fsk $B/v1/status | grep -q "smoke-newer" && echo "status reports new version"
curl -fsk $B/v1/sessions/$sid/summary >/dev/null && echo "data survived the update"
echo SMOKE_OK
'
