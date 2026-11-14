#!/usr/bin/env python3
"""Make a freshly flashed Raspberry Pi SD card install JimBro on its first boot.

1. Flash 64-bit Raspberry Pi OS (Lite is fine) with Raspberry Pi Imager and set the
   username, Wi-Fi and SSH in its customisation screen.
2. Build the bundle:          scripts/build_usb.sh
3. With the card still in your computer:
       python scripts/prepare_sd.py <boot partition> [--hostname jimbro]
   e.g. E:\\ on Windows, /Volumes/bootfs on macOS, /media/$USER/bootfs on Linux.
4. Put the card in the Pi and power on. A few minutes later open https://jimbro.local.
   The install log is at /var/log/jimbro-firstboot.log on the Pi.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

MARKER = "# jimbro-firstboot"
PI_BOOT = "/boot/firmware"  # where bookworm+ mounts the boot partition
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")


class PrepareError(Exception):
    pass


def _command(hostname: str | None) -> str:
    host = f" --hostname {hostname}" if hostname else ""
    return (
        f"bash {PI_BOOT}/jimbro-usb/install.sh --headless{host}"
        " > /var/log/jimbro-firstboot.log 2>&1 || true"
    )


def _read(path: Path) -> str:
    return path.read_bytes().decode().replace("\r\n", "\n")


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode())  # always LF: the Pi runs these with bash / cloud-init


def _hook_firstrun(path: Path, cmd: str) -> None:
    lines = _read(path).split("\n")
    at = next(
        (i for i, ln in enumerate(lines) if "rm -f /boot" in ln and "firstrun.sh" in ln), None
    )
    if at is None:
        at = next((i for i, ln in enumerate(lines) if ln.strip() == "exit 0"), len(lines))
    lines[at:at] = [MARKER, cmd]
    _write(path, "\n".join(lines))


def _hook_cloud_init(path: Path, cmd: str) -> None:
    lines = _read(path).rstrip("\n").split("\n")
    item = f"  - [bash, -c, {cmd!r}]  {MARKER}"
    if "runcmd:" in lines:
        i = lines.index("runcmd:") + 1
        while i < len(lines) and lines[i].startswith(("  ", "-")):
            i += 1
        lines[i:i] = [item]
    else:
        lines += ["runcmd:", item]
    _write(path, "\n".join(lines) + "\n")


def prepare(boot: Path, bundle: Path, hostname: str | None = None) -> str:
    if not ((boot / "config.txt").is_file() and (boot / "cmdline.txt").is_file()):
        raise PrepareError(f"{boot} is not a Raspberry Pi boot partition (no config.txt)")
    if not (bundle / "install.sh").is_file():
        raise PrepareError(f"no bundle at {bundle}; run scripts/build_usb.sh first")
    if hostname is not None and not HOST_RE.match(hostname):
        raise PrepareError(f"invalid hostname {hostname!r}: use lowercase letters, digits, '-'")

    firstrun, userdata = boot / "firstrun.sh", boot / "user-data"
    if not firstrun.is_file() and not userdata.is_file():
        raise PrepareError(
            "no first-boot script on the card. In Raspberry Pi Imager choose 'Edit settings' "
            "(username, Wi-Fi, SSH) before writing, then run this again."
        )

    dest = boot / "jimbro-usb"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(bundle, dest)

    cmd = _command(hostname)
    target = firstrun if firstrun.is_file() else userdata
    if MARKER in _read(target):
        return "firstrun" if target is firstrun else "cloud-init"
    if target is firstrun:
        _hook_firstrun(firstrun, cmd)
        return "firstrun"
    _hook_cloud_init(userdata, cmd)
    return "cloud-init"


def main(argv: list[str]) -> int:  # pragma: no cover - CLI wrapper
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("boot", type=Path, help="mounted boot partition of the SD card")
    ap.add_argument(
        "--bundle", type=Path, default=Path(__file__).parents[1] / "build" / "jimbro-usb"
    )
    ap.add_argument("--hostname", default="jimbro")
    args = ap.parse_args(argv)
    try:
        mode = prepare(args.boot, args.bundle, args.hostname)
    except PrepareError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"Ready ({mode}). Eject the card, boot the Pi, then open https://{args.hostname}.local")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
