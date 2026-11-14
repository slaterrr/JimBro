#!/usr/bin/env bash
# Install (or update) JimBro on a Raspberry Pi from the USB bundle. Safe to re-run.
#
#   sudo bash install.sh [--hostname jimbro] [--port 443] [--data-dir /var/lib/jimbro]
#                        [--no-kiosk] [--no-button]
#
# After install the Pi runs everything on boot:
#   * jimbro.service        API + PWA over HTTPS (phones need HTTPS for the camera)
#   * jimbro-button.service optional GPIO17 push button
#   * station kiosk         full-screen rep display on the Pi's monitor (desktop images)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/jimbro
ETC=/etc/jimbro
HOSTNAME_WANTED=""
PORT=443
DATA_DIR=/var/lib/jimbro
KIOSK=1
BUTTON=1

while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME_WANTED="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --no-kiosk) KIOSK=0; shift ;;
    --no-button) BUTTON=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash $0"
[ -d "$HERE/app/backend/jimbro" ] || die "bundle incomplete: $HERE/app/backend missing (run scripts/build_usb.sh)"
command -v python3 >/dev/null || die "python3 not found"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' || die "Python 3.11+ required (Raspberry Pi OS bookworm or newer)"

say "Installing system packages (skipped if already present)"
need=()
python3 -c 'import venv, ensurepip' 2>/dev/null || need+=(python3-venv)
command -v openssl >/dev/null || need+=(openssl)
command -v avahi-daemon >/dev/null || need+=(avahi-daemon)
if [ ${#need[@]} -gt 0 ]; then
  apt-get update -qq && apt-get install -y -qq "${need[@]}" || echo "warning: could not install ${need[*]}" >&2
fi

if [ -n "$HOSTNAME_WANTED" ]; then
  say "Setting hostname to $HOSTNAME_WANTED (reachable as $HOSTNAME_WANTED.local)"
  hostnamectl set-hostname "$HOSTNAME_WANTED"
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$HOSTNAME_WANTED/" /etc/hosts
  systemctl restart avahi-daemon 2>/dev/null || true
fi
HOST="$(hostname)"

say "Creating service user and directories"
id jimbro >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin jimbro
getent group gpio >/dev/null && usermod -aG gpio jimbro || true
mkdir -p "$PREFIX" "$ETC" "$DATA_DIR"
chown jimbro:jimbro "$DATA_DIR"
chmod 750 "$DATA_DIR"

say "Copying application ($(cat "$HERE/VERSION" 2>/dev/null || echo dev))"
rm -rf "$PREFIX/app.new"
cp -R "$HERE/app" "$PREFIX/app.new"
cp "$HERE/gpio_button.py" "$HERE/station.sh" "$PREFIX/app.new/"
rm -rf "$PREFIX/app.old"
[ -d "$PREFIX/app" ] && mv "$PREFIX/app" "$PREFIX/app.old"
mv "$PREFIX/app.new" "$PREFIX/app"
chmod 755 "$PREFIX/app/station.sh"

say "Installing Python dependencies"
[ -x "$PREFIX/venv/bin/python" ] || python3 -m venv "$PREFIX/venv"
export PIP_CONFIG_FILE=/dev/null PIP_DISABLE_PIP_VERSION_CHECK=1
if ! "$PREFIX/venv/bin/pip" install --quiet --no-index --find-links "$HERE/wheels" -r "$HERE/requirements.txt"; then
  echo "offline wheels incomplete; trying the internet" >&2
  "$PREFIX/venv/bin/pip" install --quiet -r "$HERE/requirements.txt"
fi

say "Creating HTTPS certificate"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ ! -s "$ETC/tls.key" ]; then
  san="DNS:$HOST.local,DNS:$HOST,DNS:localhost,IP:127.0.0.1${IP:+,IP:$IP}"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -sha256 \
    -keyout "$ETC/tls.key" -out "$ETC/tls.crt" -subj "/CN=$HOST.local" \
    -addext "subjectAltName=$san" >/dev/null 2>&1
fi
chown root:jimbro "$ETC/tls.key" "$ETC/tls.crt"
chmod 640 "$ETC/tls.key"

if [ ! -f "$ETC/jimbro.env" ]; then
  cat > "$ETC/jimbro.env" <<EOF
# JimBro settings. Edit, then: sudo systemctl restart jimbro
JIMBRO_DB=$DATA_DIR/jimbro.db
JIMBRO_STATIC=$PREFIX/app/web
JIMBRO_PORT=$PORT
# Optional: enable Jim's AI wording (the offline coach works without it)
# ANTHROPIC_API_KEY=sk-ant-...
EOF
  chmod 640 "$ETC/jimbro.env"
  chown root:jimbro "$ETC/jimbro.env"
fi

say "Installing services"
cp "$HERE/systemd/jimbro.service" /etc/systemd/system/jimbro.service
sed -i "s|@DATA_DIR@|$DATA_DIR|g" /etc/systemd/system/jimbro.service
cp "$HERE/systemd/jimbro-button.service" /etc/systemd/system/jimbro-button.service
systemctl daemon-reload
systemctl enable --now jimbro.service
systemctl restart jimbro.service
if [ "$BUTTON" -eq 1 ]; then
  systemctl enable --now jimbro-button.service || true
else
  systemctl disable --now jimbro-button.service 2>/dev/null || true
fi

DESKTOP_USER="${SUDO_USER:-}"
if [ "$KIOSK" -eq 1 ] && [ -n "$DESKTOP_USER" ] && [ "$DESKTOP_USER" != root ]; then
  home="$(getent passwd "$DESKTOP_USER" | cut -d: -f6)"
  if [ -d "$home" ]; then
    say "Enabling station kiosk for $DESKTOP_USER (shows on next desktop login)"
    install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" "$home/.config/autostart"
    sed "s|@PORT@|$PORT|g" "$HERE/jimbro-station.desktop" > "$home/.config/autostart/jimbro-station.desktop"
    chown "$DESKTOP_USER:$DESKTOP_USER" "$home/.config/autostart/jimbro-station.desktop"
  fi
fi

say "Waiting for the API"
url="https://127.0.0.1:$PORT/health"
for _ in $(seq 1 30); do
  curl -fsk "$url" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsk "$url" >/dev/null 2>&1; then
  suffix=""; [ "$PORT" = 443 ] || suffix=":$PORT"
  echo
  echo "JimBro is running."
  echo "  Phone (same Wi-Fi): https://$HOST.local$suffix   or   https://${IP:-<pi-ip>}$suffix"
  echo "  Accept the certificate warning once (self-signed), then 'Add to Home Screen'."
  echo "  Station display:    https://localhost$suffix/station"
  echo "  Logs:               journalctl -u jimbro -f"
  command -v qrencode >/dev/null && [ -n "$IP" ] && qrencode -t ansiutf8 "https://$IP$suffix"
else
  die "API did not start; check: journalctl -u jimbro -n 50"
fi
