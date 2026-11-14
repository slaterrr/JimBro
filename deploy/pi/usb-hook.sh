#!/usr/bin/env bash
# Runs when a USB stick is plugged into the headless Pi (jimbro-usb@.service via udev).
#
#   usb-hook.sh /dev/sda1           mount, act, unmount
#   usb-hook.sh --mounted DIR       act on an already-mounted directory (tests)
#
# On the stick it will, in order:
#   1. join Wi-Fi if jimbro-wifi.txt exists (lines: SSID=..., PASSWORD=...), then delete
#      the password file from the stick
#   2. update JimBro if jimbro-usb/ holds a different version than the one installed
#   3. back up the workout database to jimbro-backups/
#   4. write jimbro-status.txt (address, version, health) so you can read it on a laptop
# Set JIMBRO_USB_AUTOUPDATE=0 in /etc/jimbro/jimbro.env to disable step 2.
set -uo pipefail

ETC=/etc/jimbro
PREFIX=/opt/jimbro
LOG_TAG=jimbro-usb
log() { echo "$*"; logger -t "$LOG_TAG" -- "$*" 2>/dev/null || true; }

[ -f "$ETC/jimbro.env" ] && { set -a; . "$ETC/jimbro.env"; set +a; }
PORT="${JIMBRO_PORT:-443}"
DB="${JIMBRO_DB:-/var/lib/jimbro/jimbro.db}"

MNT=""
MOUNTED_BY_US=0
cleanup() {
  sync
  if [ "$MOUNTED_BY_US" -eq 1 ]; then
    umount "$MNT" 2>/dev/null && rmdir "$MNT" 2>/dev/null
    log "stick unmounted; safe to remove"
  fi
}
trap cleanup EXIT

if [ "${1:-}" = "--mounted" ]; then
  MNT="$2"
else
  DEV="${1:?usage: usb-hook.sh /dev/sdXN}"
  MNT="/run/jimbro-usb/$(basename "$DEV")"
  mkdir -p "$MNT"
  # uid/gid so the jimbro user can write backups on FAT/exFAT sticks
  opts="rw,nosuid,nodev,noexec,uid=$(id -u jimbro 2>/dev/null || echo 0),gid=$(id -g jimbro 2>/dev/null || echo 0)"
  if ! mount -o "$opts" "$DEV" "$MNT" 2>/dev/null && ! mount -o rw,nosuid,nodev,noexec "$DEV" "$MNT"; then
    log "could not mount $DEV"; rmdir "$MNT"; exit 1
  fi
  MOUNTED_BY_US=1
fi
log "stick at $MNT"

# 1. Wi-Fi ----------------------------------------------------------------------
if [ -f "$MNT/jimbro-wifi.txt" ] && command -v nmcli >/dev/null; then
  ssid="$(sed -n 's/^SSID=//p' "$MNT/jimbro-wifi.txt" | tr -d '\r' | head -1)"
  pass="$(sed -n 's/^PASSWORD=//p' "$MNT/jimbro-wifi.txt" | tr -d '\r' | head -1)"
  if [ -n "$ssid" ]; then
    if nmcli dev wifi connect "$ssid" ${pass:+password "$pass"} >/dev/null 2>&1; then
      log "joined Wi-Fi '$ssid'"
    else
      log "could not join Wi-Fi '$ssid'"
    fi
  fi
  rm -f "$MNT/jimbro-wifi.txt"   # don't leave the password lying on the stick
fi

# 2. Update -----------------------------------------------------------------------
installed="$(cat "$PREFIX/app/VERSION" 2>/dev/null || echo none)"
bundle="$MNT/jimbro-usb"
if [ -f "$bundle/install.sh" ] && [ "${JIMBRO_USB_AUTOUPDATE:-1}" = 1 ]; then
  offered="$(cat "$bundle/VERSION" 2>/dev/null || echo unknown)"
  if [ "$offered" != "$installed" ]; then
    log "updating JimBro $installed -> $offered"
    # Copy off the stick first: it is mounted noexec and may be pulled mid-install.
    tmp="$(mktemp -d)"
    cp -R "$bundle/." "$tmp/"
    if bash "$tmp/install.sh" --headless --port "$PORT" > "$tmp/install.log" 2>&1; then
      log "update ok"
    else
      log "update FAILED; see jimbro-install.log on the stick"
    fi
    cp "$tmp/install.log" "$MNT/jimbro-install.log" 2>/dev/null || true
    rm -rf "$tmp"
  fi
fi

# 3. Backup -----------------------------------------------------------------------
if [ -f "$DB" ]; then
  if out="$(PYTHONPATH="$PREFIX/app/backend" "$PREFIX/venv/bin/python" -m jimbro.backup backup "$DB" "$MNT/jimbro-backups" --keep 30 2>&1)"; then
    log "backup written: ${out##*/}"
  else
    log "backup FAILED: $out"
  fi
fi

# 4. Status file ------------------------------------------------------------------
status="$(curl -fsk --max-time 5 "https://127.0.0.1:$PORT/v1/status" 2>/dev/null || echo '{"ok": false, "error": "API not responding"}')"
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
suffix=""; [ "$PORT" = 443 ] || suffix=":$PORT"
cat > "$MNT/jimbro-status.txt" <<EOF
JimBro status  $(date '+%Y-%m-%d %H:%M:%S')
Open on your phone:  https://$(hostname).local$suffix   or   https://${ip:-<no network>}$suffix
Installed version:   $(cat "$PREFIX/app/VERSION" 2>/dev/null || echo none)
Health:              $status
Logs (over SSH):     journalctl -u jimbro -n 100
EOF
log "status written to jimbro-status.txt"
exit 0
