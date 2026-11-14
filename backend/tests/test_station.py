"""Pi station: event bus fan-out, sequence numbers, reconnect and slow consumers."""

import asyncio
from typing import Any

from backend.jimbro.events import EventBus
from fastapi.testclient import TestClient


def test_bus_fans_out_with_increasing_seq() -> None:
    async def run() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        bus = EventBus()
        a, b = bus.subscribe(), bus.subscribe()
        bus.publish({"type": "rep", "index": 1})
        bus.publish({"type": "rep", "index": 2})
        return [a.get_nowait(), a.get_nowait()], [b.get_nowait(), b.get_nowait()]

    got_a, got_b = asyncio.run(run())
    assert got_a == got_b
    assert [e["seq"] for e in got_a] == [1, 2]


def test_slow_subscriber_drops_oldest_not_newest() -> None:
    async def run() -> list[int]:
        bus = EventBus(max_queue=3)
        q = bus.subscribe()
        for i in range(5):
            bus.publish({"type": "rep", "index": i})
        return [q.get_nowait()["index"] for _ in range(q.qsize())]

    assert asyncio.run(run()) == [2, 3, 4]


def test_unsubscribe_and_snapshot() -> None:
    async def run() -> tuple[int, dict[str, Any] | None]:
        bus = EventBus()
        q = bus.subscribe()
        bus.unsubscribe(q)
        bus.unsubscribe(q)  # idempotent
        bus.publish({"type": "set", "reps": 3})
        return len(bus.subscribers), bus.last

    count, last = asyncio.run(run())
    assert count == 0 and last is not None and last["seq"] == 1


def test_station_receives_live_reps_and_saved_sets(client: TestClient) -> None:
    angles = [170.0] * 10 + [float(a) for a in range(170, 39, -10)] + [40.0] * 6
    angles += [float(a) for a in range(40, 171, 8)] + [170.0] * 10
    with client.websocket_connect("/v1/station") as station:
        hello = station.receive_json()
        assert hello["type"] == "hello"
        with client.websocket_connect("/v1/live/curl") as live:
            live.receive_json()
            for i, a in enumerate(angles):
                live.send_json({"type": "sample", "t": (i + 1) * 33, "angle": a, "confidence": 0.9})
            live.send_json({"type": "ping"})
            while live.receive_json()["type"] != "pong":
                pass
        event = station.receive_json()
        while event["type"] != "rep":
            event = station.receive_json()
        assert event["movement"] == "curl" and event["athlete_id"] == "me" and event["seq"] >= 1

        sid = client.post("/v1/sessions", json={}).json()["id"]
        body = {
            "session_id": sid,
            "exercise": "squat",
            "weight": 40,
            "unit": "kg",
            "reps": 5,
            "source": "manual",
            "reps_detail": [],
        }
        client.post("/v1/sets/st1/complete", json=body)
        event = station.receive_json()
        while event["type"] != "set":
            event = station.receive_json()
        assert event["exercise"] == "squat" and event["reps"] == 5
        # a retried (idempotent) set must not be re-announced
        client.post("/v1/sets/st1/complete", json=body)
        client.post("/v1/station/button")
        assert station.receive_json()["type"] == "button"


def test_station_reconnect_gets_last_event(client: TestClient) -> None:
    client.post("/v1/station/button")
    with client.websocket_connect("/v1/station") as station:
        hello = station.receive_json()
        assert hello["last"]["type"] == "button"
