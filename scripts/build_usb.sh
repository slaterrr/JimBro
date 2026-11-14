#!/usr/bin/env bash
# Build a self-contained JimBro bundle for a Raspberry Pi (64-bit Raspberry Pi OS).
#
#   scripts/build_usb.sh [OUT_DIR]        default OUT_DIR: build/jimbro-usb
#
# Copy OUT_DIR onto a USB stick (FAT32/exFAT is fine), plug it into the Pi and run:
#   sudo bash /media/<user>/<stick>/jimbro-usb/install.sh
#
# The bundle needs no internet on the Pi: it contains the backend, the built PWA,
# MediaPipe's wasm runtime + pose model, and aarch64 Python wheels.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/build/jimbro-usb}"
PY_VERSION="${PI_PYTHON_VERSION:-311}"   # Raspberry Pi OS bookworm ships Python 3.11
MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python py; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
fi
[ -n "$PY" ] || { echo "Python 3 is required to download wheels" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm (Node 20+) is required to build the PWA" >&2; exit 1; }

say "Fetching pose model"
mkdir -p "$ROOT/models"
if [ ! -s "$ROOT/models/pose_landmarker_lite.task" ]; then
  curl -fsSL "$MODEL_URL" -o "$ROOT/models/pose_landmarker_lite.task"
fi

say "Building PWA"
( cd "$ROOT/apps/mobile" && npm ci --no-audit --no-fund && npx tsc -b && npx vite build )

say "Assembling bundle in $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/app" "$OUT/wheels"
cp -R "$ROOT/backend" "$OUT/app/backend"
find "$OUT/app/backend" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf "$OUT/app/backend/tests" "$OUT/app/backend"/*.egg-info
cp -R "$ROOT/apps/mobile/dist" "$OUT/app/web"
cp "$ROOT/pyproject.toml" "$ROOT/README.md" "$OUT/app/"
cp -R "$ROOT/deploy/pi/." "$OUT/"
# A Windows checkout may have CRLF endings; bash and systemd on the Pi need LF.
find "$OUT" -maxdepth 2 -type f \( -name '*.sh' -o -name '*.service' -o -name '*.desktop' -o -name '*.py' \) \
  -exec sed -i 's/\r$//' {} +
chmod +x "$OUT"/*.sh 2>/dev/null || true

say "Downloading aarch64 wheels for Python $PY_VERSION"
"$PY" - "$ROOT/pyproject.toml" > "$OUT/requirements.txt" <<'PYEOF'
import sys, tomllib
deps = tomllib.load(open(sys.argv[1], "rb"))["project"]["dependencies"]
print("\n".join(deps))
# Environment markers are evaluated on the build host (maybe Windows), so name the
# Linux-only extra of uvicorn[standard] explicitly.
print("uvloop")
# pip itself, so install.sh can bootstrap a venv on images without python3-venv.
print("pip")
PYEOF
PIP_CONFIG_FILE=/dev/null "$PY" -m pip download --quiet --disable-pip-version-check \
  --only-binary=:all: --implementation cp --python-version "$PY_VERSION" \
  --platform manylinux_2_28_aarch64 --platform manylinux_2_17_aarch64 \
  --platform manylinux2014_aarch64 --platform linux_aarch64 \
  --dest "$OUT/wheels" -r "$OUT/requirements.txt" || true
[ "$(ls -A "$OUT/wheels")" ] || echo "warning: no wheels downloaded; install.sh will use the internet" >&2

git -C "$ROOT" rev-parse --short HEAD > "$OUT/VERSION" 2>/dev/null || echo dev > "$OUT/VERSION"
cp "$OUT/VERSION" "$OUT/app/VERSION"
say "Done: $(du -sh "$OUT" | cut -f1) in $OUT"
echo "Copy that folder to a USB stick, then on the Pi run: sudo bash <stick>/jimbro-usb/install.sh"
