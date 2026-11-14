"""Optional physical button for the JimBro station (Raspberry Pi GPIO).

Wire a momentary push button between GPIO17 (pin 11) and GND (pin 9). Each press is
sent to the local API, which broadcasts it to the station display. Runs as the
jimbro-button systemd service; exits cleanly when gpiozero or GPIO is unavailable.
"""

from __future__ import annotations

import os
import signal
import sys
import urllib.request

API = os.environ.get("JIMBRO_API", "http://127.0.0.1:8000")
PIN = int(os.environ.get("JIMBRO_BUTTON_PIN", "17"))


def press(api: str = API) -> bool:
    try:
        req = urllib.request.Request(f"{api}/v1/station/button", method="POST", data=b"")
        with urllib.request.urlopen(req, timeout=2) as res:
            return bool(res.status == 200)
    except OSError:
        return False


def main() -> int:
    try:
        from gpiozero import Button  # type: ignore[import-not-found]
    except ImportError:
        print("gpiozero not installed; GPIO button disabled", file=sys.stderr)
        return 0
    try:
        button = Button(PIN, pull_up=True, bounce_time=0.05)
    except Exception as exc:  # no GPIO on this machine
        print(f"GPIO unavailable: {exc}", file=sys.stderr)
        return 0
    button.when_pressed = lambda: press()
    print(f"JimBro button listening on GPIO{PIN}")
    signal.pause()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
