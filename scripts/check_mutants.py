"""Fail CI if mutmut reports untested or surviving mutations.

Conservative parser: unrecognized results fail closed rather than passing silently.
"""

from __future__ import annotations

import re
import subprocess
import sys


def main() -> int:
    process = subprocess.run(
        ["mutmut", "results"],
        capture_output=True,
        text=True,
        check=False,
    )
    report = process.stdout + "\n" + process.stderr
    print(report)
    if process.returncode != 0:
        print("Mutation reporting failed.", file=sys.stderr)
        return 1

    # mutmut 3 lists surviving/suspicious mutations as IDs prefixed
    # with distinct symbols. Do not silently accept unreadable output.
    suspicious = re.search(r"(?im)(survived|suspicious|untested)\s*:?\s*[1-9]\d*", report)
    unknown = not report.strip()
    if suspicious or unknown:
        print("Mutation audit failed: surviving, suspicious or unknown results.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
