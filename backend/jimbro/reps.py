"""Deterministic rep counting and movement-phase timing from joint-angle samples.

Every movement is normalised to *depth*: how far the joint has travelled from its rest
angle toward its peak angle. That lets one hysteresis state machine handle flexion
(curl, squat: angle decreases) and extension (shoulder press: angle increases).

Phases are measured between threshold crossings, so durations are estimated
movement-phase timing (TUT), not measured muscle tension.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
from typing import Literal

State = Literal["rest", "concentric", "peak", "eccentric"]


@dataclass(frozen=True)
class MovementConfig:
    name: str
    rest_deg: float
    peak_deg: float
    hysteresis_deg: float = 12.0
    smoothing: float = 0.5
    min_confidence: float = 0.5
    min_rep_ms: int = 500
    cooldown_ms: int = 250
    max_gap_ms: int = 1000

    def __post_init__(self) -> None:
        if self.span <= 0:
            raise ValueError("rest and peak angles must differ")
        if self.hysteresis_deg < 0 or 4 * self.hysteresis_deg >= self.span:
            raise ValueError("hysteresis must be non-negative and below a quarter of the span")
        if not 0 < self.smoothing <= 1:
            raise ValueError("smoothing must be in (0, 1]")
        if not 0 <= self.min_confidence <= 1:
            raise ValueError("min_confidence must be in [0, 1]")

    @property
    def span(self) -> float:
        return abs(self.rest_deg - self.peak_deg)

    def depth(self, angle_deg: float) -> float:
        direction = 1.0 if self.peak_deg < self.rest_deg else -1.0
        return direction * (self.rest_deg - angle_deg)


CURL = MovementConfig(name="curl", rest_deg=165, peak_deg=50)
SQUAT = MovementConfig(name="squat", rest_deg=165, peak_deg=95, hysteresis_deg=10)
SHOULDER_PRESS = MovementConfig(name="shoulder_press", rest_deg=85, peak_deg=160)
MOVEMENTS: dict[str, MovementConfig] = {m.name: m for m in (CURL, SQUAT, SHOULDER_PRESS)}


@dataclass(frozen=True)
class AngleSample:
    t_ms: int
    angle_deg: float
    confidence: float


@dataclass(frozen=True)
class RepSummary:
    index: int
    start_ms: int
    end_ms: int
    concentric_ms: int
    peak_pause_ms: int
    eccentric_ms: int

    @property
    def tut_ms(self) -> int:
        return self.concentric_ms + self.peak_pause_ms + self.eccentric_ms


@dataclass
class RepCounter:
    config: MovementConfig
    count: int = 0
    partials: int = 0
    state: State = "rest"
    _armed: bool = False
    _smoothed: float | None = None
    _last_t: int | None = None
    _last_good_t: int | None = None
    _cooldown_until: int = 0
    _marks: dict[str, int] = field(default_factory=dict)
    _reached_peak: bool = False

    def reset(self) -> None:
        self.count = 0
        self.partials = 0
        self._abort()
        self._last_t = None
        self._last_good_t = None
        self._cooldown_until = 0

    def _abort(self) -> None:
        self.state = "rest"
        self._armed = False
        self._smoothed = None
        self._marks = {}
        self._reached_peak = False

    def update(self, sample: AngleSample) -> RepSummary | None:
        """Consume one sample; return a summary when a full rep completes."""
        if not isfinite(sample.angle_deg) or not isfinite(sample.confidence):
            return None
        if self._last_t is not None and sample.t_ms <= self._last_t:
            return None
        self._last_t = sample.t_ms
        if sample.confidence < self.config.min_confidence:
            return None
        gap = None if self._last_good_t is None else sample.t_ms - self._last_good_t
        if gap is not None and gap > self.config.max_gap_ms:
            self._abort()  # tracking was lost too long to trust the in-flight rep
        self._last_good_t = sample.t_ms

        alpha = self.config.smoothing
        raw = self.config.depth(sample.angle_deg)
        prev = self._smoothed
        self._smoothed = raw if prev is None else alpha * raw + (1 - alpha) * prev
        return self._step(self._smoothed, sample.t_ms)

    def _step(self, depth: float, t: int) -> RepSummary | None:
        h = self.config.hysteresis_deg
        span = self.config.span
        rest_enter, rest_exit = h, 2 * h
        peak_exit, peak_enter = span - 2 * h, span - h

        if not self._armed:
            if depth <= rest_enter:
                self._armed = True
            return None

        if self.state == "rest":
            if depth > rest_exit and t >= self._cooldown_until:
                self.state = "concentric"
                self._marks = {"start": t}
                self._reached_peak = False
        elif self.state == "concentric":
            if depth >= peak_enter:
                self.state = "peak"
                self._marks["peak"] = t
                self._reached_peak = True
            elif depth <= rest_enter:
                return self._finish(t)
        elif self.state == "peak":
            if depth < peak_exit:
                self.state = "eccentric"
                self._marks["leave_peak"] = t
        elif depth >= peak_enter:  # eccentric -> back up to peak
            self.state = "peak"
        elif depth <= rest_enter:
            return self._finish(t)
        return None

    def _finish(self, t: int) -> RepSummary | None:
        marks = self._marks
        self.state = "rest"
        self._cooldown_until = t + self.config.cooldown_ms
        self._marks = {}
        start = marks["start"]
        if not self._reached_peak or t - start < self.config.min_rep_ms:
            self.partials += 1
            return None
        self.count += 1
        return RepSummary(
            index=self.count,
            start_ms=start,
            end_ms=t,
            concentric_ms=marks["peak"] - start,
            peak_pause_ms=marks["leave_peak"] - marks["peak"],
            eccentric_ms=t - marks["leave_peak"],
        )
