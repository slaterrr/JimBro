"""Live session protocol: the phone streams joint angles (never video) to the Pi.

Client -> server: {"type": "sample", "t": ms, "angle": deg, "confidence": 0..1},
                  {"type": "reset"}, {"type": "ping"}
Server -> client: {"type": "state", ...}, {"type": "rep", ...}, {"type": "error", ...},
                  {"type": "pong"}
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .reps import MOVEMENTS, AngleSample, RepCounter, RepSummary

Event = dict[str, Any]


def rep_event(rep: RepSummary) -> Event:
    return {"type": "rep", **asdict(rep), "tut_ms": rep.tut_ms}


class LiveSession:
    def __init__(self, movement: str) -> None:
        self.movement = movement
        self.counter = RepCounter(MOVEMENTS[movement])

    def state_event(self) -> Event:
        c = self.counter
        return {"type": "state", "state": c.state, "count": c.count, "partials": c.partials}

    def handle(self, message: object) -> list[Event]:
        if not isinstance(message, dict):
            return [{"type": "error", "detail": "message must be an object"}]
        kind = message.get("type")
        if kind == "ping":
            return [{"type": "pong"}]
        if kind == "reset":
            self.counter.reset()
            return [self.state_event()]
        if kind != "sample":
            return [{"type": "error", "detail": f"unknown message type: {kind!r}"}]
        try:
            sample = AngleSample(
                t_ms=int(message["t"]),
                angle_deg=float(message["angle"]),
                confidence=float(message["confidence"]),
            )
        except (KeyError, TypeError, ValueError):
            return [{"type": "error", "detail": "sample needs numeric t, angle, confidence"}]

        before = (self.counter.state, self.counter.partials)
        rep = self.counter.update(sample)
        events: list[Event] = [rep_event(rep)] if rep else []
        if (self.counter.state, self.counter.partials) != before:
            events.append(self.state_event())
        return events
