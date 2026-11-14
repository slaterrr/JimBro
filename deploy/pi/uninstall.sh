#!/usr/bin/env bash
# Remove JimBro services and program files. Keeps workout data unless --purge.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
systemctl disable --now jimbro.service jimbro-button.service 2>/dev/null || true
rm -f /etc/systemd/system/jimbro.service /etc/systemd/system/jimbro-button.service \
  /etc/systemd/system/jimbro-usb@.service /etc/udev/rules.d/99-jimbro-usb.rules
udevadm control --reload-rules 2>/dev/null || true
systemctl daemon-reload
rm -rf /opt/jimbro
if [ -n "${SUDO_USER:-}" ]; then
  rm -f "$(getent passwd "$SUDO_USER" | cut -d: -f6)/.config/autostart/jimbro-station.desktop"
fi
if [ "${1:-}" = "--purge" ]; then
  rm -rf /etc/jimbro /var/lib/jimbro
  userdel jimbro 2>/dev/null || true
  echo "JimBro removed, including data."
else
  echo "JimBro removed. Data kept in /var/lib/jimbro and settings in /etc/jimbro (use --purge to delete)."
fi
