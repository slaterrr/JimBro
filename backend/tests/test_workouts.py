"""Workout logging API: sessions, idempotent set completion, summaries, persistence."""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from jimbro.api import create_app

ME = {"X-Athlete-Id": "alex"}


def new_session(client: TestClient, headers: dict[str, str] = ME) -> str:
    res = client.post("/v1/sessions", json={}, headers=headers)
    assert res.status_code == 201
    return str(res.json()["id"])


def set_body(session_id: str, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "session_id": session_id,
        "exercise": "curl",
        "weight": 12.5,
        "unit": "kg",
        "reps": 3,
        "rpe": 8,
        "source": "camera",
        "reps_detail": [
            {"index": i, "concentric_ms": 800, "peak_pause_ms": 200, "eccentric_ms": 1200}
            for i in (1, 2, 3)
        ],
    }
    body.update(over)
    return body


def test_exercises_lists_six_initial_lifts(client: TestClient) -> None:
    exercises = client.get("/v1/exercises").json()
    assert [e["id"] for e in exercises] == [
        "curl",
        "squat",
        "bench",
        "deadlift",
        "shoulder_press",
        "pull_up",
    ]
    camera = {e["id"] for e in exercises if e["camera_tracking"]}
    assert camera == {"curl", "squat", "shoulder_press"}


def test_complete_set_and_summary(client: TestClient) -> None:
    sid = new_session(client)
    res = client.post("/v1/sets/set-1/complete", json=set_body(sid), headers=ME)
    assert res.status_code == 201
    summary = client.get(f"/v1/sessions/{sid}/summary", headers=ME).json()
    assert summary["total_reps"] == 3
    assert summary["volume"] == {"kg": 37.5}
    assert summary["sets"][0]["avg_tut_ms"] == 2200
    assert summary["sets"][0]["reps_detail"][0]["tut_ms"] == 2200


def test_retry_with_same_payload_is_idempotent(client: TestClient) -> None:
    sid = new_session(client)
    first = client.post("/v1/sets/set-1/complete", json=set_body(sid), headers=ME)
    again = client.post("/v1/sets/set-1/complete", json=set_body(sid), headers=ME)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json() == again.json()
    summary = client.get(f"/v1/sessions/{sid}/summary", headers=ME).json()
    assert len(summary["sets"]) == 1


def test_conflicting_duplicate_is_rejected(client: TestClient) -> None:
    sid = new_session(client)
    client.post("/v1/sets/set-1/complete", json=set_body(sid), headers=ME)
    changed = set_body(sid, reps=5, reps_detail=[])
    res = client.post("/v1/sets/set-1/complete", json=changed, headers=ME)
    assert res.status_code == 409


@pytest.mark.parametrize(
    "over",
    [
        {"exercise": "zumba"},
        {"unit": "stone"},
        {"weight": -1},
        {"reps": -1},
        {"rpe": 11},
        {"rpe": 0},
        {"source": "magic"},
        {"reps": 1},  # detail count must match reps when provided
        {"reps_detail": [{"index": 1, "concentric_ms": -5, "peak_pause_ms": 0, "eccentric_ms": 1}]},
    ],
)
def test_invalid_sets_rejected(client: TestClient, over: dict[str, Any]) -> None:
    sid = new_session(client)
    res = client.post("/v1/sets/s/complete", json=set_body(sid, **over), headers=ME)
    assert res.status_code == 422


def test_manual_set_without_reps_detail(client: TestClient) -> None:
    sid = new_session(client)
    body = set_body(sid, exercise="deadlift", weight=225, unit="lb", reps=5, source="manual")
    body["reps_detail"] = []
    assert client.post("/v1/sets/m1/complete", json=body, headers=ME).status_code == 201
    s = client.get(f"/v1/sessions/{sid}/summary", headers=ME).json()
    assert s["volume"] == {"lb": 1125} and s["sets"][0]["avg_tut_ms"] is None


def test_mixed_units_are_never_summed(client: TestClient) -> None:
    sid = new_session(client)
    client.post("/v1/sets/a/complete", json=set_body(sid), headers=ME)
    lb = set_body(sid, unit="lb", weight=20, reps_detail=[], source="manual")
    client.post("/v1/sets/b/complete", json=lb, headers=ME)
    summary = client.get(f"/v1/sessions/{sid}/summary", headers=ME).json()
    assert summary["volume"] == {"kg": 37.5, "lb": 60}


def test_unknown_session_is_404(client: TestClient) -> None:
    assert client.get("/v1/sessions/nope/summary", headers=ME).status_code == 404
    res = client.post("/v1/sets/x/complete", json=set_body("nope"), headers=ME)
    assert res.status_code == 404


def test_cross_athlete_isolation(client: TestClient) -> None:
    sid = new_session(client)
    other = {"X-Athlete-Id": "sam"}
    assert client.get(f"/v1/sessions/{sid}/summary", headers=other).status_code == 404
    res = client.post("/v1/sets/x/complete", json=set_body(sid), headers=other)
    assert res.status_code == 404
    assert client.get("/v1/sessions", headers=other).json() == []


def test_set_id_reuse_across_athletes_conflicts(client: TestClient) -> None:
    mine = new_session(client)
    sam = {"X-Athlete-Id": "sam"}
    theirs = new_session(client, sam)
    client.post("/v1/sets/shared/complete", json=set_body(mine), headers=ME)
    res = client.post("/v1/sets/shared/complete", json=set_body(theirs), headers=sam)
    assert res.status_code == 409


def test_invalid_athlete_header_rejected(client: TestClient) -> None:
    res = client.post("/v1/sessions", json={}, headers={"X-Athlete-Id": "bad id!"})
    assert res.status_code == 422


def test_default_athlete_when_header_missing(client: TestClient) -> None:
    res = client.post("/v1/sessions", json={})
    assert res.status_code == 201 and res.json()["athlete_id"] == "me"


def test_end_session_and_list(client: TestClient) -> None:
    sid = new_session(client)
    ended = client.post(f"/v1/sessions/{sid}/end", headers=ME).json()
    assert ended["ended_at"] is not None
    listed = client.get("/v1/sessions", headers=ME).json()
    assert [s["id"] for s in listed] == [sid]
    assert client.post("/v1/sessions/zzz/end", headers=ME).status_code == 404


def test_data_survives_restart(db_path: Path) -> None:
    with TestClient(create_app(db_path=db_path)) as c:
        sid = new_session(c)
        c.post("/v1/sets/p/complete", json=set_body(sid), headers=ME)
        sid2 = new_session(c)
        c.post("/v1/sets/q/complete", json=set_body(sid2, weight=15), headers=ME)
    with TestClient(create_app(db_path=db_path)) as c:
        assert len(c.get("/v1/sessions", headers=ME).json()) == 2
        summary = c.get(f"/v1/sessions/{sid2}/summary", headers=ME).json()
        assert summary["volume"] == {"kg": 45}


def test_failed_write_rolls_back(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from jimbro import db

    sid = new_session(client)

    def boom(*_: object, **__: object) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr(db, "_insert_reps", boom)
    with pytest.raises(RuntimeError):
        client.post("/v1/sets/r/complete", json=set_body(sid), headers=ME)
    monkeypatch.undo()
    assert client.get(f"/v1/sessions/{sid}/summary", headers=ME).json()["sets"] == []
