"""Comparable progress metrics. Units are never mixed; percent change uses the first
comparable session as the denominator and is undefined when that value is zero."""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel

from .schemas import SetOut


class TrendPoint(BaseModel):
    session_id: str
    date: str
    top_weight: float
    volume: float
    reps: int
    avg_tut_ms: int | None


class UnitTrend(BaseModel):
    points: list[TrendPoint]
    top_weight_change_pct: float | None
    volume_change_pct: float | None
    tut_change_pct: float | None


def percent_change(first: float | None, last: float | None) -> float | None:
    if first is None or last is None or first == 0:
        return None
    return round((last - first) / first * 100, 1)


def trend(sets: Sequence[SetOut]) -> dict[str, UnitTrend]:
    by_unit: dict[str, dict[str, list[SetOut]]] = {}
    for s in sorted(sets, key=lambda s: (s.completed_at, s.id)):
        by_unit.setdefault(s.unit, {}).setdefault(s.session_id, []).append(s)
    out: dict[str, UnitTrend] = {}
    for unit, sessions in by_unit.items():
        points = []
        for sid, items in sessions.items():
            tuts = [s.avg_tut_ms for s in items if s.avg_tut_ms is not None]
            points.append(
                TrendPoint(
                    session_id=sid,
                    date=items[0].completed_at[:10],
                    top_weight=max(s.weight for s in items),
                    volume=sum(s.weight * s.reps for s in items),
                    reps=sum(s.reps for s in items),
                    avg_tut_ms=round(sum(tuts) / len(tuts)) if tuts else None,
                )
            )
        first, last = points[0], points[-1]
        if len(points) < 2:  # one session: nothing comparable yet
            out[unit] = UnitTrend(
                points=points,
                top_weight_change_pct=None,
                volume_change_pct=None,
                tut_change_pct=None,
            )
            continue
        out[unit] = UnitTrend(
            points=points,
            top_weight_change_pct=percent_change(first.top_weight, last.top_weight),
            volume_change_pct=percent_change(first.volume, last.volume),
            tut_change_pct=percent_change(first.avg_tut_ms, last.avg_tut_ms),
        )
    return out


def rank(rows: Sequence[tuple[str, float]]) -> list[tuple[int, str, float]]:
    """Competition ranking (1, 1, 3): ties share a rank, ordered by name for stability."""
    ordered = sorted(rows, key=lambda r: (-r[1], r[0]))
    out: list[tuple[int, str, float]] = []
    for i, (name, value) in enumerate(ordered):
        position = out[-1][0] if out and out[-1][2] == value else i + 1
        out.append((position, name, value))
    return out
