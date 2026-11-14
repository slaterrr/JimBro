"""Replay labeled angle traces through the production RepCounter and report accuracy.

Trace files are CSV (``t_ms,angle,confidence``) exported from the phone, named
``<movement>_true<N>[_key-value...].csv``, e.g. ``curl_true10_side-left_light-dim.csv``.
Per trace, true positives are ``min(true, counted)``: a count-level metric, since rep
timestamps are not hand-labeled.

    python -m jimbro.evaluate traces/ [--synthetic] > docs/EVIDENCE.md
"""

from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .reps import MOVEMENTS, AngleSample, RepCounter

NAME = re.compile(r"^(?P<movement>[a-z_]+?)_true(?P<n>\d+)(?P<tags>(_[a-z0-9]+-[a-z0-9]+)*)$")


@dataclass
class Trace:
    name: str
    movement: str
    true_reps: int
    samples: list[tuple[int, float, float]]
    tags: dict[str, str] = field(default_factory=dict)

    @property
    def fps(self) -> float:
        if len(self.samples) < 2:
            return 0.0
        span = self.samples[-1][0] - self.samples[0][0]
        return (len(self.samples) - 1) * 1000 / span if span > 0 else 0.0


@dataclass
class Row:
    name: str
    movement: str
    true_reps: int
    counted: int
    partials: int
    fps: float
    tags: dict[str, str]

    @property
    def error(self) -> int:
        return self.counted - self.true_reps


@dataclass
class Report:
    rows: list[Row]

    @property
    def n_traces(self) -> int:
        return len(self.rows)

    @property
    def true_reps(self) -> int:
        return sum(r.true_reps for r in self.rows)

    @property
    def counted_reps(self) -> int:
        return sum(r.counted for r in self.rows)

    @property
    def false_positives(self) -> int:
        return sum(max(0, r.error) for r in self.rows)

    @property
    def missed(self) -> int:
        return sum(max(0, -r.error) for r in self.rows)

    @property
    def _tp(self) -> int:
        return sum(min(r.true_reps, r.counted) for r in self.rows)

    @property
    def precision(self) -> float | None:
        return self._tp / self.counted_reps if self.counted_reps else None

    @property
    def recall(self) -> float | None:
        return self._tp / self.true_reps if self.true_reps else None

    @property
    def exact_match_rate(self) -> float | None:
        return sum(r.error == 0 for r in self.rows) / self.n_traces if self.rows else None


def load_trace(path: Path) -> Trace:
    m = NAME.match(path.stem)
    if not m or m["movement"] not in MOVEMENTS:
        raise ValueError(f"{path.name}: expected <movement>_true<N>[_key-value].csv")
    tags = dict(t.split("-", 1) for t in m["tags"].split("_") if t)
    with path.open(newline="") as f:
        samples = [
            (int(float(r["t_ms"])), float(r["angle"]), float(r["confidence"]))
            for r in csv.DictReader(f)
        ]
    return Trace(path.stem, m["movement"], int(m["n"]), samples, tags)


def evaluate(traces: list[Trace]) -> Report:
    rows = []
    for tr in traces:
        counter = RepCounter(MOVEMENTS[tr.movement])
        for t, angle, conf in tr.samples:
            counter.update(AngleSample(t, angle, conf))
        rows.append(
            Row(
                tr.name, tr.movement, tr.true_reps, counter.count, counter.partials, tr.fps, tr.tags
            )
        )
    return Report(rows)


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{v * 100:.1f}%"


def report_markdown(report: Report, synthetic: bool = False) -> str:
    lines = ["# Rep counting evidence", ""]
    if synthetic:
        lines += [
            "> **SYNTHETIC traces** - generated, not recorded. Not evidence of real-world"
            " accuracy.",
            "",
        ]
    s = "" if report.n_traces == 1 else "s"
    lines += [
        f"- n = {report.n_traces} trace{s}, {report.true_reps} true reps,"
        f" {report.counted_reps} counted",
        f"- precision {_pct(report.precision)}, recall {_pct(report.recall)},"
        f" exact-count traces {_pct(report.exact_match_rate)}",
        f"- false positives {report.false_positives}, missed reps {report.missed}",
        "",
        "| trace | movement | true | counted | partials | fps | conditions |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in report.rows:
        tags = ", ".join(f"{k}={v}" for k, v in r.tags.items()) or "-"
        lines.append(
            f"| {r.name} | {r.movement} | {r.true_reps} | {r.counted} | {r.partials} |"
            f" {r.fps:.0f} | {tags} |"
        )
    lines += [
        "",
        "Limits: count-level metric (no per-rep timestamps), single camera angle per trace,"
        " small n. TUT is estimated movement-phase timing. Not a clinical assessment.",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:  # pragma: no cover - CLI wrapper
    if not argv:
        print(__doc__)
        return 2
    folder = Path(argv[0])
    traces = [load_trace(p) for p in sorted(folder.glob("*.csv"))]
    sys.stdout.write(report_markdown(evaluate(traces), synthetic="--synthetic" in argv))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
