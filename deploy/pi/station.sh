#!/bin/sh
# Open the JimBro station full-screen on the Pi's monitor once the API answers.
PORT="${1:-443}"
URL="https://localhost:${PORT}/station"
i=0
while ! curl -fsk "https://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && [ $i -lt 60 ]; do
  sleep 1; i=$((i + 1))
done
for b in chromium-browser chromium; do
  if command -v "$b" >/dev/null 2>&1; then
    exec "$b" --kiosk --noerrdialogs --disable-infobars --no-first-run \
      --ignore-certificate-errors --password-store=basic --app="$URL"
  fi
done
echo "Chromium not found; open $URL manually" >&2
