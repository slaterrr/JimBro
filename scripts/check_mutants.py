"""Fail CI if mutmut reports any mutant that was not killed.

`mutmut results` (mutmut 3) prints one line per non-killed mutant, e.g.
    backend.jimbro.reps.x_update__mutmut_7: survived
Any such line other than "killed" fails, and so does any line we cannot parse
(fail closed): a silent pass is worse than a noisy failure.
"""

from __future__ import annotations

import re
import subprocess
import sys

LINE = re.compile(r"^\s*(?P<name>[\w.ǁ]+__mutmut_\d+):\s*(?P<status>[\w ]+?)\s*$")
OK = {"killed"}


def problems(report: str) -> list[str]:
    bad = []
    for raw in report.splitlines():
        if not raw.strip():
            continue
        m = LINE.match(raw)
        if m is None or m["status"] not in OK:
            bad.append(raw.strip())
    return bad


def main() -> int:
    process = subprocess.run(["mutmut", "results"], capture_output=True, text=True, check=False)
    if process.returncode != 0:
        print(process.stdout + process.stderr)
        print("Mutation reporting failed.", file=sys.stderr)
        return 1
    bad = problems(process.stdout)
    for line in bad:
        print(line)
    if bad:
        print(f"Mutation audit failed: {len(bad)} mutant(s) not killed.", file=sys.stderr)
        print("Inspect one with: mutmut show <name>", file=sys.stderr)
        return 1
    print("Mutation audit passed: every mutant killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
