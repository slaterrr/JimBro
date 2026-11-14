"""Accuracy evidence: replay labeled angle traces through the production counter."""

from pathlib import Path

import pytest
from backend.jimbro.evaluate import Trace, evaluate, load_trace, report_markdown


def curl_trace(n: int) -> list[tuple[int, float, float]]:
    rows: list[tuple[int, float, float]] = []
    t = 0
    cycle = [170.0] * 12 + [170 - 10.0 * i for i in range(14)] + [40.0] * 6
    cycle += [40 + 8.0 * i for i in range(17)]
    for _ in range(n):
        for a in cycle:
            t += 33
            rows.append((t, a, 0.9))
    for _ in range(12):
        t += 33
        rows.append((t, 170.0, 0.9))
    return rows


def write(path: Path, rows: list[tuple[int, float, float]]) -> None:
    path.write_text("t_ms,angle,confidence\n" + "".join(f"{t},{a},{c}\n" for t, a, c in rows))


def test_load_trace_parses_metadata_from_filename(tmp_path: Path) -> None:
    p = tmp_path / "curl_true5_side-front_light-dim.csv"
    write(p, curl_trace(5))
    trace = load_trace(p)
    assert trace.movement == "curl" and trace.true_reps == 5
    assert trace.tags == {"side": "front", "light": "dim"}
    assert trace.fps == pytest.approx(30.3, abs=0.2)


def test_load_trace_rejects_bad_names(tmp_path: Path) -> None:
    p = tmp_path / "mystery.csv"
    write(p, curl_trace(1))
    with pytest.raises(ValueError):
        load_trace(p)


def test_evaluate_counts_errors_and_false_positives() -> None:
    traces = [
        Trace(name="a", movement="curl", true_reps=3, samples=curl_trace(3), tags={}),
        Trace(name="b", movement="curl", true_reps=2, samples=curl_trace(3), tags={}),  # +1 FP
        Trace(name="c", movement="curl", true_reps=4, samples=curl_trace(3), tags={}),  # 1 miss
    ]
    r = evaluate(traces)
    assert r.n_traces == 3 and r.true_reps == 9 and r.counted_reps == 9
    assert r.false_positives == 1 and r.missed == 1
    assert r.precision == pytest.approx(8 / 9) and r.recall == pytest.approx(8 / 9)
    assert r.exact_match_rate == pytest.approx(1 / 3)
    assert [row.error for row in r.rows] == [0, 1, -1]


def test_empty_evaluation_is_explicit() -> None:
    r = evaluate([])
    assert r.n_traces == 0 and r.precision is None and r.recall is None


def test_report_states_limits(tmp_path: Path) -> None:
    traces = [Trace(name="a", movement="curl", true_reps=3, samples=curl_trace(3), tags={})]
    md = report_markdown(evaluate(traces), synthetic=True)
    assert "n = 1 trace" in md and "SYNTHETIC" in md
    assert "not a clinical" in md.lower()
