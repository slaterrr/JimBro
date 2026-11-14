"""Live angle-stream protocol: samples in, state + rep events out."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from jimbro.api import app
from jimbro.live import LiveSession


def curl_angles() -> list[tuple[int, float]]:
    out: list[tuple[int, float]] = []
    t = 0
    for angle in (
        [170] * 10 + list(range(170, 39, -10)) + [40] * 6 + list(range(40, 171, 8)) + [170] * 10
    ):
        t += 33
        out.append((t, float(angle)))
    return out


def sample(t: int, angle: float, confidence: float = 0.9) -> dict[str, object]:
    return {"type": "sample", "t": t, "angle": angle, "confidence": confidence}


def test_session_emits_state_changes_and_one_rep() -> None:
    session = LiveSession("curl")
    events = [e for t, a in curl_angles() for e in session.handle(sample(t, a))]
    reps = [e for e in events if e["type"] == "rep"]
    states = [e["state"] for e in events if e["type"] == "state"]
    assert len(reps) == 1
    assert reps[0]["index"] == 1 and reps[0]["tut_ms"] > 0
    assert states == ["concentric", "peak", "eccentric", "rest"]
    assert events[-1] == {"type": "state", "state": "rest", "count": 1, "partials": 0}


def test_session_rejects_malformed_messages_without_crashing() -> None:
    session = LiveSession("curl")
    for bad in [
        {},
        {"type": "sample"},
        {"type": "sample", "t": "x", "angle": 1, "confidence": 1},
        {"type": "nope"},
        [],
    ]:
        (event,) = session.handle(bad)
        assert event["type"] == "error"


def test_session_reset_reports_zero() -> None:
    session = LiveSession("curl")
    for t, a in curl_angles():
        session.handle(sample(t, a))
    assert session.handle({"type": "reset"}) == [
        {"type": "state", "state": "rest", "count": 0, "partials": 0}
    ]


def test_unknown_movement_raises() -> None:
    with pytest.raises(KeyError):
        LiveSession("bench")


def test_websocket_streams_rep_event() -> None:
    client = TestClient(app)
    with client.websocket_connect("/v1/live/curl") as ws:
        hello = ws.receive_json()
        assert hello == {"type": "state", "state": "rest", "count": 0, "partials": 0}
        received = []
        for t, a in curl_angles():
            ws.send_json(sample(t, a))
        ws.send_json({"type": "ping"})
        while True:
            msg = ws.receive_json()
            received.append(msg)
            if msg["type"] == "pong":
                break
    assert sum(1 for m in received if m["type"] == "rep") == 1


def test_websocket_unknown_movement_closes() -> None:
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect("/v1/live/bench") as ws:
            ws.receive_json()
    assert info.value.code == 4404
